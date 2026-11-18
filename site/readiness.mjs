import { isIP } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { checkDoor, parseHost, pinnedRequest, resolvePublic } from './check.mjs'

export const VERSION = 3
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

const DOOR_FIX = 'Publish an agent door: /agent.txt for CAP (first line "Protocol: CAP/1.0", then a CAP line with the https endpoint), /.well-known/poppy.json, or an A2A /.well-known/agent-card.json. Full points need the endpoint to answer: a CAP door answers a public question, and a UCP door\'s MCP server lists its tools.'
const DOOR_TITLE = 'Agent door'
const DISCOVERY_POINTS = 15
const LLMS_FIX = 'Publish /llms.txt as plain text that tells an agent what this site offers and where to find the pages that matter, such as products, pricing, docs, or policies.'
const CATALOG_FIX = 'Publish /products.json with a price and availability (in stock or out of stock) on each variant.'
const RENTAL_CATALOG_FIX = 'Publish /products.json with one entry per listing: its URL, the nightly price, and whether it has open dates.'
const SCHEMA_FIX = 'Add schema.org Product JSON-LD on product pages, with an Offer that includes price and availability.'
const RENTAL_SCHEMA_FIX = 'Add schema.org VacationRental or LodgingBusiness JSON-LD on each listing page, with an Offer that includes the nightly price and availability.'
const SITEMAP_FIX = 'Publish /sitemap.xml listing the pages that matter, and reference it from robots.txt.'
const FEED_FIX = 'Publish a machine-readable source an agent can read in one request: an RSS or Atom feed for articles, an OpenAPI spec for an API, or /llms-full.txt with the full text of the key pages.'
const SITE_SCHEMA_FIX = 'Add schema.org JSON-LD to the home page: Organization (or a LocalBusiness type) for who runs the site, and a type for what it offers, such as SoftwareApplication, Service, Product, Course, Event, or Article.'

// What each kind of site has to publish. A store is asked for returns and shipping, a rental for its cancellation policy and house rules, and any other site for a contact page and its privacy policy or terms.
const POLICY_KINDS = {
  site: {
    title: 'Contact and legal pages',
    first: { label: 'Contact page', match: /contact|about|support/i, guess: '/contact' },
    second: { label: 'Privacy policy or terms', match: /privacy|terms|legal/i, guess: '/privacy' },
  },
  shop: {
    title: 'Return and shipping policies',
    first: { label: 'Return policy', match: /return|refund|exchange/i, guess: '/policies/refund-policy' },
    second: { label: 'Shipping policy', match: /shipping|delivery/i, guess: '/policies/shipping-policy' },
  },
  rental: {
    title: 'Cancellation policy and house rules',
    first: { label: 'Cancellation policy', match: /cancel|refund/i, guess: '/cancellation-policy' },
    second: { label: 'House rules', match: /house-rules|rules|booking-terms|rental-terms|terms/i, guess: '/house-rules' },
  },
}
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

  // A brand domain can redirect to the domain the store runs on, such as vuori.com to vuoriclothing.com. Score the store.
  const home = await fetchText(ctx, '/', 1_000_000, { anyHost: true })
  const landed = hostOf(home.url)
  let movedTo = ''
  if (landed && !relatedHost(landed, ctx.hostname)) {
    const moved = await resolve(landed)
    if (!moved.ok) return { ok: false, error: `${host.hostname} redirects to ${landed}. ${moved.detail}` }
    ctx.hostname = landed
    ctx.addresses = moved.addresses
    movedTo = landed
  }
  const finish = (checks, kind) => {
    const result = summarize(host.hostname, checks, kind)
    if (movedTo) result.redirectedTo = movedTo
    return result
  }

  let door = scoreDoor(await runDoor(ctx.hostname, { request, resolve, ask: deps.ask !== false }), ctx.hostname)
  if (door.status !== 'pass' && door.status !== 'blocked') {
    const other = await checkOtherDoors(ctx)
    if (other && other.points > door.points) door = other
  }
  // Without the home page nothing else can be judged, including what kind of site this is. Bot protection often stalls instead of answering 403.
  if (home.blocked || !home.ok) {
    const wall = home.blocked ? home : { ...home, dropped: true }
    const robots = await checkRobots(ctx, wall)
    return finish([
      door.status === 'fail' ? blockedCheck('door', DOOR_TITLE, WEIGHTS.door, wall) : door,
      blockedCheck('llms', 'llms.txt', WEIGHTS.llms, wall),
      blockedCheck('catalog', 'Catalog or index', WEIGHTS.catalog, wall),
      robots,
      blockedCheck('jsonld', 'Structured data', WEIGHTS.jsonld, wall),
      blockedCheck('policies', 'Key pages', WEIGHTS.policies, wall),
    ])
  }

  const llms = await checkLlms(ctx)
  const llmsBody = llms.body || ''
  delete llms.body
  const catalog = await checkCatalog(ctx, home)
  const robots = await checkRobots(ctx, home)
  const sells = sellsWhat(home, catalog)
  let kind = 'site'
  let jsonld = null
  if (sells.kind) {
    const schema = await checkJsonld(ctx, catalog, home)
    if (!sells.maybe || schema.product || !schema.software) {
      kind = schema.lodging ? 'rental' : sells.kind
      jsonld = schema.check
    }
  }
  if (kind === 'site') {
    catalog.check = await checkSiteIndex(ctx, home, llmsBody, catalog.sitemap)
    jsonld = checkSiteSchema(home)
  } else if (kind === 'rental') {
    if (catalog.check.fix === CATALOG_FIX) catalog.check.fix = RENTAL_CATALOG_FIX
    if (jsonld.fix === SCHEMA_FIX) jsonld.fix = RENTAL_SCHEMA_FIX
    jsonld.title = 'Listing schema'
  }
  const policies = await checkPolicies(ctx, home, llmsBody, kind)
  return finish([door, llms, catalog.check, robots, jsonld, policies], kind)
}

