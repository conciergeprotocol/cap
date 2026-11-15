import { gunzipSync } from 'node:zlib'
import { checkDoor, parseHost, pinnedRequest, resolvePublic } from './check.mjs'

export const VERSION = 1
export const UA = 'CAP-Readiness/1.0 (+https://conciergeprotocol.org/readiness)'
export const WEIGHTS = { door: 35, llms: 10, catalog: 20, robots: 15, jsonld: 10, policies: 10 }
export const ROBOTS = [
  ['GPTBot', 4],
  ['ClaudeBot', 4],
  ['PerplexityBot', 4],
  ['Google-Extended', 3],
]

const PAGE_MAX = 256 * 1024
const BUDGET_MS = 55_000
const GAP_MS = 1000
const POLICY_TEXT = 400

const DOOR_FIX = 'Publish /agent.txt at the site root. The first line is "Protocol: CAP/1.0", then a CAP line with the https endpoint. The endpoint has to answer a public question.'
const LLMS_FIX = 'Publish /llms.txt as plain text that tells an agent what this site sells and where to find products, shipping, and returns.'
const CATALOG_FIX = 'Publish /products.json with a price and availability (in stock or out of stock) on each variant.'
const SCHEMA_FIX = 'Add schema.org Product JSON-LD on product pages, with an Offer that includes price and availability.'
const ROBOTS_FIX = 'In robots.txt, allow GPTBot, ClaudeBot, PerplexityBot, and Google-Extended to fetch /.'

/**
 * Score one public site. `deps.request` and `deps.resolve` match the door checker, so tests can fake the network.
 * File fetches are about one per second. The door question keeps the directory checker's own timing.
 */
export async function scoreSite(input, deps = {}) {
  const resolve = deps.resolve || resolvePublic
  const rawRequest = deps.request || pinnedRequest
  // File reads use the readiness agent. The door question sets its own CAP-Check identity, which wins because it is already on the headers.
  const request = (options) => rawRequest({ ...options, headers: { 'user-agent': UA, ...(options.headers || {}) } })
  const runDoor = deps.checkDoor || checkDoor
  const gap = deps.gapMs ?? GAP_MS
  const host = parseHost(input)
  if (!host.ok) return { ok: false, error: host.detail }
  const found = await resolve(host.hostname)
  if (!found.ok) return { ok: false, error: found.detail }

  const ctx = {
    hostname: host.hostname,
    addresses: found.addresses,
    request,
    resolve,
    deadline: Date.now() + (deps.budgetMs ?? BUDGET_MS),
    gap,
    nextAt: 0,
  }

  const door = scoreDoor(await runDoor(host.hostname, { request, resolve, ask: deps.ask !== false }), host.hostname)
  const home = await fetchText(ctx, '/', 1_000_000)
  if (home.blocked) {
    const robots = await checkRobots(ctx, home)
    return summarize(host.hostname, [
      door.status === 'fail' ? blockedCheck('door', 'CAP door', WEIGHTS.door, home) : door,
      blockedCheck('llms', 'llms.txt', WEIGHTS.llms, home),
      blockedCheck('catalog', 'Structured catalog', WEIGHTS.catalog, home),
      robots,
      blockedCheck('jsonld', 'Product schema', WEIGHTS.jsonld, home),
      blockedCheck('policies', 'Return and shipping policies', WEIGHTS.policies, home),
    ])
  }

  const llms = await checkLlms(ctx)
  const llmsBody = llms.body || ''
  delete llms.body
  const catalog = await checkCatalog(ctx, home)
  const robots = await checkRobots(ctx, home)
  const store = isStore(home, catalog)
  let jsonld = null
  if (store.yes || store.maybe) {
    const schema = await checkJsonld(ctx, catalog, home)
    jsonld = schema.check
    if (store.maybe) store.yes = schema.product || !schema.software
  }
  if (!store.yes) {
    jsonld = notApplicable('jsonld', 'Product schema', WEIGHTS.jsonld, 'This site does not look like a store, so product schema does not apply.')
  }
  const policies = store.yes
    ? await checkPolicies(ctx, home, llmsBody)
    : notApplicable('policies', 'Return and shipping policies', WEIGHTS.policies, 'This site does not look like a store, so return and shipping pages do not apply.')
  if (!store.yes) {
    catalog.check = notApplicable('catalog', 'Structured catalog', WEIGHTS.catalog, 'This site does not look like a store, so a product catalog does not apply.')
  }
  return summarize(host.hostname, [door, llms, catalog.check, robots, jsonld, policies])
}

