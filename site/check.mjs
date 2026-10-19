import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Resolver } from 'node:dns/promises'

export const QUESTION = 'What can you help with?'
export const CALLER = 'agent:cap-check'
const OTHER = 'agent:cap-check-other'
const BUDGET_MS = 25_000
const CARD_MAX = 16_384
const BODY_MAX = 65_536
const ID = /^msg_[A-Za-z0-9_-]{8,64}$/

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
  if (!raw || raw.length > 300) return fail('Enter a domain, such as cosmicjs.com.')
  if (/^http:\/\//i.test(raw)) return fail('Use https. The check reads https://{domain}/agent.txt.')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  if (!/^https:\/\//i.test(withScheme)) return fail('Use https. The check reads https://{domain}/agent.txt.')
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return fail('Enter a domain, such as cosmicjs.com.')
  }
  if (url.username || url.password) return fail('Enter a domain, such as cosmicjs.com.')
  if (url.port && url.port !== '443') return fail('The check uses port 443 only.')
  const path = url.pathname.replace(/\/+$/, '')
  if (path && path !== '/agent.txt') return fail('Enter the domain only. The check reads /agent.txt itself.')
  if (url.search || url.hash) return fail('Enter the domain only.')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname.includes('.') || hostname.length > 253) return fail('Enter a domain, such as cosmicjs.com.')
  if (isIP(hostname)) return fail('Enter a hostname, not an IP address.')
  if (/(^|\.)(localhost|local|internal|home\.arpa)$/.test(hostname)) return fail('That host is not a public site.')
  return { ok: true, hostname }
}

/** Read agent.txt, ask one public question, and confirm the reply is private to the caller. */
export async function checkDoor(input, deps = {}) {
  const resolve = deps.resolve || resolvePublic
  const request = deps.request || pinnedRequest
  const deadline = Date.now() + BUDGET_MS
  const checks = []
  const stop = (check) => ({ passed: false, checks: checks.concat(check) })

  const host = parseHost(input)
  if (!host.ok) return stop({ id: 'host', title: 'Public https host', pass: false, detail: host.detail })
  const addresses = await resolve(host.hostname)
  if (!addresses.ok) return stop({ id: 'host', title: 'Public https host', pass: false, detail: addresses.detail })
  checks.push({ id: 'host', title: 'Public https host', pass: true, detail: host.hostname })

  const card = await readCard(host.hostname, addresses.addresses, resolve, request, deadline)
  if (!card.ok) return stop({ id: 'card', title: 'agent.txt', pass: false, detail: card.detail })
  checks.push({ id: 'card', title: 'agent.txt', pass: true, detail: card.detail })

  const reply = await ask(card.cap, card.addresses, request, deadline)
  if (!reply.ok) return stop({ id: 'reply', title: 'A public reply', pass: false, detail: reply.detail })
  checks.push({ id: 'reply', title: 'A public reply', pass: true, detail: reply.detail })

  const privacy = await hiddenFromOthers(card.cap, card.addresses, reply.id, request, deadline)
  if (!privacy.ok) return stop({ id: 'private', title: 'Private to the caller', pass: false, detail: privacy.detail })
  checks.push({ id: 'private', title: 'Private to the caller', pass: true, detail: privacy.detail })
  return { passed: true, checks }
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
  let host = hostname
  let ips = addresses
  let path = '/agent.txt'
  for (let hop = 0; hop < 4; hop++) {
    const res = await request({ url: `https://${host}${path}`, method: 'GET', addresses: ips, timeoutMs: Math.min(8_000, left(deadline)) })
    if (!res.ok) return fail(res.detail)
    if (res.status >= 300 && res.status < 400) {
      const next = redirect(res, `https://${host}${path}`, hostname)
      if (!next.ok) return next
      const again = await resolve(next.host)
      if (!again.ok) return again
      host = next.host
      ips = again.addresses
      path = '/agent.txt'
      continue
    }
    if (res.status !== 200) return fail(`GET /agent.txt returned ${res.status}. Publish the text file at the site root.`)
    if (/text\/html/i.test(res.headers['content-type'] || '')) return fail('agent.txt returned a web page. It has to be the text file.')
    return parseCard(res.body, hostname, host, ips, resolve)
  }
  return fail('agent.txt redirected too many times.')
}

