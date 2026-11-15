const buckets = new Map()

export function clientIp(req) {
  const header = req.headers?.['x-forwarded-for']
  const value = Array.isArray(header) ? header[0] : header || ''
  return String(value).split(',')[0].trim() || 'local'
}

export function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return null
}

export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query
  try {
    return Object.fromEntries(new URL(req.url || '/', 'http://127.0.0.1').searchParams)
  } catch {
    return {}
  }
}

export function tooMany(ip, bucket, limit, windowMs) {
  const now = Date.now()
  if (!buckets.has(bucket)) buckets.set(bucket, new Map())
  const hits = buckets.get(bucket)
  if (hits.size > 1000) hits.clear()
  const recent = (hits.get(ip) || []).filter((at) => now - at < windowMs)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > limit
}