export function summarize(domain, checks) {
  const applicable = checks.filter((check) => check.status !== 'na')
  const ran = applicable.filter((check) => check.status !== 'blocked')
  const score = ran.reduce((sum, check) => sum + check.points, 0)
  const checkedMax = ran.reduce((sum, check) => sum + check.max, 0)
  const applicableMax = applicable.reduce((sum, check) => sum + check.max, 0)
  return {
    ok: true,
    version: VERSION,
    domain,
    checkedAt: new Date().toISOString(),
    score,
    checkedMax,
    applicableMax,
    max: 100,
    blocked: checks.some((check) => check.status === 'blocked'),
    checks,
  }
}

function scoreDoor(result, hostname) {
  const evidence = [`https://${hostname}/agent.txt`]
  const card = result.checks?.find((check) => check.id === 'card')
  const reply = result.checks?.find((check) => check.id === 'reply')
  const base = { id: 'door', title: 'CAP door', max: WEIGHTS.door, evidence }
  if (card && blockedStatus(card.status)) {
    return { ...base, status: 'blocked', points: 0, detail: card.detail, fix: '' }
  }
  if (card?.pass && reply?.pass) {
    if (result.cap) evidence.push(result.cap)
    return {
      ...base,
      status: 'pass',
      points: WEIGHTS.door,
      evidence,
      detail: `agent.txt is valid and the door answered. ${reply.detail}`,
      fix: '',
    }
  }
  if (card?.pass) {
    if (result.cap) evidence.push(result.cap)
    return {
      ...base,
      status: 'partial',
      points: 15,
      evidence,
      detail: `${card.detail} ${reply?.detail || 'The CAP endpoint did not answer the test question.'}`,
      fix: 'agent.txt is valid. The CAP endpoint still has to answer a public question with status done.',
    }
  }
  return {
    ...base,
    status: 'fail',
    points: 0,
    detail: card?.detail || 'No agent.txt.',
    fix: DOOR_FIX,
  }
}

async function checkLlms(ctx) {
  const evidence = [`https://${ctx.hostname}/llms.txt`]
  const res = await fetchText(ctx, '/llms.txt')
  const base = { id: 'llms', title: 'llms.txt', max: WEIGHTS.llms, evidence }
  if (res.blocked) return { ...base, ...blockedFields(res) }
  const text = (res.text || '').trim()
  if (res.status === 200 && text.length >= 40 && !isHtml(res, text)) {
    const template = /^#\s+Agent Instructions\b/.test(text)
    if (template || text.length < 200) {
      return {
        ...base,
        status: 'partial',
        points: 6,
        detail: template
          ? 'llms.txt is present, but it is the stock "Agent Instructions" template.'
          : 'llms.txt is present, but it is only a short stub.',
        fix: 'Replace it with a page in this brand\'s own words: what it sells, and where products, shipping, and returns are.',
        body: text,
      }
    }
    return { ...base, status: 'pass', points: WEIGHTS.llms, detail: `llms.txt is present (${text.length} characters).`, fix: '', body: text }
  }
  return { ...base, status: 'fail', points: 0, detail: missDetail(res, '/llms.txt'), fix: LLMS_FIX }
}

