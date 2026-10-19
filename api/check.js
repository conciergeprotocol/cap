import { checkDoor } from '../site/check.mjs'

const hits = new Map()

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    res.status(405).json({ error: { message: 'POST a domain.' } })
    return
  }
  const limited = tooMany(forwarded(req))
  if (limited) {
    res.status(429).json({ error: { message: 'Too many checks from here. Wait a minute.' } })
    return
  }
  const domain = domainFrom(req)
  if (typeof domain !== 'string') {
    res.status(400).json({ error: { message: 'Enter a domain.' } })
    return
  }
  try {
    const result = await checkDoor(domain)
    res.setHeader('cache-control', 'no-store')
    res.status(200).json(result)
  } catch {
    res.status(500).json({ error: { message: 'The check could not run.' } })
  }
}

function domainFrom(req) {
  if (req.body && typeof req.body === 'object') return req.body.domain
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body).domain
    } catch {
      return undefined
    }
  }
  return undefined
}

function forwarded(req) {
  const header = req.headers['x-forwarded-for']
  const value = Array.isArray(header) ? header[0] : header || ''
  return String(value).split(',')[0].trim() || 'local'
}

function tooMany(ip) {
  const now = Date.now()
  if (hits.size > 1000) hits.clear()
  const recent = (hits.get(ip) || []).filter((at) => now - at < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 10
}
