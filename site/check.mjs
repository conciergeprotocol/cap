import { createHash, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Resolver } from 'node:dns/promises'

export const QUESTION = 'What can you help with?'
export const CALLER = 'agent:cap-check'
const OTHER = 'agent:cap-check-other'
const BUDGET_MS = 25_000
const CARD_MAX = 16_384
const PAGE_MAX = 256 * 1024
const BODY_MAX = 65_536
const ID = /^msg_[A-Za-z0-9_-]{8,64}$/
const HELP = 'https://conciergeprotocol.org/spec#front-door'
const WAIT_CODES = new Set(['rate_limited', 'unavailable'])

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
]) blocked.addSubnet(net, prefix, 'ipv4')
blocked.addAddress('::', 'ipv6')
blocked.addAddress('::1', 'ipv6')
blocked.addSubnet('fc00::', 7, 'ipv6')
blocked.addSubnet('fe80::', 10, 'ipv6')
blocked.addSubnet('ff00::', 8, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')

export function isPublicAddress(ip) {
  const kind = isIP(ip)
  if (kind === 4) return !blocked.check(ip, 'ipv4')
  if (kind !== 6) return false
  if (blocked.check(ip, 'ipv6')) return false
  const mapped = ip.toLowerCase().match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return !blocked.check(mapped[1], 'ipv4')
  return true
}

export function sameSite(a, b) {
  const bare = (host) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  return bare(a) === bare(b)
}

export function parseHost(input) {
  const raw = String(input ?? '').trim()
  if (!raw || raw.length > 300) return fail('Enter a domain, such as example.com.')
  if (/^http:\/\//i.test(raw)) return fail('Use https. The check reads https://{domain}/agent.txt.')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  if (!/^https:\/\//i.test(withScheme)) return fail('Use https. The check reads https://{domain}/agent.txt.')
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return fail('Enter a domain, such as example.com.')
  }
  if (url.username || url.password) return fail('Enter a domain, such as example.com.')
  if (url.port && url.port !== '443') return fail('The check uses port 443 only.')
  const path = url.pathname.replace(/\/+$/, '')
  if (path && path !== '/agent.txt') return fail('Enter the domain only. The check reads /agent.txt itself.')
  if (url.search || url.hash) return fail('Enter the domain only.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname.includes('.') || hostname.length > 253) return fail('Enter a domain, such as example.com.')
  if (isIP(hostname)) return fail('Enter a hostname, not an IP address.')
  if (/(^|\.)(localhost|local|internal|home\.arpa)$/.test(hostname)) return fail('That host is not a public site.')
  return { ok: true, hostname }
}

/**
 * Read agent.txt, or the homepage link to it, ask one public question, and confirm the reply is private to the caller.
 * With `ask: false` it stops after agent.txt, so the owner's agent never runs.
 * `mayAsk(cap)` can veto the question for an endpoint that was asked recently.
 */
export async function checkDoor(input, deps = {}) {
  const resolve = deps.resolve || resolvePublic
  const request = deps.request || pinnedRequest
  const asking = deps.ask !== false
  const deadline = Date.now() + BUDGET_MS
  const checks = []
  const host = parseHost(input)
  let asked = false
  let card
  const finish = (result) => {
    if (host.ok) result.domain = host.hostname
    if (card?.ok) Object.assign(result, { cap: card.cap, cardHash: card.hash })
    result.asked = asked
    return result
  }
  const stop = (check, extra) => finish({ passed: false, checks: checks.concat(check), ...extra })

  if (!host.ok) return stop({ id: 'host', title: 'Public https host', pass: false, detail: host.detail })
  const addresses = await resolve(host.hostname)
  if (!addresses.ok) return stop({ id: 'host', title: 'Public https host', pass: false, detail: addresses.detail })
  checks.push({ id: 'host', title: 'Public https host', pass: true, detail: host.hostname })

  card = await readCard(host.hostname, addresses.addresses, resolve, request, deadline)
  if (!card.ok) {
    const missed = { id: 'card', title: 'agent.txt', pass: false, detail: card.detail }
    if (card.status) missed.status = card.status
    if (card.absent) missed.help = HELP
    return stop(missed)
  }
  if (!asking) {
    checks.push({ id: 'card', title: 'agent.txt', pass: true, detail: card.detail })
    await addLogin(checks, card, resolve, request, deadline)
    return finish({ passed: checks.every((check) => check.pass), checks })
  }
  const tips = []
  if (!card.asks) tips.push('Add the Ask line, so an agent that does not know CAP knows your agent answers questions and how to ask.')
  if (!(await servesHelp(card.cap, card.addresses, request, deadline))) {
    tips.push(`A GET on ${card.cap} should return the plain-text help with status 200, so an agent that opens the URL learns to post to it.`)
  }
  const cardCheck = { id: 'card', title: 'agent.txt', pass: true, detail: [card.detail, ...tips].join(' ') }
  if (tips.length) cardCheck.tips = tips
  checks.push(cardCheck)
  await addLogin(checks, card, resolve, request, deadline)
  if (deps.mayAsk && !(await deps.mayAsk(card.cap))) {
    const detail = `${card.cap} answered a check in the last 10 minutes, so it was not asked again.`
    return stop({ id: 'reply', title: 'A public reply', pass: false, skipped: true, detail }, { skipped: true, throttled: true })
  }

  asked = true
  const reply = await ask(card.cap, card.addresses, request, deadline)
  if (reply.skipped) {
    return stop({ id: 'reply', title: 'A public reply', pass: false, skipped: true, detail: reply.detail }, { skipped: true, retryAfter: reply.retryAfter })
  }
  if (!reply.ok) return stop({ id: 'reply', title: 'A public reply', pass: false, detail: reply.detail })
  const replyCheck = { id: 'reply', title: 'A public reply', pass: true, detail: reply.detail }
  if (reply.locationTip) {
    replyCheck.tips = [reply.locationTip]
    replyCheck.detail = `${reply.detail} ${reply.locationTip}`
  }
  checks.push(replyCheck)

  const privacy = await hiddenFromOthers(card.cap, card.addresses, reply.id, request, deadline)
  if (!privacy.ok) return stop({ id: 'private', title: 'Private to the caller', pass: false, detail: privacy.detail })
  checks.push({ id: 'private', title: 'Private to the caller', pass: true, detail: privacy.detail })
  return finish({ passed: checks.every((check) => check.pass), checks })
}

// A failed login still lets the public checks run, so the report shows both.
async function addLogin(checks, card, resolve, request, deadline) {
  if (!card.oauth) return
  checks.push(await checkLogin(card, resolve, request, deadline))
}

async function checkLogin(card, resolve, request, deadline) {
  const title = 'Login'
  let oauth
  try {
    oauth = new URL(card.oauth)
  } catch {
    return { id: 'login', title, pass: false, detail: 'The OAuth line must be an https URL.' }
  }
  if (oauth.protocol !== 'https:' || oauth.username || oauth.password || (oauth.port && oauth.port !== '443')) {
    return { id: 'login', title, pass: false, detail: 'The OAuth line must be an https URL on port 443.' }
  }
  const found = await resolve(oauth.hostname.toLowerCase())
  if (!found.ok) return { id: 'login', title, pass: false, detail: found.detail }
  const path = oauth.pathname === '/' ? '' : oauth.pathname.replace(/\/$/, '')
  const res = await request({
    url: `${oauth.origin}/.well-known/oauth-authorization-server${path}`,
    method: 'GET',
    addresses: found.addresses,
    timeoutMs: Math.min(8_000, left(deadline)),
    maxBytes: CARD_MAX,
    truncate: true,
  })
  if (!res.ok) return { id: 'login', title, pass: false, detail: res.detail }
  if (res.status >= 300 && res.status < 400) {
    return { id: 'login', title, pass: false, detail: 'The OAuth metadata redirected. Publish it at the well-known URL itself.' }
  }
  if (res.status !== 200) return { id: 'login', title, pass: false, detail: `The OAuth metadata returned ${res.status}.` }
  if (res.truncated) return { id: 'login', title, pass: false, detail: 'The OAuth metadata is larger than 16 KB.' }
  let meta
  try {
    meta = JSON.parse(res.body || '')
  } catch {
    return { id: 'login', title, pass: false, detail: 'The OAuth metadata is not JSON.' }
  }
  if (meta.issuer !== card.oauth) {
    return {
      id: 'login',
      title,
      pass: false,
      detail: `The metadata's issuer is ${meta.issuer || 'missing'}. It must match the OAuth line, ${card.oauth}, exactly.`,
    }
  }
  const resources = Array.isArray(meta.protected_resources) ? meta.protected_resources : []
  if (!resources.includes(card.capRaw)) {
    const slash = resources.some((entry) => typeof entry === 'string'
      && entry.replace(/\/$/, '') === card.capRaw.replace(/\/$/, '')
      && entry !== card.capRaw)
    const hint = slash ? ` An entry differs only by a trailing slash. The CAP line is ${card.capRaw}.` : ''
    return {
      id: 'login',
      title,
      pass: false,
      detail: `Add "protected_resources": ["${card.capRaw}"] to your OAuth metadata. Visiting agents will not log in without it.${hint}`,
    }
  }
  return { id: 'login', title, pass: true, detail: 'The issuer matches the OAuth line and lists this CAP URL.' }
}

export async function resolvePublic(hostname) {
  const resolver = new Resolver()
  const found = []
  for (const method of ['resolve4', 'resolve6']) {
    try {
      found.push(...(await resolver[method](hostname)))
    } catch (err) {
      if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND' && err.code !== 'ENOENT' && err.code !== 'ENOTIMP') {
        return fail('That host has no DNS address.')
      }
    }
  }
  if (!found.length) return fail('That host has no DNS address.')
  if (found.some((ip) => !isPublicAddress(ip))) return fail('That host resolves to a private address.')
  return { ok: true, addresses: found }
}

async function readCard(hostname, addresses, resolve, request, deadline) {
  const direct = await fetchDoorFile(`https://${hostname}/agent.txt`, addresses, hostname, resolve, request, deadline)
  if (direct.ok || !direct.absent) return direct
  const pointer = await homepagePointer(hostname, addresses, resolve, request, deadline)
  if (!pointer.ok) return pointer.detail ? pointer : direct
  const file = await fetchDoorFile(pointer.url, pointer.addresses, hostname, resolve, request, deadline, { pointed: pointer.via })
  if (!file.ok) return file
  return { ...file, detail: `${file.detail} Found from the homepage ${pointer.via}.` }
}

async function fetchDoorFile(url, addresses, entered, resolve, request, deadline, options = {}) {
  let current = url
  let ips = addresses
  for (let hop = 0; hop < 4; hop++) {
    const res = await request({
      url: current,
      method: 'GET',
      addresses: ips,
      timeoutMs: Math.min(8_000, left(deadline)),
      maxBytes: CARD_MAX,
      truncate: true,
    })
    if (!res.ok) return fail(res.detail)
    if (res.status >= 300 && res.status < 400) {
      const next = fileRedirect(res, current)
      if (!next.ok) return next
      const again = await resolve(next.host)
      if (!again.ok) return again
      current = next.href
      ips = again.addresses
      continue
    }
    if (res.status !== 200) {
      const detail = options.pointed
        ? `The homepage points at ${current}, which returned ${res.status}.`
        : res.status === 404
          ? `No agent.txt at ${current}. Publish the text file at the site root, or add <link rel="agent"> to the homepage.`
          : `GET /agent.txt returned ${res.status}. Publish the text file at the site root, or add <link rel="agent"> to the homepage.`
      return miss(detail, res.status)
    }
    if (/text\/html/i.test(headerValue(res.headers, 'content-type'))) {
      const detail = options.pointed
        ? `The homepage points at ${current}, which is a web page, not agent.txt.`
        : 'agent.txt returned a web page. Publish the text file, or add <link rel="agent"> to the homepage.'
      return miss(detail)
    }
    if (res.truncated) return fail(`agent.txt is larger than ${CARD_MAX / 1024} KB.`)
    const parsed = await parseCard(res.body, current, ips, resolve)
    if (!parsed.ok) {
      if (parsed.absent && options.pointed) return fail(`The homepage points at ${current}, which is not an agent.txt file.`)
      return parsed
    }
    if (!options.pointed && !sameSite(new URL(current).hostname, entered)) {
      return { ...parsed, detail: `${parsed.detail} Found at ${current}.` }
    }
    return parsed
  }
  return miss(options.pointed
    ? 'The file the homepage points at redirected too many times.'
    : 'agent.txt redirected too many times. Publish the text file, or add <link rel="agent"> to the homepage.')
}

async function homepagePointer(hostname, addresses, resolve, request, deadline) {
  let current = `https://${hostname}/`
  let ips = addresses
  for (let hop = 0; hop < 4; hop++) {
    const res = await request({
      url: current,
      method: 'GET',
      addresses: ips,
      timeoutMs: Math.min(8_000, left(deadline)),
      maxBytes: PAGE_MAX,
      truncate: true,
    })
    if (!res.ok) return { ok: false }
    if (res.status >= 300 && res.status < 400) {
      const next = homeRedirect(res, current, hostname)
      if (!next.ok) return { ok: false }
      const again = await resolve(next.host)
      if (!again.ok) return again
      current = next.href
      ips = again.addresses
      continue
    }
    if (res.status !== 200) return { ok: false }
    const pointer = agentPointer(res.headers, res.body, current)
    if (!pointer) return { ok: false }
    let target
    try {
      target = new URL(pointer.href)
    } catch {
      return fail('The homepage agent link is not a URL.')
    }
    if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) {
      return fail('The homepage agent link must be an https URL on port 443.')
    }
    target.hash = ''
    const host = target.hostname.toLowerCase()
    const again = await resolve(host)
    if (!again.ok) return again
    return { ok: true, url: target.href, addresses: again.addresses, via: pointer.via }
  }
  return { ok: false }
}

