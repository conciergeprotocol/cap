const MAX_BODY = 1_000_000

export function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': extra.type || 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, cap-version, cap-from, idempotency-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'location, retry-after',
    'cache-control': 'no-store',
    ...(extra.headers || {}),
  })
  res.end(extra.raw ?? JSON.stringify(body))
}

export function fail(res, status, code, message, headers) {
  send(res, status, { error: { code, message } }, { headers })
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body is too large.'), { status: 400 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function requestOrigin(req, publicUrl = '') {
  if (publicUrl) return publicUrl.replace(/\/$/, '')
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1'
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${host}`
}
