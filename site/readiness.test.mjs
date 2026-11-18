import assert from 'node:assert/strict'
import test from 'node:test'
import { ASK_LINE } from './check.mjs'
import { WEIGHTS, productSchema, robotAllows, scoreSite } from './readiness.mjs'
import { renderScoreCard } from './readiness-og.mjs'
import { readinessMarkdown, readinessPageBody, readinessShare } from './readiness-page.mjs'
import { memoryStore, withRun } from './readiness-store.mjs'

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
    const posted = files[`POST ${url.host}${url.pathname}`]
    if (options.method === 'POST' && posted) {
      return { ok: true, status: posted.status || 200, headers: posted.headers || { 'content-type': 'application/json' }, body: posted.body }
    }
    if (options.method === 'POST' && !options.headers?.['cap-version']) {
      return { ok: true, status: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 'invalid_request', message: 'Send CAP-Version and CAP-From.' } }) }
    }
    if (options.method === 'POST') {
      return { ok: true, status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'We can help you shop.' }) }
    }
    if (options.headers?.['cap-from'] === 'agent:cap-check-other') return { ok: true, status: 404, headers: {}, body: '' }
    const file = files[url.host + url.pathname] ?? (url.host === 'example.com' ? files[url.pathname] : undefined)
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
  assert.deepEqual(productSchema(html), { product: true, type: 'Product', price: false, availability: false })
})

test('a ProductGroup with variant offers counts as product schema', () => {
  const html = `<script type='application/ld+json'>{"@type":"ProductGroup","hasVariant":[{"@type":"Product","offers":{"price":"12.00","availability":"https://schema.org/InStock"}}]}</script>`
  assert.deepEqual(productSchema(html), { product: true, type: 'ProductGroup', price: true, availability: true })
})