export function agentPointer(headers, body, base) {
  const fromHeader = agentLinkHeader(headerValue(headers, 'link'))
  if (fromHeader) {
    try {
      return { href: new URL(fromHeader, base).href, via: 'Link header' }
    } catch {
      return null
    }
  }
  const fromTag = agentLinkHref(body)
  if (!fromTag) return null
  try {
    return { href: new URL(fromTag, base).href, via: 'link tag' }
  } catch {
    return null
  }
}

function agentLinkHeader(header) {
  if (!header) return null
  const parts = String(header).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  for (const part of parts) {
    const uri = part.match(/<([^>]*)>/)
    if (!uri) continue
    const rel = part.match(/(?:^|\s|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;,]+))/i)
    const types = (rel?.[1] ?? rel?.[2] ?? '').toLowerCase().trim().split(/\s+/)
    if (types.includes('agent')) return uri[1].trim()
  }
  return null
}

function agentLinkHref(html) {
  const source = String(html || '')
  const bodyAt = source.search(/<body\b/i)
  const headAt = source.search(/<\/head>/i)
  let cut = source.length
  if (bodyAt !== -1) cut = Math.min(cut, bodyAt)
  if (headAt !== -1) cut = Math.min(cut, headAt)
  const tags = source.slice(0, cut).match(/<link\b[^>]*>/gi) || []
  for (const tag of tags) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/)
    if (!rel.includes('agent')) continue
    const href = attr(tag, 'href')
    if (href) return href
  }
  return null
}

