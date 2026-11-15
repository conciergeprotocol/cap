import assert from 'node:assert/strict'
import test from 'node:test'
import { WEIGHTS, productSchema, robotAllows, scoreSite } from './readiness.mjs'
import { renderScoreCard } from './readiness-og.mjs'
import { readinessMarkdown, readinessPageBody, readinessShare } from './readiness-page.mjs'
import { withRun } from './readiness-store.mjs'

const resolve = async () => ({ ok: true, addresses: ['8.8.8.8'] })

const policy = (label) => `<html><body><h1>${label}</h1><p>${`${label} applies to every order shipped from our warehouse. `.repeat(20)}</p></body></html>`

const productPage = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Hat","offers":{"@type":"Offer","price":"20.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><p>Wool hat.</p></body></html>`

function filesOf(extra) {
  return {
    '/': { body: '<html><body><a href="/products/hat">Hat</a><a href="/policies/refund-policy">Returns</a><a href="/policies/shipping-policy">Shipping</a><img src="https://cdn.shopify.com/s.js"></body></html>', headers: { 'content-type': 'text/html' } },
    '/llms.txt': { body: `# Agent Instructions for Example\n\n${'You can browse products. '.repeat(20)}` },
    '/products.json': { body: JSON.stringify({ products: [{ title: 'Hat', handle: 'hat', variants: [{ price: '20.00', available: true }] }] }), headers: { 'content-type': 'application/json' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
    '/products/hat': { body: productPage, headers: { 'content-type': 'text/html' } },
    '/policies/refund-policy': { body: policy('Returns'), headers: { 'content-type': 'text/html' } },
    '/policies/shipping-policy': { body: policy('Shipping'), headers: { 'content-type': 'text/html' } },
    ...extra,
  }
}

function requestFor(files) {
  return async (options) => {
    const url = new URL(options.url)
    if (options.method === 'POST') {
      return { ok: true, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'We can help you shop.' }) }
    }
    if (options.headers?.['cap-from'] === 'agent:cap-check-other') return { ok: true, status: 404, headers: {}, body: '' }
    const file = files[url.pathname]
    if (!file) return { ok: true, status: 404, headers: { 'content-type': 'text/plain' }, body: '' }
    return { ok: true, status: file.status || 200, headers: file.headers || { 'content-type': 'text/plain; charset=utf-8' }, body: file.body }
  }
}

async function score(files) {
  return scoreSite('example.com', { resolve, request: requestFor(files), gapMs: 0 })
}

function byId(result, id) {
  return result.checks.find((check) => check.id === id)
}

test('a Product nested in a graph still counts', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"FAQPage","mainEntity":[{"@type":"Question","acceptedAnswer":{"item":{"@type":"Product","name":"Mattress"}}}]}]}</script>`
  assert.deepEqual(productSchema(html), { product: true, price: false, availability: false })
})

test('a ProductGroup with variant offers counts as product schema', () => {
  const html = `<script type='application/ld+json'>{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"12.00","availability":"https://schema.org/InStock"}}]}</script>`
  assert.deepEqual(productSchema(html), { product: true, price: true, availability: true })
})

test('weights add to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((sum, points) => sum + points, 0), 100)
})

test('robots.txt groups: specific agent beats the wildcard, and Allow wins a tie', () => {
  const text = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\nAllow: /\n'
  assert.equal(robotAllows(text, 'GPTBot'), false)
  assert.equal(robotAllows(text, 'ClaudeBot'), true)
  assert.equal(robotAllows(text, 'PerplexityBot'), true)
  assert.equal(robotAllows('', 'Google-Extended'), true)
  assert.equal(robotAllows('User-agent: *\nDisallow: /private\n', 'GPTBot'), true)
})

test('a store with a template llms.txt and no door scores 61', async () => {
  const result = await score(filesOf())
  assert.equal(result.ok, true)
  assert.equal(result.blocked, false)
  assert.equal(byId(result, 'door').points, 0)
  assert.equal(byId(result, 'llms').points, 6)
  assert.equal(byId(result, 'catalog').points, 20)
  assert.equal(byId(result, 'robots').points, 15)
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.equal(byId(result, 'policies').points, 10)
  assert.equal(result.score, 61)
  assert.match(byId(result, 'llms').fix, /own words/)
})

test('a custom llms.txt is worth the extra 4 points', async () => {
  const result = await score(filesOf({
    '/llms.txt': { body: `# Example Hats\n\n${'Example makes wool hats and ships them from one workshop. '.repeat(12)}` },
  }))
  assert.equal(byId(result, 'llms').points, 10)
  assert.equal(byId(result, 'llms').status, 'pass')
  assert.equal(result.score, 65)
})