async function checkCatalog(ctx, home) {
  const url = `https://${ctx.hostname}/products.json?limit=8`
  const res = await fetchText(ctx, url, 1_500_000)
  const evidence = [url]
  const shell = shellKind(home.text)
  const feed = res.blocked ? null : readProducts(res.text)
  if (feed?.handle) {
    let origin = `https://${ctx.hostname}`
    try {
      origin = new URL(res.url).origin
    } catch {
      // Keep the host we were asked to score.
    }
    feed.url = `${origin}/products/${feed.handle}`
  }
  let sitemap = { products: 0, sample: '', truncated: false }
  if (!feed) sitemap = await readSitemap(ctx, home.text)
  if (sitemap.sample) evidence.push(sitemap.sample)

  const check = { id: 'catalog', title: 'Structured catalog', max: WEIGHTS.catalog, evidence }
  if (res.blocked && !sitemap.products) return { check: { ...check, ...blockedFields(res) }, feed: null, sitemap, shell }
  if (feed?.count) {
    const noun = feed.count === 1 ? 'product' : 'products'
    if (feed.hasPrice && feed.hasAvailable) {
      check.status = 'pass'
      check.points = 20
      check.detail = `products.json lists ${feed.count} ${noun} with price and availability.`
      check.fix = ''
    } else if (feed.hasPrice) {
      check.status = 'partial'
      check.points = 14
      check.detail = `products.json lists ${feed.count} ${noun} with a price, and no availability.`
      check.fix = 'Add availability (in stock or out of stock) on each variant in products.json.'
    } else {
      check.status = 'partial'
      check.points = 8
      check.detail = `products.json lists ${feed.count} ${noun}, without prices.`
      check.fix = CATALOG_FIX
    }
    return { check, feed, sitemap, shell }
  }

  const rendered = shell && res.status !== 200
  if (sitemap.products > 0) {
    const kind = shell ? ` The storefront is ${shell} and renders the collection in the browser.` : ''
    return {
      check: {
        ...check,
        status: 'partial',
        points: 8,
        detail: `A sitemap lists ${sitemap.products} product URLs, without price or stock.${kind}`,
        fix: `${shell ? browserFix(shell) : ''} Publish /products.json, or another product feed, that includes price and availability. A list of URLs is 8 of 20.`.trim(),
      },
      feed: null,
      sitemap,
      shell,
    }
  }
  if (rendered || (shell && isHtml(res, res.text || ''))) {
    return {
      check: {
        ...check,
        status: 'fail',
        points: 0,
        detail: `${shell} renders the collection in the browser, and /products.json is not a product feed.`,
        fix: browserFix(shell),
      },
      feed: null,
      sitemap,
      shell,
    }
  }
  return {
    check: { ...check, status: 'fail', points: 0, detail: missDetail(res, '/products.json'), fix: CATALOG_FIX },
    feed: null,
    sitemap,
    shell,
  }
}

function browserFix(shell) {
  const named = shell === 'Next.js' ? 'Next.js renders this collection in the browser' : `This ${shell} storefront renders the collection in the browser`
  return `${named}, and there is no /products.json. An agent that does not run JavaScript cannot see products, prices, or stock. Publish /products.json with price and availability.`
}

async function readSitemap(ctx, homeText) {
  const queue = []
  const seen = new Set()
  const push = (raw, front) => {
    let href
    try {
      href = new URL(raw, `https://${ctx.hostname}/`).href
    } catch {
      return
    }
    if (seen.has(href)) return
    seen.add(href)
    if (front) queue.unshift(href)
    else queue.push(href)
  }
  push('/sitemap.xml')
  if (!ctx.robotsRes) ctx.robotsRes = await fetchText(ctx, '/robots.txt')
  if (ctx.robotsRes.status === 200 && ctx.robotsRes.text && !ctx.robotsRes.blocked) {
    for (const match of ctx.robotsRes.text.matchAll(/^Sitemap:\s*(\S+)/gim)) push(match[1], /product|pdp/i.test(match[1]))
  }

  let fetches = 0
  let best = { products: 0, sample: '', truncated: false }
  while (queue.length && fetches < 5 && best.products === 0) {
    const url = queue.shift()
    const res = await fetchText(ctx, url, 800_000)
    fetches += 1
    if (res.status !== 200 || !res.text || res.blocked || isHtml(res, res.text)) continue
    const all = locs(res.text)
    const indexes = all.filter((loc) => /sitemap|\.xml(\?|$)/i.test(loc))
    if (indexes.length && indexes.length >= all.length - 1) {
      const ranked = indexes.map((loc) => ({ loc, rank: sitemapRank(loc) })).sort((a, b) => a.rank - b.rank)
      for (const item of ranked.slice(0, 4)) push(item.loc, item.rank === 0)
      continue
    }
    const products = all.filter((loc) => isProductLoc(loc, res.url, homeText))
    if (!products.length) continue
    best = {
      products: products.length,
      sample: products.find((loc) => isProductUrl(loc)) || products[0],
      samples: products.slice(0, 3),
      truncated: Boolean(res.truncated),
      source: res.url,
    }
  }
  return best
}