/** The site's own icon for the directory: the best declared one, else /favicon.ico. Null when there is none worth showing. */
export async function findIcon(hostname, deps = {}) {
  const resolve = deps.resolve || resolvePublic
  const request = deps.request || pinnedRequest
  const deadline = Date.now() + 8_000
  const found = await resolve(hostname)
  if (!found.ok) return null
  let current = `https://${hostname}/`
  let ips = found.addresses
  for (let hop = 0; hop < 4; hop++) {
    const res = await request({ url: current, method: 'GET', addresses: ips, timeoutMs: Math.min(5_000, left(deadline)), maxBytes: PAGE_MAX, truncate: true })
    if (!res.ok) return null
    if (res.status >= 300 && res.status < 400) {
      const next = homeRedirect(res, current, hostname)
      if (!next.ok) return null
      const again = await resolve(next.host)
      if (!again.ok) return null
      current = next.href
      ips = again.addresses
      continue
    }
    if (res.status === 200) {
      const icon = pickIcon(res.body, current)
      if (icon) return icon
    }
    break
  }
  const ico = `${new URL(current).origin}/favicon.ico`
  const res = await request({ url: ico, method: 'GET', addresses: ips, timeoutMs: Math.min(5_000, left(deadline)), maxBytes: 4_096, truncate: true })
  return res.ok && res.status === 200 && /^image\//i.test(headerValue(res.headers, 'content-type')) ? ico : null
}