test('a browser-rendered store with only a sitemap explains the missing feed', async () => {
  const result = await score({
    '/': { body: '<html><head><script id="__NEXT_DATA__"></script></head><body></body></html>', headers: { 'content-type': 'text/html' } },
    '/products.json': { status: 404, body: '<html>missing</html>', headers: { 'content-type': 'text/html' } },
    '/sitemap.xml': { body: '<urlset><url><loc>https://example.com/products/hat</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    '/products/hat': { body: '<html><body><p>Hat</p></body></html>', headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  const catalog = byId(result, 'catalog')
  assert.equal(catalog.points, 8)
  assert.match(catalog.fix, /Next\.js/)
  assert.match(catalog.fix, /products\.json/)
  assert.equal(byId(result, 'jsonld').points, 0)
})

test('a product sitemap that starts with the homepage is not used as the product page', async () => {
  const result = await score({
    '/': { body: '<html><body><img src="https://cdn.shopify.com/s.js"></body></html>', headers: { 'content-type': 'text/html' } },
    '/products.json': { status: 404, body: 'missing', headers: { 'content-type': 'text/plain' } },
    '/sitemap.xml': { body: '<sitemapindex><sitemap><loc>https://example.com/sitemap_products_1.xml</loc></sitemap></sitemapindex>', headers: { 'content-type': 'application/xml' } },
    '/sitemap_products_1.xml': { body: '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/products/hat</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    '/products/hat': { body: productPage, headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.deepEqual(byId(result, 'jsonld').evidence, ['https://example.com/products/hat'])
})

test('a locale sitemap index still finds a PDP sitemap', async () => {
  const result = await score({
    '/': { body: '<html><body><p>Shop</p></body></html>', headers: { 'content-type': 'text/html' } },
    '/products.json': { status: 404, body: 'no', headers: { 'content-type': 'text/plain' } },
    '/sitemap.xml': { body: '<sitemapindex><sitemap><loc>https://example.com/ca/sitemap.xml</loc></sitemap><sitemap><loc>https://example.com/sitemap_us.xml</loc></sitemap></sitemapindex>', headers: { 'content-type': 'application/xml' } },
    '/sitemap_us.xml': { body: '<sitemapindex><sitemap><loc>https://example.com/sitemap_pdps.xml</loc></sitemap></sitemapindex>', headers: { 'content-type': 'application/xml' } },
    '/sitemap_pdps.xml': { body: '<urlset><url><loc>https://example.com/women/linen-pants</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    '/women/linen-pants': { body: productPage, headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' },
  })
  assert.equal(byId(result, 'catalog').points, 8)
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.deepEqual(byId(result, 'jsonld').evidence, ['https://example.com/women/linen-pants'])
})

test('a font file is not treated as the product page', async () => {
  const result = await score({
    '/': { body: '<html><body><a href="/themes/font.woff2">Font</a><a href="/mattresses/essential">Essential</a><button>Add to cart</button></body></html>', headers: { 'content-type': 'text/html' } },
    '/products.json': { status: 404, body: 'no', headers: { 'content-type': 'text/plain' } },
    '/mattresses/essential': { body: productPage, headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.deepEqual(byId(result, 'jsonld').evidence, ['https://example.com/mattresses/essential'])
})

test('a firewall block is not scored as zero', async () => {
  const result = await score({
    '/': { status: 403, body: '<html>attention required</html>', headers: { 'content-type': 'text/html' } },
    '/agent.txt': { status: 403, body: '<html>attention required</html>', headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\n' },
  })
  assert.equal(result.blocked, true)
  assert.equal(result.checkedMax, WEIGHTS.robots)
  assert.equal(byId(result, 'robots').status, 'fail')
  assert.equal(byId(result, 'robots').points, 0)
  assert.match(byId(result, 'robots').detail, /blocked/)
  assert.equal(byId(result, 'llms').status, 'blocked')
  assert.equal(byId(result, 'catalog').status, 'blocked')
  assert.notEqual(result.checkedMax, 100)
})

test('a site that is not a store skips catalog, schema, and policies', async () => {
  const result = await score({
    '/': { body: '<html><body><h1>Documentation</h1></body></html>', headers: { 'content-type': 'text/html' } },
    '/llms.txt': { body: `# Example\n\n${'These are the docs for the protocol and the door. '.repeat(12)}` },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(byId(result, 'catalog').status, 'na')
  assert.equal(byId(result, 'jsonld').status, 'na')
  assert.equal(byId(result, 'policies').status, 'na')
  assert.equal(result.applicableMax, WEIGHTS.door + WEIGHTS.llms + WEIGHTS.robots)
  assert.equal(result.score, WEIGHTS.llms + WEIGHTS.robots)
})

test('a valid door is worth 35', async () => {
  const result = await score({
    '/': { body: '<html><body><p>Docs</p></body></html>', headers: { 'content-type': 'text/html' } },
    '/agent.txt': { body: 'Protocol: CAP/1.0\nAsk: Ask us.\nCAP: https://example.com/cap/v1\n' },
    '/llms.txt': { body: `# Example\n\n${'These are the docs for the protocol and the door. '.repeat(12)}` },
  })
  assert.equal(byId(result, 'door').status, 'pass')
  assert.equal(byId(result, 'door').points, 35)
  assert.equal(result.score, 35 + 10 + 15)
})

test('one blocked bot is partial credit, not a failed check', async () => {
  const result = await score(filesOf({
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n' },
  }))
  assert.equal(byId(result, 'robots').status, 'partial')
  assert.equal(byId(result, 'robots').points, 11)
})

test('history keeps one run per month', () => {
  const first = withRun(null, { domain: 'example.com', checkedAt: '2026-11-01T00:00:00.000Z', score: 10, checkedMax: 100, applicableMax: 100, blocked: false, checks: [] })
  const second = withRun(first, { domain: 'example.com', checkedAt: '2026-11-15T00:00:00.000Z', score: 20, checkedMax: 100, applicableMax: 100, blocked: false, checks: [] })
  const third = withRun(second, { domain: 'example.com', checkedAt: '2026-12-02T00:00:00.000Z', score: 30, checkedMax: 100, applicableMax: 100, blocked: false, checks: [] })
  assert.equal(second.history.length, 1)
  assert.equal(second.history[0].score, 20)
  assert.deepEqual(third.history.map((run) => run.month), ['2026-11', '2026-12'])
  assert.equal(third.latest.score, 30)
})

test('the score card is a png and the page stays vendor neutral', () => {
  const png = renderScoreCard({ domain: 'allbirds.com', score: 62, checkedMax: 100, blocked: false })
  assert.equal(png[0], 137)
  assert.equal(png[1], 80)
  assert.equal(png.toString('ascii', 1, 4), 'PNG')
  const pages = [readinessPageBody(), readinessMarkdown(), readinessShare({ domain: 'allbirds.com', result: null })]
  for (const html of pages) assert.doesNotMatch(html, /cosmicjs|calendly|leaderboard/i)
})