function sitemapRank(url) {
  if (/product|pdp/i.test(url)) return 0
  if (/blog|article|page|image|video|store|collection/i.test(url)) return 5
  if (/_us\.|\/us\/|sitemap_us/i.test(url)) return 1
  try {
    if (/^\/sitemap/i.test(new URL(url).pathname)) return 2
  } catch {
    return 4
  }
  return 3
}

async function checkRobots(ctx, home) {
  const evidence = [`https://${ctx.hostname}/robots.txt`]
  const res = ctx.robotsRes || await fetchText(ctx, '/robots.txt')
  const base = { id: 'robots', title: 'AI crawlers', max: WEIGHTS.robots, evidence }
  if (res.blocked) return { ...base, ...blockedFields(res) }
  const missing = res.status === 404
  const readable = res.status === 200 && res.text && !isHtml(res, res.text)
  if (!missing && !readable) {
    return { ...base, status: 'fail', points: 0, detail: missDetail(res, '/robots.txt'), fix: ROBOTS_FIX }
  }
  const text = readable ? res.text : ''
  const allowed = ROBOTS.map(([agent, points]) => ({ agent, points, ok: robotAllows(text, agent) }))
  const points = allowed.filter((agent) => agent.ok).reduce((sum, agent) => sum + agent.points, 0)
  const names = allowed.filter((agent) => agent.ok).map((agent) => agent.agent)
  const denied = allowed.filter((agent) => !agent.ok).map((agent) => agent.agent)
  if (home?.blocked) {
    const who = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} allowed in robots.txt` : 'robots.txt blocks these agents'
    return {
      ...base,
      status: 'fail',
      points: 0,
      detail: `${who}, but the site blocked ${UA}, so an agent cannot read the pages.`,
      fix: `Allow ${UA} through the firewall. A robots.txt allow does not help while the firewall returns a challenge.`,
    }
  }
  if (!denied.length) {
    return {
      ...base,
      status: 'pass',
      points: WEIGHTS.robots,
      detail: missing ? 'No robots.txt, so these agents are allowed.' : `${names.join(', ')} can fetch /.`,
      fix: '',
    }
  }
  return {
    ...base,
    status: points ? 'partial' : 'fail',
    points,
    detail: `${denied.join(', ')} ${denied.length === 1 ? 'is' : 'are'} blocked in robots.txt.${names.length ? ` Allowed: ${names.join(', ')}.` : ''}`,
    fix: ROBOTS_FIX,
  }
}

export function robotAllows(text, agent) {
  const groups = robotGroups(text)
  const name = agent.toLowerCase()
  const specific = groups.filter((group) => group.agents.includes(name))
  const wildcard = groups.filter((group) => group.agents.includes('*'))
  const chosen = specific.length ? specific : wildcard
  if (!chosen.length) return true
  return pathAllowed(chosen.flatMap((group) => group.rules), '/')
}

function robotGroups(text) {
  const groups = []
  let current = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const match = line.match(/^([^:]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim()
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', path: value })
    }
  }
  return groups
}

function pathAllowed(rules, path) {
  let best = null
  for (const rule of rules) {
    if (!rule.path) continue
    if (!ruleMatches(rule.path, path)) continue
    const better = !best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow && !best.allow)
    if (better) best = { allow: rule.allow, length: rule.path.length }
  }
  return best ? best.allow : true
}

function ruleMatches(rule, path) {
  let pattern = '^'
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i]
    if (ch === '*') pattern += '.*'
    else if (ch === '$' && i === rule.length - 1) pattern += '$'
    else pattern += ch.replace(/[.+?^{}()|[\]\\]/g, '\\$&')
  }
  if (!pattern.endsWith('$')) pattern += '.*'
  return new RegExp(pattern).test(path)
}

async function checkJsonld(ctx, catalog, home) {
  const candidates = [...new Set([catalog.feed?.url, ...productLinks(home), catalog.sitemap?.sample].filter(Boolean))].slice(0, 3)
  const base = { id: 'jsonld', title: 'Product schema', max: WEIGHTS.jsonld, evidence: candidates.slice(0, 1) }
  if (!candidates.length) {
    return { check: { ...base, status: 'fail', points: 0, detail: 'No product page URL to inspect.', fix: SCHEMA_FIX }, product: false, software: false }
  }
  let last = null
  let product = false
  let software = false
  for (const productUrl of candidates) {
    const res = await fetchText(ctx, productUrl, 2_500_000)
    const card = { ...base, evidence: [productUrl] }
    if (res.blocked) return { check: { ...card, ...blockedFields(res) }, product, software }
    if (res.status !== 200 || !res.text) {
      last = { ...card, status: 'fail', points: 0, detail: missDetail(res, 'the product page'), fix: SCHEMA_FIX }
      continue
    }
    const found = productSchema(res.text)
    product ||= found.product
    software ||= SOFTWARE_TYPE.test(res.text)
    const scored = schemaCard(card, found)
    if (scored.points) return { check: scored, product, software }
    last = scored
  }
  return { check: last, product, software }
}

function schemaCard(base, found) {
  let points = 0
  const parts = []
  if (found.product) {
    points += 4
    parts.push('Product')
  }
  if (found.price) {
    points += 3
    parts.push('price')
  }
  if (found.availability) {
    points += 3
    parts.push('availability')
  }
  if (points === 10) return { ...base, status: 'pass', points, detail: `Product JSON-LD includes ${parts.join(', ')}.`, fix: '' }
  return {
    ...base,
    status: points ? 'partial' : 'fail',
    points,
    detail: points ? `Product JSON-LD includes ${parts.join(', ')}.` : 'No Product JSON-LD on the product page.',
    fix: SCHEMA_FIX,
  }
}

async function checkPolicies(ctx, home, llmsBody) {
  const pool = [
    ...markdownLinks(llmsBody, `https://${ctx.hostname}/`),
    ...htmlLinks(home.text, home.url || `https://${ctx.hostname}/`),
  ]
  const returns = choosePolicy(pool, ctx.hostname, 'return') || `https://${ctx.hostname}/policies/refund-policy`
  const shipping = choosePolicy(pool, ctx.hostname, 'shipping') || `https://${ctx.hostname}/policies/shipping-policy`
  const returnPage = await fetchText(ctx, returns, 600_000)
  const shippingPage = shipping === returns ? returnPage : await fetchText(ctx, shipping, 600_000)
  if (returnPage.blocked && shippingPage.blocked) {
    return {
      id: 'policies',
      title: 'Return and shipping policies',
      max: WEIGHTS.policies,
      evidence: [returns, shipping],
      ...blockedFields(returnPage),
    }
  }
  const returnScore = scorePolicy(returnPage, 'return')
  const shippingScore = scorePolicy(shippingPage, 'shipping')
  const points = returnScore.points + shippingScore.points
  const evidence = [returnPage.url || returns, shippingPage.url || shipping].filter((url, index, all) => all.indexOf(url) === index)
  const fixes = [returnScore.fix, shippingScore.fix].filter(Boolean)
  return {
    id: 'policies',
    title: 'Return and shipping policies',
    max: WEIGHTS.policies,
    points,
    status: points === 10 ? 'pass' : points ? 'partial' : 'fail',
    evidence,
    detail: `${returnScore.detail} ${shippingScore.detail}`,
    fix: fixes.join(' '),
  }
}