// Closest to 64px wins. Icons declared over 1024px are skipped: they are logos, too heavy for a list.
export function pickIcon(html, base) {
  const source = String(html || '')
  const headAt = source.search(/<\/head>/i)
  const tags = source.slice(0, headAt === -1 ? source.length : headAt).match(/<link\b[^>]*>/gi) || []
  let best = null
  for (const tag of tags) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/)
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue
    let url
    try {
      url = new URL(attr(tag, 'href'), base)
    } catch {
      continue
    }
    if (url.protocol !== 'https:') continue
    const sizes = attr(tag, 'sizes').toLowerCase()
    const side = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((match) => Number(match[1])))
    if (side > 1024) continue
    const svg = /svg/i.test(attr(tag, 'type')) || /\.svg$/i.test(url.pathname)
    const score = svg || sizes === 'any' ? 0 : side ? Math.abs(side - 64) : rel.includes('apple-touch-icon') ? 116 : 40
    if (!best || score < best.score) best = { score, href: url.href }
  }
  return best?.href || null
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

async function parseCard(body, fileUrl, currentAddresses, resolve) {
  const finalHost = new URL(fileUrl).hostname.toLowerCase()
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim())
  const capLine = lines.find((line) => line.startsWith('CAP:'))
  const capValue = capLine?.slice(4).trim()
  if (lines[0] !== 'Protocol: CAP/1.0') {
    if (!capValue) return miss('agent.txt has no CAP line. Publish one at the site root, or add <link rel="agent"> to the homepage.')
    return fail('The first line of agent.txt must be Protocol: CAP/1.0.')
  }
  if (!capValue) return miss('Add a CAP line with an https URL, or add <link rel="agent"> to the homepage.')
  let cap
  try {
    cap = new URL(capValue)
  } catch {
    return fail('The CAP line must be an https URL.')
  }
  if (cap.protocol !== 'https:' || cap.username || cap.password || (cap.port && cap.port !== '443')) {
    return fail('The CAP line must be an https URL.')
  }
  let addresses = currentAddresses
  if (cap.hostname.toLowerCase() !== finalHost) {
    const again = await resolve(cap.hostname)
    if (!again.ok) return again
    addresses = again.addresses
  }
  const href = cap.href.replace(/\/$/, '')
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16)
  const asks = lines.some((line) => line.startsWith('Ask:'))
  const oauthLine = lines.find((line) => line.startsWith('OAuth:'))
  const oauth = oauthLine ? oauthLine.slice('OAuth:'.length).trim() : ''
  return { ok: true, cap: href, capRaw: capValue, oauth, addresses, hash, asks, detail: `CAP: ${href}` }
}

