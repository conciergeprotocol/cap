import { parseHost } from '../site/check.mjs'
import { clientIp, queryOf, readJson, tooMany } from '../site/readiness-http.mjs'
import { scoreSite } from '../site/readiness.mjs'
import { fresh, getReadinessStore, withRun } from '../site/readiness-store.mjs'

export const config = { maxDuration: 60 }

const MAX_DOMAINS = 60

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method === 'GET') {
    await history(req, res)
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST, OPTIONS')
    res.status(405).json({ error: { message: 'POST a domain, or GET ?domains=a.com,b.com for stored results.' } })
    return
  }
  const body = readJson(req)
  const host = parseHost(body?.domain)
  if (!host.ok) {
    res.status(400).json({ error: { message: host.detail } })
    return
  }
  const store = getReadinessStore()
  let previous = null
  try {
    previous = await store.get(host.hostname)
  } catch (err) {
    console.warn('readiness-get', err?.message || err)
  }
  if (!body?.fresh && fresh(previous)) {
    res.setHeader('cache-control', 'public, max-age=3600')
    res.status(200).json({ ...previous.latest, cached: true })
    return
  }
  if (tooMany(clientIp(req), 'score', 5, 10 * 60 * 1000)) {
    res.status(429).json({ error: { message: 'Too many checks from here. Wait a few minutes.' } })
    return
  }
  try {
    const result = await scoreSite(host.hostname)
    if (!result.ok) {
      res.status(400).json({ error: { message: result.error } })
      return
    }
    try {
      await store.put(withRun(previous, result))
    } catch (err) {
      console.warn('readiness-put', err?.message || err)
    }
    res.setHeader('cache-control', 'no-store')
    res.status(200).json(result)
  } catch (err) {
    console.warn('readiness', err?.message || err)
    res.status(500).json({ error: { message: 'The check could not run.' } })
  }
}

async function history(req, res) {
  const raw = String(queryOf(req).domains || queryOf(req).domain || '')
  const domains = [...new Set(raw.split(',').map((item) => parseHost(item)).filter((host) => host.ok).map((host) => host.hostname))]
  if (!domains.length || domains.length > MAX_DOMAINS) {
    res.status(400).json({ error: { message: `Pass ?domains= with 1 to ${MAX_DOMAINS} domains, separated by commas.` } })
    return
  }
  try {
    const records = await getReadinessStore().many(domains)
    res.setHeader('cache-control', 'public, max-age=300')
    res.status(200).json({ records })
  } catch (err) {
    console.warn('readiness-history', err?.message || err)
    res.status(502).json({ error: { message: 'Stored results could not be read.' } })
  }
}