function scorePolicy(res, kind) {
  const label = kind === 'return' ? 'Return policy' : 'Shipping policy'
  if (res.blocked) return { points: 0, detail: `${label} could not be checked: the site blocked the request.`, fix: '' }
  const text = visibleText(res.text || '', res.headers)
  if (res.status === 200 && text.length >= POLICY_TEXT) {
    return { points: 5, detail: `${label} resolves and has text an agent can read.`, fix: '' }
  }
  if (res.status === 200) {
    return {
      points: 0,
      detail: `${label} URL responds, but there is almost no text on it.`,
      fix: `Publish the ${label.toLowerCase()} as real text, not an empty page that only renders in the browser.`,
    }
  }
  return {
    points: 0,
    detail: `${label} does not resolve (${res.status || 'no response'}).`,
    fix: kind === 'return'
      ? 'Publish a return policy at a stable https URL, such as /policies/refund-policy, and link it from the site.'
      : 'Publish a shipping policy at a stable https URL, such as /policies/shipping-policy, and link it from the site.',
  }
}

function choosePolicy(links, hostname, kind) {
  const re = kind === 'return' ? /return|refund|exchange/i : /shipping|delivery/i
  return links.find((url) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' && relatedHost(parsed.hostname, hostname) && re.test(parsed.pathname) && !/\.(js|css|png|jpe?g|svg|gif|webp)$/i.test(parsed.pathname)
    } catch {
      return false
    }
  })
}