// The help needs no CAP headers and runs no agent, so it is safe to read on every check.
async function servesHelp(cap, addresses, request, deadline) {
  if (!addresses) return false
  const res = await request({
    url: cap,
    method: 'GET',
    addresses,
    headers: { accept: 'text/plain', 'user-agent': 'CAP-Check' },
    timeoutMs: Math.min(5_000, left(deadline)),
    maxBytes: CARD_MAX,
    truncate: true,
  })
  return Boolean(res.ok && res.status === 200
    && /text\/plain/i.test(headerValue(res.headers, 'content-type'))
    && /\/messages/.test(String(res.body || '')))
}

async function ask(cap, fallbackAddresses, request, deadline) {
  const addresses = fallbackAddresses
  if (!addresses) return fail('The CAP host has no DNS address.')
  const url = endpoint(cap, '')
  // The same key on a resend after a dropped connection gets the original message, so the door answers once.
  const key = `cap-check-${randomUUID()}`
  const post = () => request({
    url,
    method: 'POST',
    addresses,
    timeoutMs: Math.min(20_000, left(deadline)),
    headers: { ...capHeaders(CALLER), 'idempotency-key': key },
    body: JSON.stringify({ message: QUESTION }),
  })
  let res = await post()
  if (!res.ok && left(deadline) > 10_000) res = await post()
  if (!res.ok) return fail(res.detail)
  if (res.status >= 300 && res.status < 400) return fail('The CAP endpoint redirected. It should answer the POST itself.')
  const tipped = offOriginLocation(res, cap)
  let message = await readMessage(res, cap, addresses, request, deadline)
  if (!message.ok) return message
  if (!message.locationTip && tipped) message.locationTip = tipped
  if (message.status === 'failed' && WAIT_CODES.has(message.error?.code)) {
    return skip(`The door asked the check to wait${message.error?.message ? `: ${clip(message.error.message)}` : '.'}`, message.retryAfter)
  }
  if (message.status === 'failed') {
    const why = message.error?.code === 'login_required'
      ? 'A public question came back login_required. The door should answer it without a token.'
      : `The door returned failed${message.error?.message ? `: ${clip(message.error.message)}` : '.'}`
    return fail(why)
  }
  if (message.status !== 'done' || typeof message.reply !== 'string' || !message.reply.trim()) {
    return fail('The door did not finish with a reply within 25 seconds. Return 200 when it is ready, or 202 with a GET that finishes.')
  }
  if (!ID.test(message.id || '')) return fail('The message id should look like msg_ followed by letters or numbers.')
  return { ok: true, id: message.id, detail: clip(message.reply.trim()), locationTip: message.locationTip || '' }
}

