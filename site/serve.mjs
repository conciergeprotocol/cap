import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import checkHandler from '../api/check.js'

const root = fileURLToPath(new URL('dist/', import.meta.url))
const port = Number(process.env.PORT) || 8765

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4'
}

const redirects = new Map([['/owners', '/login']])

const inside = (file) => {
  const path = normalize(file)
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

const send = async (res, file) => {
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': types[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache'
  })
  res.end(body)
}

const exists = async (file) => {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let path = decodeURIComponent(url.pathname)
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)

  if (path === '/api/check') {
    await runCheck(req, res)
    return
  }

  const redirect = redirects.get(path)
  if (redirect) {
    res.writeHead(308, { location: redirect + url.search })
    res.end()
    return
  }

  if (path.endsWith('.html')) {
    const clean = path === '/index.html' ? '/' : path.slice(0, -'.html'.length)
    res.writeHead(308, { location: clean + url.search })
    res.end()
    return
  }

  const rel = path.replace(/^\/+/, '')
  const file = join(root, rel)
  if (!inside(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const exact = path === '/' ? join(root, 'index.html') : file
  const html = path === '/' ? exact : `${file}.html`
  const target = (await exists(exact)) ? exact : (await exists(html)) ? html : ''
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  await send(res, target)
})

async function runCheck(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  req.body = Buffer.concat(chunks).toString('utf8')
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (data) => {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(data))
  }
  await checkHandler(req, res)
}

server.listen(port, '127.0.0.1', () => {
  console.log(`CAP site at http://127.0.0.1:${port}`)
})