// A product URL pattern alone is weak: SaaS sites use /products/ for feature pages.
// It counts unless the sampled page declares software or a service and no Product.
const SITEMAP_CATALOG = 10
const SOFTWARE_TYPE = /"@type"\s*:\s*\[?\s*"(?:https?:\/\/schema\.org\/)?(?:SoftwareApplication|WebApplication|MobileApplication|Service)"/

function isStore(home, catalog) {
  if (catalog.check?.status === 'blocked') return { yes: true }
  if (catalog.feed?.count) return { yes: true }
  if (catalog.sitemap?.products >= SITEMAP_CATALOG) return { yes: true }
  const html = home.text || ''
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/.test(html)) return { yes: true }
  if (/"@type"\s*:\s*"Product/.test(html)) return { yes: true }
  if (/add to cart|add to bag/i.test(html)) return { yes: true }
  if (catalog.sitemap?.products > 0) return { yes: false, maybe: true }
  if (/href\s*=\s*["'][^"']*\/(?:products|collections)\//i.test(html)) return { yes: false, maybe: true }
  return { yes: false }
}

export function productSchema(html) {
  const found = { product: false, price: false, availability: false }
  const blocks = [...String(html || '').matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    let data
    try {
      data = JSON.parse(block[1].trim())
    } catch {
      continue
    }
    for (const node of flattenNodes(data)) noteProduct(node, found, new Set())
  }
  return found
}

function noteProduct(node, found, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    for (const item of node) noteProduct(item, found, seen)
    return
  }
  if (typesOf(node).some((type) => /(^|\/)Product(Group)?$/i.test(type))) found.product = true
  for (const offer of offersOf(node)) {
    if (offer.price != null && offer.price !== '') found.price = true
    const spec = offer.priceSpecification
    const specs = Array.isArray(spec) ? spec : spec ? [spec] : []
    if (specs.some((item) => item?.price != null && item.price !== '')) found.price = true
    if (offer.availability) found.availability = true
  }
  for (const value of Object.values(node)) noteProduct(value, found, seen)
}

function flattenNodes(value, out = []) {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach((item) => flattenNodes(item, out))
    return out
  }
  out.push(value)
  if (value['@graph']) flattenNodes(value['@graph'], out)
  return out
}

function typesOf(node) {
  const value = node['@type']
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map(String)
}

function offersOf(node) {
  if (!node.offers) return []
  return Array.isArray(node.offers) ? node.offers : [node.offers]
}

function readProducts(text) {
  const data = parseProducts(text)
  if (!data) return null
  const products = Array.isArray(data?.products) ? data.products : null
  if (!products?.length) return null
  let hasPrice = false
  let hasAvailable = false
  for (const product of products) {
    const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [product]
    for (const variant of variants) {
      if (variant?.price != null && variant.price !== '') hasPrice = true
      if (typeof variant?.available === 'boolean') hasAvailable = true
    }
  }
  const handle = products.find((product) => product?.handle)?.handle
  return { count: products.length, hasPrice, hasAvailable, url: '' , handle }
}

function parseProducts(text) {
  const raw = String(text || '')
  try {
    return JSON.parse(raw)
  } catch {
    // A long Shopify feed can be cut off mid-product. Keep the objects that finished.
    const marker = raw.lastIndexOf('},{')
    if (!raw.startsWith('{"products"') || marker < 0) return null
    try {
      return JSON.parse(`${raw.slice(0, marker + 1)}]}`)
    } catch {
      return null
    }
  }
}

function productLinks(home) {
  const links = htmlLinks(home.text, home.url || '')
  const found = []
  const add = (url) => {
    if (url && !found.includes(url)) found.push(url)
  }
  for (const url of links) if (isProductUrl(url)) add(url)
  if (/add to cart|add to bag/i.test(home.text || '')) {
    for (const url of links) if (isCommercePath(url)) add(url)
  }
  return found.slice(0, 3)
}

function isProductUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (/sitemap|\.xml$/.test(path)) return false
    return /\/products?\//.test(path) || /\/p\//.test(path) || /\/pdps?\//.test(path)
  } catch {
    return false
  }
}