async function readMessage(res, cap, addresses, request, deadline) {
  let current = parseMessage(res)
  if (!current.ok) return current
  let locationTip = ''
  while (current.status === 'working') {
    if (left(deadline) < 1_000) return { ok: true, status: 'working' }
    const wait = Math.min(5, Math.max(1, current.retryAfter ?? 2)) * 1000
    if (left(deadline) < wait + 500) return { ok: true, status: 'working' }
    await sleep(wait)
    if (!ID.test(current.id || '')) return fail('The message id should look like msg_ followed by letters or numbers.')
    const next = await request({
      url: endpoint(cap, current.id),
      method: 'GET',
      addresses,
      timeoutMs: Math.min(8_000, left(deadline)),
      headers: capHeaders(CALLER),
    })
    if (!next.ok) return fail(next.detail)
    const tip = offOriginLocation(next, cap)
    current = parseMessage(next)
    if (!current.ok) return current
    if (tip) locationTip = tip
  }
  if (locationTip) current.locationTip = locationTip
  return current
}

async function hiddenFromOthers(cap, addresses, id, request, deadline) {
  const res = await request({
    url: endpoint(cap, id),
    method: 'GET',
    addresses,
    timeoutMs: Math.min(8_000, left(deadline)),
    headers: capHeaders(OTHER),
  })
  if (!res.ok) return fail(res.detail)
  if (res.status === 404) return { ok: true, detail: 'Another caller gets 404.' }
  return fail(`A different CAP-From must get 404 for this message. This request returned ${res.status}.`)
}