async function parseCard(body, entered, finalHost, currentAddresses, resolve) {
  const lines = body.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim())
  if (lines[0] !== 'Protocol: CAP/1.0') return fail('The first line of agent.txt must be Protocol: CAP/1.0.')
  const capLine = lines.find((line) => line.startsWith('CAP:'))
  const capValue = capLine?.slice(4).trim()
  if (!capValue) return fail('Add a CAP line with an https URL on this host.')
  let cap
  try {
    cap = new URL(capValue)
  } catch {
    return fail('The CAP line must be an https URL on this host.')
  }
  if (cap.protocol !== 'https:' || cap.username || (cap.port && cap.port !== '443')) {
    return fail('The CAP line must be an https URL on this host. www and the bare domain count as the same host.')
  }
  if (!sameSite(cap.hostname, entered) || !sameSite(cap.hostname, finalHost)) {
    return fail('The CAP line must be an https URL on this host. www and the bare domain count as the same host.')
  }
  let addresses = currentAddresses
  if (cap.hostname !== finalHost) {
    const again = await resolve(cap.hostname)
    if (!again.ok) return again
    addresses = again.addresses
  }
  const href = cap.href.replace(/\/$/, '')
  return { ok: true, cap: href, addresses, detail: `CAP: ${href}` }
}

async function ask(cap, fallbackAddresses, request, deadline) {
  const addresses = fallbackAddresses
  if (!addresses) return fail('The CAP host has no DNS address.')
  const url = endpoint(cap, '')
  const res = await request({
    url,
    method: 'POST',
    addresses,
    timeoutMs: Math.min(20_000, left(deadline)),
    headers: capHeaders(CALLER),
    body: JSON.stringify({ message: QUESTION }),
  })
  if (!res.ok) return fail(res.detail)
  if (res.status >= 300 && res.status < 400) return fail('The CAP endpoint redirected. It should answer the POST itself.')
  let message = await readMessage(res, cap, addresses, request, deadline)
  if (!message.ok) return message
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
  return { ok: true, id: message.id, detail: clip(message.reply.trim()) }
}

async function readMessage(res, cap, addresses, request, deadline) {
  let current = parseMessage(res)
  if (!current.ok) return current
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
    current = parseMessage(next)
    if (!current.ok) return current
  }
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

function redirect(res, from, entered) {
  let next
  try {
    next = new URL(res.headers.location || '', from)
  } catch {
    return fail('agent.txt redirected to an unreadable location.')
  }
  if (next.protocol !== 'https:' || !sameSite(next.hostname, entered)) {
    return fail('agent.txt redirected to another host. A redirect has to stay on this site, such as example.com to www.example.com.')
  }
  if ((next.pathname.replace(/\/+$/, '') || '/') !== '/agent.txt') return fail('agent.txt redirected away from /agent.txt.')
  return { ok: true, host: next.hostname.toLowerCase() }
}

function endpoint(cap, id) {
  const base = cap.endsWith('/') ? cap : `${cap}/`
  return new URL(id ? `messages/${encodeURIComponent(id)}` : 'messages', base).href
}

function capHeaders(from) {
  return { 'content-type': 'application/json', accept: 'application/json', 'cap-version': '1.0', 'cap-from': from, 'user-agent': 'CAP-Check' }
}

function pinnedRequest({ url, method, headers = {}, body, addresses, timeoutMs }) {
  if (!addresses?.length || timeoutMs <= 0) return Promise.resolve(fail('The host did not respond in time.'))
  const address = addresses.find((ip) => isIP(ip) === 4) || addresses[0]
  const family = isIP(address)
  return new Promise((resolve) => {
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
      const max = method === 'GET' && new URL(url).pathname === '/agent.txt' ? CARD_MAX : BODY_MAX
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > max) {
          req.destroy()
          resolve(fail('The response was too large.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({
        ok: true,
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.setTimeout(timeoutMs, () => req.destroy())
    req.on('error', () => resolve(fail('The host did not respond in time.')))
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