function isProductLoc(url, source, homeText) {
  if (isProductUrl(url)) return true
  if (/add to cart|add to bag/i.test(homeText || '') && isCommercePath(url)) return true
  if (!/product|pdp/i.test(source || '')) return false
  try {
    const path = new URL(url).pathname
    if (path === '/' || path === '') return false
    if (/sitemap|\.xml(\?|$)/i.test(path)) return false
    if (/\/(pages|blogs|collections|policies|account|cart|search|apps|stores)\//i.test(path)) return false
    return true
  } catch {
    return false
  }
}

function isCommercePath(url) {
  try {
    const path = new URL(url).pathname
    const segments = path.split('/').filter(Boolean)
    if (segments.length < 2) return false
    if (/^(blog|blogs|pages|policies|account|cart|search|help|support|stores|apps|themes|sites|assets|static|fonts|wp-content|wp-includes|_next|cdn-cgi|form|jfe|hc|overview)$/i.test(segments[0])) return false
    if (segments.length > 2 && segments[segments.length - 1] === 'new') return false
    if (/\.(js|mjs|css|png|jpe?g|svg|gif|webp|pdf|woff2?|ttf|eot|ico|map)$/i.test(path)) return false
    return true
  } catch {
    return false
  }
}

function locs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => match[1].trim().replace(/&amp;/g, '&'))
}

function shellKind(html) {
  const text = html || ''
  if (/__NEXT_DATA__|\/_next\/static|id=["']__next["']/.test(text)) return 'Next.js'
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/.test(text)) return 'Shopify'
  return ''
}

export function isChallenge(status, headers, text) {
  if (status === 401 || status === 403 || status === 429) return true
  const type = headerValue(headers, 'content-type')
  if ((status === 200 || status === 503) && /html/i.test(type) && /vercel security checkpoint|cf-browser-verification|cf-challenge|just a moment|attention required|captcha-delivery|akamai-ghost/i.test(text || '')) {
    return true
  }
  return false
}

function blockedStatus(status) {
  return status === 401 || status === 403 || status === 429
}

function blockedFields(res) {
  return {
    status: 'blocked',
    points: 0,
    detail: `Bot protection stopped this check${res.status ? ` (HTTP ${res.status})` : ''}. It is not scored as a failure.`,
    fix: '',
  }
}

function blockedCheck(id, title, max, res) {
  return { id, title, max, evidence: res?.url ? [res.url] : [], ...blockedFields(res || {}) }
}

function notApplicable(id, title, max, detail) {
  return { id, title, max, points: 0, status: 'na', evidence: [], detail, fix: '' }
}

function missDetail(res, label) {
  if (!res?.ok && res?.error) return res.error
  if (res?.status) return `${label} returned HTTP ${res.status}.`
  return `${label} did not respond.`
}

function isHtml(res, text) {
  if (/text\/html/i.test(headerValue(res?.headers, 'content-type'))) return true
  return /^\s*<(!doctype|html)\b/i.test(text || '')
}

function visibleText(body, headers) {
  const type = headerValue(headers, 'content-type')
  if (/json|xml/i.test(type)) return ''
  if (!/html/i.test(type) && !/^\s*</.test(body)) return body.replace(/\s+/g, ' ').trim()
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function htmlLinks(html, base) {
  const links = []
  for (const match of String(html || '').matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    try {
      links.push(new URL(match[1] || match[2], base).href)
    } catch {
      // Skip malformed hrefs.
    }
  }
  return links
}

function markdownLinks(text, base) {
  const links = []
  for (const match of String(text || '').matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)) links.push(match[1])
  for (const match of String(text || '').matchAll(/(https?:\/\/[^\s)]+)/gi)) {
    try {
      links.push(new URL(match[1], base).href)
    } catch {
      // Skip malformed URLs.
    }
  }
  return links
}