function parseMessage(res) {
  if (res.status === 429 || res.status === 503) {
    const wait = Number(res.headers?.['retry-after'])
    const what = res.status === 429 ? 'is limiting this caller' : 'is not answering right now'
    return skip(`The CAP endpoint returned ${res.status}: it ${what}. Not counted as a failure.`, Number.isFinite(wait) ? wait : undefined)
  }
  if (res.status !== 200 && res.status !== 202) {
    return fail(`The CAP endpoint returned ${res.status}. Send CAP-Version: 1.0 and CAP-From: agent:{id}.`)
  }
  let body
  try {
    body = JSON.parse(res.body || '')
  } catch {
    return fail('The CAP endpoint did not return a message.')
  }
  const retry = Number(res.headers['retry-after'])
  return { ok: true, id: body.id, status: body.status, reply: body.reply, error: body.error, retryAfter: Number.isFinite(retry) ? retry : 2 }
}

function fileRedirect(res, from) {
  let next
  try {
    next = new URL(headerValue(res.headers, 'location'), from)
  } catch {
    return fail('agent.txt redirected to an unreadable location.')
  }
  if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443')) {
    return fail('agent.txt redirected to a URL that is not https on port 443.')
  }
  next.hash = ''
  return { ok: true, host: next.hostname.toLowerCase(), href: next.href }
}

function homeRedirect(res, from, entered) {
  let next
  try {
    next = new URL(headerValue(res.headers, 'location'), from)
  } catch {
    return { ok: false }
  }
  if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443')) return { ok: false }
  if (!relatedHost(next.hostname, entered)) return { ok: false }
  next.hash = ''
  return { ok: true, host: next.hostname.toLowerCase(), href: next.href }
}

function relatedHost(a, b) {
  const bare = (host) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  const left = bare(a)
  const right = bare(b)
  if (!left || !right) return false
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function headerValue(headers, name) {
  const value = headers?.[name]
  if (Array.isArray(value)) return value.join(', ')
  return value || ''
}

function miss(detail, status) {
  return status ? { ok: false, absent: true, detail, status } : { ok: false, absent: true, detail }
}

function offOriginLocation(res, cap) {
  if (res.status !== 202) return ''
  const location = headerValue(res.headers, 'location')
  if (!location) return ''
  let target
  try {
    target = new URL(location, cap)
  } catch {
    return 'The 202 Location is not a URL.'
  }
  const origin = new URL(cap).origin
  if (target.origin === origin) return ''
  return `The 202 Location is on ${target.origin}. Keep it on ${origin}: callers will not carry a token to another origin.`
}

function endpoint(cap, id) {
  const base = cap.endsWith('/') ? cap : `${cap}/`
  return new URL(id ? `messages/${encodeURIComponent(id)}` : 'messages', base).href
}

function capHeaders(from) {
  return { 'content-type': 'application/json', accept: 'application/json', 'cap-version': '1.0', 'cap-from': from, 'user-agent': 'CAP-Check' }
}

function pinnedRequest({ url, method, headers = {}, body, addresses, timeoutMs, maxBytes, truncate }) {
  if (!addresses?.length || timeoutMs <= 0) return Promise.resolve(fail('The host did not respond in time.'))
  const address = addresses.find((ip) => isIP(ip) === 4) || addresses[0]
  const family = isIP(address)
  const max = maxBytes || BODY_MAX
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const req = httpsRequest(url, {
      method,
      headers,
      servername: new URL(url).hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address, family }])
        else callback(null, address, family)
      },
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        if (settled) return
        size += chunk.length
        if (size > max) {
          if (truncate) {
            const keep = chunk.length - (size - max)
            if (keep > 0) chunks.push(chunk.subarray(0, keep))
            res.destroy()
            finish({
              ok: true,
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
              truncated: true,
            })
            return
          }
          req.destroy()
          finish(fail('The response was too large.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => finish({
        ok: true,
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
      res.on('error', () => finish(fail('The host did not respond in time.')))
    })
    req.setTimeout(timeoutMs, () => req.destroy())
    req.on('error', () => finish(fail('The host did not respond in time.')))
    if (body) req.write(body)
    req.end()
  })
}

function left(deadline) {
  return deadline - Date.now()
}

function clip(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  return clean.length > 280 ? `${clean.slice(0, 277)}...` : clean
}

function fail(detail) {
  return { ok: false, detail }
}

function skip(detail, retryAfter) {
  return { ok: false, skipped: true, detail, retryAfter }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