export function summarize(domain, checks, kind) {
  const ran = checks.filter((check) => check.status !== 'blocked')
  const score = ran.reduce((sum, check) => sum + check.points, 0)
  const checkedMax = ran.reduce((sum, check) => sum + check.max, 0)
  const applicableMax = checks.reduce((sum, check) => sum + check.max, 0)
  return {
    ok: true,
    version: VERSION,
    domain,
    checkedAt: new Date().toISOString(),
    ...(kind ? { kind } : {}),
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
  const base = { id: 'door', title: DOOR_TITLE, max: WEIGHTS.door, evidence }
  if (card && blockedStatus(card.status)) {
    return { ...base, status: 'blocked', points: 0, detail: card.detail, fix: '' }
  }
  if (card?.pass && reply?.pass) {
    if (result.cap) evidence.push(result.cap)
    return {
      ...base,
      protocol: 'CAP',
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
      protocol: 'CAP',
      status: 'partial',
      points: DISCOVERY_POINTS,
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

// A door in another protocol earns the discovery points for its file, and the whole door when the checker can call its endpoint.
async function checkOtherDoors(ctx) {
  return (await checkPoppy(ctx)) || (await checkAgentCard(ctx))
}

const PROTOCOL_NAMES = { ucp: 'UCP', cap: 'CAP', 'conciergeprotocol.org/cap': 'CAP', a2a: 'A2A', mcp: 'MCP' }
const UNCALLED_FIX = 'The other 20 points need an endpoint the checker can call today: a CAP door, or UCP with an MCP server.'

async function checkPoppy(ctx) {
  const url = `https://${ctx.hostname}/.well-known/poppy.json`
  const doc = await fetchJson(ctx, url)
  const protocols = Array.isArray(doc?.agent?.protocols) ? doc.agent.protocols.filter((entry) => typeof entry?.type === 'string') : []
  if (typeof doc?.protocol_version !== 'string' || !protocols.length) return null
  const names = [...new Set(protocols.map((entry) => PROTOCOL_NAMES[entry.type.toLowerCase()] || entry.type))]
  const version = `poppy.json (version ${doc.protocol_version})`
  const base = { id: 'door', title: DOOR_TITLE, max: WEIGHTS.door, evidence: [url], protocol: `Poppy, ${names.join(', ')}` }
  const ucp = protocols.find((entry) => entry.type.toLowerCase() === 'ucp' && typeof entry.endpoint === 'string')
  if (!ucp) {
    return {
      ...base,
      status: 'partial',
      points: DISCOVERY_POINTS,
      detail: `${version} lists ${names.join(', ')}. The checker cannot call that protocol yet, so the file earns the discovery points.`,
      fix: UNCALLED_FIX,
    }
  }
  const live = await checkUcp(ctx, ucp.endpoint)
  base.evidence.push(...live.evidence)
  if (live.ok) {
    return {
      ...base,
      status: 'pass',
      points: WEIGHTS.door,
      detail: `${version} points agents at UCP, and its MCP server lists ${live.count} tools, including ${live.names}.`,
      fix: '',
    }
  }
  return {
    ...base,
    status: 'partial',
    points: DISCOVERY_POINTS,
    detail: `${version} points agents at UCP, but ${live.detail}`,
    fix: 'The UCP profile has to list an MCP endpoint that answers tools/list.',
  }
}

async function checkUcp(ctx, endpoint) {
  let profileUrl
  try {
    profileUrl = new URL(endpoint, `https://${ctx.hostname}/`).href
  } catch {
    return { ok: false, evidence: [], detail: 'its endpoint is not a URL.' }
  }
  const profile = await fetchJson(ctx, profileUrl)
  const services = Object.values(profile?.ucp?.services || {}).flat()
  const mcp = services.find((service) => service?.transport === 'mcp' && typeof service.endpoint === 'string')
  if (!mcp) return { ok: false, evidence: [profileUrl], detail: `${profileUrl} lists no MCP endpoint.` }
  return { ...(await mcpTools(ctx, mcp.endpoint)), evidence: [profileUrl, mcp.endpoint] }
}

const TOOL_NAMES_FIRST = ['search_catalog', 'ask_business', 'create_checkout']

async function mcpTools(ctx, endpoint) {
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, detail: 'its MCP endpoint is not a URL.' }
  }
  if (url.protocol !== 'https:') return { ok: false, detail: 'its MCP endpoint is not https.' }
  const found = await ctx.resolve(url.hostname)
  if (!found.ok) return { ok: false, detail: found.detail }
  if (!(await pace(ctx))) return { ok: false, detail: 'the check ran out of time before calling its MCP server.' }
  const res = await ctx.request({
    url: url.href,
    method: 'POST',
    addresses: found.addresses,
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    timeoutMs: Math.min(8_000, ctx.deadline - Date.now()),
    maxBytes: 1_000_000,
    truncate: true,
  })
  if (!res?.ok) return { ok: false, detail: `its MCP server did not respond (${(res?.detail || 'no response').replace(/\.$/, '')}).` }
  if (res.status !== 200) return { ok: false, detail: `its MCP server returned HTTP ${res.status} to tools/list.` }
  const tools = readRpc(asText(res.body), headerValue(res.headers, 'content-type'))?.result?.tools
  if (!Array.isArray(tools) || !tools.length) return { ok: false, detail: 'its MCP server listed no tools.' }
  const all = tools.map((tool) => tool?.name).filter((name) => typeof name === 'string')
  const names = [...TOOL_NAMES_FIRST.filter((name) => all.includes(name)), ...all].filter((name, index, list) => list.indexOf(name) === index).slice(0, 3)
  return { ok: true, count: tools.length, names: names.join(', ') }
}

// Streamable HTTP servers can answer a single request as JSON or as one server-sent event.
function readRpc(text, type) {
  const body = /event-stream/i.test(type)
    ? text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
    : text
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function checkAgentCard(ctx) {
  const url = `https://${ctx.hostname}/.well-known/agent-card.json`
  const card = await fetchJson(ctx, url)
  if (typeof card?.name !== 'string' || !(typeof card.url === 'string' || Array.isArray(card.supportedInterfaces))) return null
  return {
    id: 'door',
    title: DOOR_TITLE,
    max: WEIGHTS.door,
    evidence: [url],
    protocol: 'A2A',
    status: 'partial',
    points: DISCOVERY_POINTS,
    detail: `An A2A agent card names ${card.name}. The checker cannot call A2A yet, so the card earns the discovery points.`,
    fix: UNCALLED_FIX,
  }
}

async function fetchJson(ctx, url) {
  const res = await fetchText(ctx, url, 1_000_000)
  if (res.status !== 200 || res.blocked || res.truncated || !res.text || isHtml(res, res.text)) return null
  try {
    return JSON.parse(res.text)
  } catch {
    return null
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
        fix: 'Replace it with a page in this site\'s own words: what it offers, and where an agent finds the pages that matter.',
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
  if (feed?.link) {
    try {
      const link = new URL(feed.link, res.url || `https://${ctx.hostname}/`)
      if (link.protocol === 'https:' && relatedHost(link.hostname, ctx.hostname)) feed.url = link.href
    } catch {
      // Fall back to the handle.
    }
  }
  if (!feed?.url && feed?.handle) {
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
  const pages = { count: 0, url: '' }
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
    if (all.length > pages.count) {
      pages.count = all.length
      pages.url = res.url
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
  return { ...best, pages: pages.count, pagesUrl: pages.url }
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
  if (home?.dropped && !res.ok) return { ...base, ...blockedFields(home) }
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
  if (home?.blocked || home?.dropped) {
    const who = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} allowed in robots.txt` : 'robots.txt blocks these agents'
    return {
      ...base,
      status: 'fail',
      points: 0,
      detail: `${who}, but the site ${home.dropped ? 'did not answer' : 'blocked'} ${UA}, so an agent cannot read the pages.`,
      fix: `Allow ${UA} through the firewall. A robots.txt allow does not help while the firewall ${home.dropped ? 'stalls automated requests' : 'returns a challenge'}.`,
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
    return { check: { ...base, status: 'fail', points: 0, detail: 'No product page URL to inspect.', fix: SCHEMA_FIX }, product: false, software: false, lodging: false }
  }
  let last = null
  let product = false
  let software = false
  let lodging = false
  for (const productUrl of candidates) {
    const res = await fetchText(ctx, productUrl, 2_500_000)
    const card = { ...base, evidence: [productUrl] }
    if (res.blocked) return { check: { ...card, ...blockedFields(res) }, product, software, lodging }
    if (res.status !== 200 || !res.text) {
      last = { ...card, status: 'fail', points: 0, detail: missDetail(res, 'the product page'), fix: SCHEMA_FIX }
      continue
    }
    const found = productSchema(res.text)
    product ||= found.product
    lodging ||= LODGING.test(found.type || '')
    software ||= SOFTWARE_TYPE.test(res.text)
    const scored = schemaCard(card, found)
    if (scored.points) return { check: scored, product, software, lodging }
    last = scored
  }
  return { check: last, product, software, lodging }
}

function schemaCard(base, found) {
  let points = 0
  const parts = []
  if (found.product) {
    points += 4
    parts.push(found.type && !/Product/.test(found.type) ? found.type : 'Product')
  }
  if (found.price) {
    points += 3
    parts.push('price')
  }
  if (found.availability) {
    points += 3
    parts.push('availability')
  }
  const noun = LODGING.test(found.type || '') ? 'Listing' : 'Product'
  if (points === 10) return { ...base, status: 'pass', points, detail: `${noun} JSON-LD includes ${parts.join(', ')}.`, fix: '' }
  return {
    ...base,
    status: points ? 'partial' : 'fail',
    points,
    detail: points ? `${noun} JSON-LD includes ${parts.join(', ')}.` : 'No Product JSON-LD on the product page.',
    fix: SCHEMA_FIX,
  }
}

// A site that does not sell from a catalog earns the catalog points with an index of its pages (12) and one source an agent can read in a single request (8).
async function checkSiteIndex(ctx, home, llmsBody, sitemap) {
  const base = { id: 'catalog', title: 'Machine-readable index', max: WEIGHTS.catalog, evidence: [] }
  const parts = []
  const fixes = []
  let points = 0
  if (sitemap?.pages) {
    points += 12
    base.evidence.push(sitemap.pagesUrl)
    parts.push(`A sitemap lists ${sitemap.pages}${sitemap.truncated ? '+' : ''} ${sitemap.pages === 1 ? 'page' : 'pages'}.`)
  } else {
    parts.push('No sitemap with page URLs.')
    fixes.push(SITEMAP_FIX)
  }
  const feed = await findFeed(ctx, home, llmsBody)
  if (feed) {
    points += 8
    base.evidence.push(feed.url)
    parts.push(`${feed.label} is published.`)
  } else {
    parts.push('No feed, API spec, or llms-full.txt.')
    fixes.push(FEED_FIX)
  }
  return { ...base, status: points === WEIGHTS.catalog ? 'pass' : points ? 'partial' : 'fail', points, detail: parts.join(' '), fix: fixes.join(' ') }
}

async function findFeed(ctx, home, llmsBody) {
  const base = home.url || `https://${ctx.hostname}/`
  const candidates = []
  for (const tag of String(home.text || '').match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*["']?alternate\b/i.test(tag)) continue
    const type = tag.match(/\btype\s*=\s*["']?application\/(rss\+xml|atom\+xml|feed\+json)["'\s>]/i)
    const href = tag.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/i)
    if (!type || !href) continue
    try {
      candidates.push({ url: new URL(href[1] || href[2], base).href, label: type[1].startsWith('feed') ? 'A JSON Feed' : `An ${type[1].startsWith('rss') ? 'RSS' : 'Atom'} feed` })
    } catch {
      // Skip malformed hrefs.
    }
  }
  for (const url of [...htmlLinks(home.text, base), ...markdownLinks(llmsBody, base)]) {
    if (/openapi|swagger/i.test(url) && /\.(json|ya?ml)(\?|$)/i.test(url)) candidates.push({ url, label: 'An OpenAPI spec' })
  }
  candidates.push({ url: `https://${ctx.hostname}/llms-full.txt`, label: 'llms-full.txt' })
  const tried = new Set()
  for (const candidate of candidates) {
    if (tried.has(candidate.url) || tried.size >= 3) continue
    tried.add(candidate.url)
    const res = await fetchText(ctx, candidate.url)
    const text = (res.text || '').trim()
    if (res.status !== 200 || res.blocked || isHtml(res, text)) continue
    if (candidate.label === 'llms-full.txt' ? text.length >= 200 : /<rss\b|<feed\b|jsonfeed\.org|openapi|swagger/i.test(text.slice(0, 4000))) return candidate
  }
  return null
}

const IDENTITY_TYPE = /(Organization|Corporation|NGO|Business|Store|Restaurant|Person|WebSite|Brand)$/
const OFFER_TYPE = /^(SoftwareApplication|WebApplication|MobileApplication|Service|Product|ProductGroup|Offer|AggregateOffer|Article|NewsArticle|BlogPosting|TechArticle|Event|Course|Dataset|FAQPage|Recipe|Book|JobPosting|HowTo|Menu|VacationRental|Accommodation|LodgingBusiness|Hotel|MedicalClinic|Physician)$/

function checkSiteSchema(home) {
  const types = schemaTypes(home.text)
  const evidence = home.url ? [home.url] : []
  const base = { id: 'jsonld', title: 'Structured data', max: WEIGHTS.jsonld, evidence }
  const identity = types.filter((type) => IDENTITY_TYPE.test(type))
  const offer = types.filter((type) => OFFER_TYPE.test(type))
  const points = (identity.length ? 5 : 0) + (offer.length ? 5 : 0)
  if (!types.length) return { ...base, status: 'fail', points: 0, detail: 'No schema.org JSON-LD on the home page.', fix: SITE_SCHEMA_FIX }
  const named = [...new Set([...identity, ...offer])]
  const detail = named.length
    ? `Home page JSON-LD declares ${named.slice(0, 4).join(', ')}.${identity.length ? '' : ' Nothing says who runs the site.'}${offer.length ? '' : ' Nothing says what it offers.'}`
    : `Home page JSON-LD declares ${types.slice(0, 3).join(', ')}, which says neither who runs the site nor what it offers.`
  return { ...base, status: points === WEIGHTS.jsonld ? 'pass' : points ? 'partial' : 'fail', points, detail, fix: points === WEIGHTS.jsonld ? '' : SITE_SCHEMA_FIX }
}

async function checkPolicies(ctx, home, llmsBody, kind = 'shop') {
  const spec = POLICY_KINDS[kind] || POLICY_KINDS.shop
  const pool = [
    ...markdownLinks(llmsBody, `https://${ctx.hostname}/`),
    ...htmlLinks(home.text, home.url || `https://${ctx.hostname}/`),
  ]
  let firstUrl = choosePolicy(pool, ctx.hostname, spec.first.match)
  let secondUrl = choosePolicy(pool, ctx.hostname, spec.second.match)
  // Many stores keep policies in a help center and link only its front page.
  let help = ''
  if (!firstUrl || !secondUrl) {
    help = chooseHelp(pool, ctx.hostname)
    if (help) {
      const page = await fetchText(ctx, help, 1_500_000)
      if (page.status === 200 && !page.blocked) {
        const links = [...htmlLinks(page.text, page.url || help), ...embeddedLinks(page.text, page.url || help)]
        firstUrl ||= choosePolicy(links, ctx.hostname, spec.first.match)
        secondUrl ||= choosePolicy(links, ctx.hostname, spec.second.match)
      }
    }
  }
  const first = { ...spec.first, url: firstUrl || `https://${ctx.hostname}${spec.first.guess}`, guessed: !firstUrl, help }
  const second = { ...spec.second, url: secondUrl || `https://${ctx.hostname}${spec.second.guess}`, guessed: !secondUrl, help }
  const firstPage = await fetchText(ctx, first.url, 600_000)
  const secondPage = second.url === first.url ? firstPage : await fetchText(ctx, second.url, 600_000)
  if (firstPage.blocked && secondPage.blocked) {
    return {
      id: 'policies',
      title: spec.title,
      max: WEIGHTS.policies,
      evidence: [first.url, second.url],
      ...blockedFields(firstPage),
    }
  }
  const firstScore = scorePolicy(firstPage, first)
  const secondScore = scorePolicy(secondPage, second)
  const points = firstScore.points + secondScore.points
  const evidence = [firstPage.url || first.url, secondPage.url || second.url].filter((url, index, all) => all.indexOf(url) === index)
  const fixes = [firstScore.fix, secondScore.fix].filter(Boolean)
  return {
    id: 'policies',
    title: spec.title,
    max: WEIGHTS.policies,
    points,
    status: points === 10 ? 'pass' : points ? 'partial' : 'fail',
    evidence,
    detail: `${firstScore.detail} ${secondScore.detail}`,
    fix: fixes.join(' '),
  }
}

function scorePolicy(res, policy) {
  const { label } = policy
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
  const fix = `Publish a ${label.toLowerCase()} at a stable https URL, such as ${policy.guess}, and link it from the site.`
  if (policy.guessed) {
    const where = policy.help ? 'the home page, llms.txt, or the help center' : 'the home page or llms.txt'
    return {
      points: 0,
      detail: `No ${label.toLowerCase()} link on ${where}, and ${policy.guess} returned ${res.status ? `HTTP ${res.status}` : 'no response'}.`,
      fix,
    }
  }
  return { points: 0, detail: `${label} does not resolve (${res.status || 'no response'}).`, fix }
}

function choosePolicy(links, hostname, re) {
  const usable = links.filter((url) => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' && relatedHost(parsed.hostname, hostname) && re.test(parsed.pathname) && !/\.(js|css|png|jpe?g|svg|gif|webp)$/i.test(parsed.pathname)
    } catch {
      return false
    }
  })
  return usable.find((url) => /polic/i.test(new URL(url).pathname)) || usable[0]
}

function chooseHelp(links, hostname) {
  for (const url of links) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'https:' || !relatedHost(parsed.hostname, hostname)) continue
    const helpHost = /^(help|support|faq|faqs|care|customer-?service|customercare)\./i.test(parsed.hostname)
    const helpPath = /^\/(help|support|faq|faqs|hc|customer-?service|customer-care|pages\/faqs?)\/?$/i.test(parsed.pathname)
    if (!helpHost && !helpPath) continue
    parsed.hash = ''
    return parsed.href
  }
  return ''
}

// A product URL pattern alone is weak: SaaS sites use /products/ for feature pages.
// It counts unless the sampled page declares software or a service and no Product.
const SITEMAP_CATALOG = 10
const SOFTWARE_TYPE = /"@type"\s*:\s*\[?\s*"(?:https?:\/\/schema\.org\/)?(?:SoftwareApplication|WebApplication|MobileApplication|Service)"/
const LODGING = /(^|\/)(VacationRental|Accommodation|LodgingBusiness|Hotel|Motel|Resort|BedAndBreakfast|Hostel|Campground|House|Apartment|Suite|HotelRoom|Room)$/
const LODGING_IN_PAGE = /"@type"\s*:\s*\[?\s*"(?:https?:\/\/schema\.org\/)?(?:VacationRental|Accommodation|LodgingBusiness|Hotel|Motel|Resort|BedAndBreakfast|Hostel|Campground)"/
const LISTING_LINK = /href\s*=\s*["'][^"']*\/(?:stays?|rentals?|listings?)\/[a-z0-9]/i

// Picks which catalog checks to run: a shop, a rental, or neither. `maybe` is confirmed by the schema on a sampled page.
function sellsWhat(home, catalog) {
  if (catalog.check?.status === 'blocked') return { kind: 'shop' }
  const html = home.text || ''
  const kind = LODGING_IN_PAGE.test(html) || LISTING_LINK.test(html) ? 'rental' : 'shop'
  if (catalog.feed?.count) return { kind }
  if (catalog.sitemap?.products >= SITEMAP_CATALOG) return { kind }
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/.test(html)) return { kind: 'shop' }
  if (/"@type"\s*:\s*"Product/.test(html)) return { kind: 'shop' }
  if (LODGING_IN_PAGE.test(html)) return { kind: 'rental' }
  if (/add to cart|add to bag/i.test(html)) return { kind: 'shop' }
  if (catalog.sitemap?.products > 0) return { kind, maybe: true }
  if (/href\s*=\s*["'][^"']*\/(?:products|collections)\//i.test(html)) return { kind: 'shop', maybe: true }
  if (LISTING_LINK.test(html)) return { kind: 'rental', maybe: true }
  return { kind: '' }
}

function jsonldBlocks(html) {
  const out = []
  for (const block of String(html || '').matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(block[1].trim()))
    } catch {
      // Skip invalid JSON-LD.
    }
  }
  return out
}

export function productSchema(html) {
  const found = { product: false, type: '', price: false, availability: false }
  for (const data of jsonldBlocks(html)) {
    for (const node of flattenNodes(data)) noteProduct(node, found, new Set())
  }
  return found
}

export function schemaTypes(html) {
  const types = new Set()
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    for (const type of typesOf(node)) types.add(type.replace(/^.*\//, ''))
    Object.values(node).forEach(walk)
  }
  jsonldBlocks(html).forEach(walk)
  return [...types]
}

function noteProduct(node, found, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    for (const item of node) noteProduct(item, found, seen)
    return
  }
  const sold = typesOf(node).find((type) => /(^|\/)Product(Group)?$/i.test(type) || LODGING.test(type))
  if (sold) {
    found.product = true
    found.type ||= sold.replace(/^.*\//, '')
  }
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
  const link = products.find((product) => typeof product?.url === 'string' && product.url)?.url || ''
  return { count: products.length, hasPrice, hasAvailable, url: '', handle, link }
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
    return /\/products?\//.test(path) || /\/p\//.test(path) || /\/pdps?\//.test(path) || /\/(stays?|rentals?|listings?)\/[^/]+/.test(path)
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
    detail: res.dropped
      ? `The site did not answer the checker (${(res.error || 'No response').replace(/\.$/, '').replace(/^./, (ch) => ch.toLowerCase())}). Bot protection often stalls automated requests this way, so it is not scored as a failure.`
      : `Bot protection stopped this check${res.status ? ` (HTTP ${res.status})` : ''}. It is not scored as a failure.`,
    fix: '',
  }
}

function blockedCheck(id, title, max, res) {
  return { id, title, max, evidence: res?.url ? [res.url] : [], ...blockedFields(res || {}) }
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

// Help centers such as Kustomer and Zendesk render in the browser, with links in escaped JSON: "href":"/en_us/categories/returns-x".
function embeddedLinks(html, base) {
  const text = String(html || '').replace(/\\?&quot;/g, '"').replace(/\\"/g, '"').replace(/\\\//g, '/')
  const links = []
  for (const match of text.matchAll(/["']?href["']?\s*:\s*"([^"\s]+)"/gi)) {
    try {
      links.push(new URL(match[1], base).href)
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

async function fetchText(ctx, pathOrUrl, maxBytes = PAGE_MAX, { anyHost = false } = {}) {
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
    if (!(await pace(ctx))) {
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
      const next = redirectTarget(res.headers, url.href, anyHost ? '' : ctx.hostname)
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

async function pace(ctx) {
  const wait = ctx.nextAt - Date.now()
  if (wait > 0) await sleep(wait)
  ctx.nextAt = Date.now() + ctx.gap
  return ctx.deadline - Date.now() >= 500
}

function redirectTarget(headers, from, entered) {
  let next
  try {
    next = new URL(headerValue(headers, 'location'), from)
  } catch {
    return null
  }
  if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443')) return null
  if (entered && !relatedHost(next.hostname, entered)) return null
  if (!entered && (isIP(next.hostname.replace(/^\[|\]$/g, '')) || !next.hostname.includes('.'))) return null
  next.hash = ''
  return next
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
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