async function fetchText(ctx, pathOrUrl, maxBytes = PAGE_MAX) {
  let url
  try {
    url = new URL(pathOrUrl, `https://${ctx.hostname}/`)
  } catch {
    return { ok: false, error: 'The URL could not be read.', status: 0, text: '', headers: {}, blocked: false, url: '' }
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'The check only fetches https URLs.', status: 0, text: '', headers: {}, blocked: false, url: url.href }
  let addresses = relatedHost(url.hostname, ctx.hostname) && url.hostname === ctx.hostname ? ctx.addresses : null
  for (let hop = 0; hop < 4; hop++) {
    if (!addresses) {
      const found = await ctx.resolve(url.hostname)
      if (!found.ok) return { ok: false, error: found.detail, status: 0, text: '', headers: {}, blocked: false, url: url.href }
      addresses = found.addresses
    }
    const wait = ctx.nextAt - Date.now()
    if (wait > 0) await sleep(wait)
    ctx.nextAt = Date.now() + ctx.gap
    if (ctx.deadline - Date.now() < 500) {
      return { ok: false, error: 'The check ran out of time.', status: 0, text: '', headers: {}, blocked: false, url: url.href }
    }
    const res = await ctx.request({
      url: url.href,
      method: 'GET',
      addresses,
      headers: { 'user-agent': UA, accept: 'text/html,application/json,text/plain,application/xml;q=0.9,*/*;q=0.8', 'accept-encoding': 'identity' },
      timeoutMs: Math.min(8_000, ctx.deadline - Date.now()),
      maxBytes,
      truncate: true,
      binary: true,
    })
    if (!res?.ok) return { ok: false, error: res?.detail || 'The host did not respond in time.', status: 0, text: '', headers: {}, blocked: false, url: url.href }
    if (res.status >= 300 && res.status < 400) {
      const next = redirectTarget(res.headers, url.href, ctx.hostname)
      if (!next) return { ok: false, error: 'The page redirected off this site.', status: res.status, text: '', headers: res.headers, blocked: false, url: url.href }
      url = next
      addresses = null
      continue
    }
    const text = asText(res.body)
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      text,
      url: url.href,
      truncated: Boolean(res.truncated),
      blocked: isChallenge(res.status, res.headers, text),
    }
  }
  return { ok: false, error: 'The page redirected too many times.', status: 0, text: '', headers: {}, blocked: false, url: url.href }
}

function redirectTarget(headers, from, entered) {
  let next
  try {
    next = new URL(headerValue(headers, 'location'), from)
  } catch {
    return null
  }
  if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443')) return null
  if (!relatedHost(next.hostname, entered)) return null
  next.hash = ''
  return next
}

function relatedHost(a, b) {
  const bare = (host) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  const left = bare(a)
  const right = bare(b)
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function asText(body) {
  if (body == null) return ''
  if (typeof body === 'string') return body
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString('utf8')
    } catch {
      return buf.toString('utf8')
    }
  }
  return buf.toString('utf8')
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value.join(', ')
  return value || ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