test('a VacationRental with an offer counts as listing schema', () => {
  const html = `<script type="application/ld+json">{"@type":"VacationRental","name":"Orchard House","containsPlace":{"@type":"Accommodation"},"offers":{"@type":"Offer","price":"240","availability":"https://schema.org/InStock"}}</script>`
  assert.deepEqual(productSchema(html), { product: true, type: 'VacationRental', price: true, availability: true })
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

test('a site that is not a store is scored out of 100 on website checks', async () => {
  const result = await score({
    '/': { body: '<html><body><h1>Documentation</h1></body></html>', headers: { 'content-type': 'text/html' } },
    '/llms.txt': { body: `# Example\n\n${'These are the docs for the protocol and the door. '.repeat(12)}` },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(result.kind, 'site')
  assert.equal(result.applicableMax, 100)
  assert.equal(result.checks.some((check) => check.status === 'na'), false)
  assert.equal(byId(result, 'catalog').title, 'Machine-readable index')
  assert.equal(byId(result, 'catalog').points, 0)
  assert.equal(byId(result, 'jsonld').title, 'Structured data')
  assert.equal(byId(result, 'policies').title, 'Contact and legal pages')
  assert.equal(result.score, WEIGHTS.llms + WEIGHTS.robots)
})

test('a website with a sitemap, feed, schema, and contact and legal pages earns those points', async () => {
  const home = '<html><head><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Example"},{"@type":"SoftwareApplication","name":"Example App"}]}</script></head><body><a href="/contact">Contact</a><a href="/legal/privacy">Privacy</a></body></html>'
  const result = await score({
    '/': { body: home, headers: { 'content-type': 'text/html' } },
    '/blog/rss.xml': { body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title></channel></rss>', headers: { 'content-type': 'application/rss+xml' } },
    '/sitemap.xml': { body: '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/pricing</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    '/contact': { body: policy('Contact'), headers: { 'content-type': 'text/html' } },
    '/legal/privacy': { body: policy('Privacy'), headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(result.kind, 'site')
  assert.equal(byId(result, 'catalog').points, 20)
  assert.match(byId(result, 'catalog').detail, /sitemap lists 2 pages\. An RSS feed is published/)
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.equal(byId(result, 'policies').points, 10)
  assert.equal(result.score, 20 + 15 + 10 + 10)
})

test('a home page that never answers is blocked, not a 0 for a site that sells nothing', async () => {
  const files = filesOf()
  const request = requestFor(files)
  const result = await scoreSite('example.com', {
    resolve,
    gapMs: 0,
    request: async (options) => {
      const path = new URL(options.url).pathname
      if (path === '/' || path === '/robots.txt') return { ok: false, detail: 'The host did not respond in time.' }
      return request(options)
    },
  })
  assert.equal(result.blocked, true)
  assert.equal(result.kind, undefined)
  assert.equal(result.checkedMax, 0)
  for (const id of ['door', 'llms', 'catalog', 'robots', 'jsonld', 'policies']) assert.equal(byId(result, id).status, 'blocked', id)
  assert.match(byId(result, 'llms').detail, /did not answer the checker/)
})

test('a SaaS site with /products/ feature pages is not a store', async () => {
  const pricing = '<html><head><script type="application/ld+json">{"@type":"SoftwareApplication","name":"Observability","offers":{"@type":"Offer","price":"0","availability":"https://schema.org/InStock"}}</script></head><body><p>Observability</p></body></html>'
  const result = await score({
    '/': { body: '<html><body><a href="/products/observability">Observability</a><a href="/products/previews">Previews</a></body></html>', headers: { 'content-type': 'text/html' } },
    '/sitemap.xml': { body: '<urlset><url><loc>https://example.com/products/observability</loc></url><url><loc>https://example.com/products/previews</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    '/products/observability': { body: pricing, headers: { 'content-type': 'text/html' } },
    '/products/previews': { body: pricing, headers: { 'content-type': 'text/html' } },
    '/policies/refund-policy': { body: policy('Not found'), headers: { 'content-type': 'text/html' } },
    '/policies/shipping-policy': { body: policy('Not found'), headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(result.kind, 'site')
  assert.equal(result.applicableMax, 100)
  assert.equal(byId(result, 'catalog').points, 12)
  assert.equal(byId(result, 'jsonld').title, 'Structured data')
  assert.equal(byId(result, 'policies').title, 'Contact and legal pages')
})

test('a software page that also has Product schema is still a store', async () => {
  const result = await score({
    '/': { body: '<html><body><a href="/products/hat">Hat</a></body></html>', headers: { 'content-type': 'text/html' } },
    '/products/hat': { body: productPage.replace('<head>', '<head><script type="application/ld+json">{"@type":"Service","name":"Gift wrap"}</script>'), headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.equal(result.kind, 'shop')
  assert.equal(byId(result, 'catalog').title, 'Structured catalog')
})

test('a valid door is worth 35', async () => {
  const result = await score({
    '/': { body: '<html><body><p>Docs</p></body></html>', headers: { 'content-type': 'text/html' } },
    '/agent.txt': { body: `Protocol: CAP/1.0\nAsk: ${ASK_LINE}\nCAP: https://example.com/cap/v1\n` },
    '/llms.txt': { body: `# Example\n\n${'These are the docs for the protocol and the door. '.repeat(12)}` },
  })
  assert.equal(byId(result, 'door').status, 'pass')
  assert.equal(byId(result, 'door').points, 35)
  assert.equal(result.score, 35 + 10 + 15)
})

const poppyUcp = JSON.stringify({
  protocol_version: '0.4',
  organization: { name: 'Example', domain: 'example.com' },
  agent: { protocols: [{ type: 'ucp', endpoint: 'https://example.com/.well-known/ucp' }] },
})
const ucpProfile = JSON.stringify({
  ucp: { services: { 'dev.ucp.shopping': [{ transport: 'mcp', endpoint: 'https://shop.example.net/api/ucp/mcp' }, { transport: 'embedded' }] } },
})
const toolList = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_cart' }, { name: 'search_catalog' }, { name: 'ask_business' }] } })
const json = { 'content-type': 'application/json' }

test('a Poppy file whose UCP server lists its tools is a whole door', async () => {
  const result = await score(filesOf({
    '/.well-known/poppy.json': { body: poppyUcp, headers: json },
    '/.well-known/ucp': { body: ucpProfile, headers: json },
    'POST shop.example.net/api/ucp/mcp': { body: toolList },
  }))
  const door = byId(result, 'door')
  assert.equal(door.status, 'pass')
  assert.equal(door.points, 35)
  assert.equal(door.protocol, 'Poppy, UCP')
  assert.match(door.detail, /lists 3 tools, including search_catalog, ask_business/)
  assert.equal(result.score, 61 + 35)
})

test('a UCP server that answers as a server-sent event still counts', async () => {
  const result = await score(filesOf({
    '/.well-known/poppy.json': { body: poppyUcp, headers: json },
    '/.well-known/ucp': { body: ucpProfile, headers: json },
    'POST shop.example.net/api/ucp/mcp': { body: `event: message\ndata: ${toolList}\n\n`, headers: { 'content-type': 'text/event-stream' } },
  }))
  assert.equal(byId(result, 'door').points, 35)
})

test('a Poppy file whose UCP server does not answer earns the discovery points', async () => {
  const result = await score(filesOf({
    '/.well-known/poppy.json': { body: poppyUcp, headers: json },
    '/.well-known/ucp': { body: ucpProfile, headers: json },
    'POST shop.example.net/api/ucp/mcp': { status: 401, body: '{}' },
  }))
  const door = byId(result, 'door')
  assert.equal(door.status, 'partial')
  assert.equal(door.points, 15)
  assert.match(door.detail, /HTTP 401/)
})

test('a Poppy file for a protocol the checker cannot call earns the discovery points', async () => {
  const body = JSON.stringify({ protocol_version: '0.3', agent: { protocols: [{ type: 'example.com/chat', endpoint: 'https://example.com/chat' }] } })
  const door = byId(await score(filesOf({ '/.well-known/poppy.json': { body, headers: json } })), 'door')
  assert.equal(door.points, 15)
  assert.equal(door.protocol, 'Poppy, example.com/chat')
})

test('an A2A agent card earns the discovery points', async () => {
  const body = JSON.stringify({ name: 'Example Hats', url: 'https://example.com/a2a' })
  const door = byId(await score(filesOf({ '/.well-known/agent-card.json': { body, headers: json } })), 'door')
  assert.equal(door.points, 15)
  assert.equal(door.protocol, 'A2A')
})

test('a homepage served for every path is not a door', async () => {
  const html = { body: '<html><body>Shop</body></html>', headers: { 'content-type': 'text/html' } }
  const door = byId(await score(filesOf({ '/.well-known/poppy.json': html, '/.well-known/agent-card.json': html })), 'door')
  assert.equal(door.status, 'fail')
  assert.equal(door.points, 0)
})

test('one blocked bot is partial credit, not a failed check', async () => {
  const result = await score(filesOf({
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n' },
  }))
  assert.equal(byId(result, 'robots').status, 'partial')
  assert.equal(byId(result, 'robots').points, 11)
})

test('a return policy linked only from the help center is found there', async () => {
  const result = await score(filesOf({
    '/': { body: '<html><body><a href="/products/hat">Hat</a><a href="https://help.example.com/#top">Help</a><a href="https://help.example.com/en_us/categories/shipping-tracking-x1">Shipping</a><img src="https://cdn.shopify.com/s.js"></body></html>', headers: { 'content-type': 'text/html' } },
    '/policies/refund-policy': { status: 404, body: 'missing', headers: { 'content-type': 'text/html' } },
    'help.example.com/': { body: '<html><body><a href="/en_us/can-i-return-in-store-x2">In store</a><a href="/en_us/categories/returns-x3">Returns</a></body></html>', headers: { 'content-type': 'text/html' } },
    'help.example.com/en_us/can-i-return-in-store-x2': { body: policy('Returns in store'), headers: { 'content-type': 'text/html' } },
    'help.example.com/en_us/categories/shipping-tracking-x1': { body: policy('Shipping'), headers: { 'content-type': 'text/html' } },
  }))
  const policies = byId(result, 'policies')
  assert.equal(policies.points, 10)
  assert.deepEqual(policies.evidence, ['https://help.example.com/en_us/can-i-return-in-store-x2', 'https://help.example.com/en_us/categories/shipping-tracking-x1'])
})

test('a help center that renders in the browser still yields its policy links', async () => {
  const result = await score(filesOf({
    '/': { body: '<html><body><a href="/products/hat">Hat</a><a href="https://help.example.com">Help</a><a href="/policies/shipping-policy">Shipping</a><img src="https://cdn.shopify.com/s.js"></body></html>', headers: { 'content-type': 'text/html' } },
    '/policies/refund-policy': { status: 404, body: 'missing', headers: { 'content-type': 'text/html' } },
    'help.example.com/': { body: '<html><body><div id="root"></div><script>window.__STATE__={&quot;articles&quot;:[{&quot;href&quot;:&quot;/en_us/what-is-your-return-policy-a1&quot;}]}</script></body></html>', headers: { 'content-type': 'text/html' } },
    'help.example.com/en_us/what-is-your-return-policy-a1': { body: policy('Returns'), headers: { 'content-type': 'text/html' } },
  }))
  assert.equal(byId(result, 'policies').points, 10)
  assert.equal(byId(result, 'policies').evidence[0], 'https://help.example.com/en_us/what-is-your-return-policy-a1')
})

test('a guessed policy URL that 404s says no link was found', async () => {
  const result = await score(filesOf({
    '/': { body: '<html><body><a href="/products/hat">Hat</a><a href="/policies/shipping-policy">Shipping</a><img src="https://cdn.shopify.com/s.js"></body></html>', headers: { 'content-type': 'text/html' } },
    '/policies/refund-policy': { status: 404, body: 'missing', headers: { 'content-type': 'text/html' } },
  }))
  const policies = byId(result, 'policies')
  assert.equal(policies.points, 5)
  assert.match(policies.detail, /No return policy link on the home page or llms\.txt, and \/policies\/refund-policy returned HTTP 404/)
})

test('a brand domain that redirects to the store domain scores the store', async () => {
  const store = filesOf()
  const files = { '/': { status: 301, body: '', headers: { location: 'https://shop-example.com/' } } }
  for (const [path, file] of Object.entries(store)) files[`shop-example.com${path}`] = file
  const result = await score(files)
  assert.equal(result.domain, 'example.com')
  assert.equal(result.redirectedTo, 'shop-example.com')
  assert.equal(byId(result, 'catalog').points, 20)
  assert.equal(byId(result, 'policies').points, 10)
  assert.deepEqual(byId(result, 'llms').evidence, ['https://shop-example.com/llms.txt'])
})

test('a vacation rental is a store with a cancellation policy and house rules', async () => {
  const listing = '<html><head><script type="application/ld+json">{"@type":"VacationRental","name":"Orchard House","offers":{"@type":"Offer","price":"240","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><p>Orchard House</p></body></html>'
  const result = await score({
    '/': { body: '<html><body><a href="/stay/orchard-house?checkIn=2026-12-01">Orchard House</a><a href="/cancellation-policy">Cancellation</a><a href="/house-rules">House rules</a></body></html>', headers: { 'content-type': 'text/html' } },
    '/llms.txt': { body: `# Marlow\n\n${'Vacation rentals in Sonoma County, with nightly rates and open dates. '.repeat(8)}` },
    '/products.json': { body: JSON.stringify({ products: [{ title: 'Orchard House', handle: 'orchard-house', url: '/stay/orchard-house', variants: [{ price: '240.00', available: true }] }] }), headers: { 'content-type': 'application/json' } },
    '/stay/orchard-house': { body: listing, headers: { 'content-type': 'text/html' } },
    '/cancellation-policy': { body: policy('Cancellation'), headers: { 'content-type': 'text/html' } },
    '/house-rules': { body: policy('House rules'), headers: { 'content-type': 'text/html' } },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  })
  assert.equal(result.kind, 'rental')
  assert.equal(byId(result, 'catalog').points, 20)
  assert.equal(byId(result, 'jsonld').points, 10)
  assert.equal(byId(result, 'jsonld').title, 'Listing schema')
  assert.deepEqual(byId(result, 'jsonld').evidence, ['https://example.com/stay/orchard-house'])
  assert.equal(byId(result, 'policies').title, 'Cancellation policy and house rules')
  assert.equal(byId(result, 'policies').points, 10)
  assert.equal(result.score, 65)
})

test('www and the bare domain share one stored record', async () => {
  const store = memoryStore()
  await store.put(withRun(null, { domain: 'www.example.com', checkedAt: '2026-11-15T00:00:00.000Z', score: 40, checkedMax: 100, applicableMax: 100, blocked: false, checks: [] }))
  assert.equal((await store.get('example.com')).latest.score, 40)
  assert.equal((await store.get('www.example.com')).domain, 'example.com')
  assert.equal((await store.many(['example.com', 'www.example.com'])).length, 1)
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

test('a refreshed result uses the same page as the inline report', () => {
  const shell = `<!doctype html><html><head><title>Agent readiness · Concierge Agent Protocol</title>
<meta name="description" content="Score a store.">
<meta property="og:title" content="Agent readiness · Concierge Agent Protocol">
<meta property="og:description" content="Score a store.">
<meta property="og:url" content="https://conciergeprotocol.org/readiness">
<meta property="og:image" content="https://example.com/poster.png">
<meta property="og:image:width" content="1920">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="poster">
<meta name="twitter:title" content="Agent readiness · Concierge Agent Protocol">
<meta name="twitter:description" content="Score a store.">
<meta name="twitter:image" content="https://example.com/poster.png">
</head><body><aside class="sidebar" id="site-menu">nav</aside><main id="content"><h1>Agent readiness</h1><form id="readiness-form"></form></main></body></html>`
  const html = readinessShare({
    domain: 'cosmicjs.com',
    result: { score: 95, applicableMax: 100, blocked: false, domain: 'cosmicjs.com', checks: [] },
    shell,
  })
  assert.match(html, /id="site-menu"/)
  assert.match(html, /id="readiness-form"/)
  assert.match(html, /<h1>Agent readiness<\/h1>/)
  assert.doesNotMatch(html, /Check a domain/)
  assert.match(html, /<title>95 agent readiness for cosmicjs.com · Concierge Agent Protocol<\/title>/)
  assert.match(html, /property="og:url" content="https:\/\/conciergeprotocol.org\/readiness\/cosmicjs.com"/)
  assert.match(html, /property="og:image" content="https:\/\/conciergeprotocol.org\/readiness\/og\/cosmicjs.com"/)
  assert.match(html, /id="readiness-result"/)
  assert.match(html, /"cached":true/)
  assert.match(html, /"score":95/)
})
