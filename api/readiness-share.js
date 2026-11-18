import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHost } from '../site/check.mjs'
import { queryOf } from '../site/readiness-http.mjs'
import { readinessShare } from '../site/readiness-page.mjs'
import { fresh, getReadinessStore } from '../site/readiness-store.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function pageShell() {
  for (const path of [join(here, 'readiness-shell.html'), join(here, '../site/dist/readiness.html')]) {
    try {
      const html = readFileSync(path, 'utf8')
      if (html.includes('id="readiness-form"')) return html
    } catch {
      // The build writes the shell. Without it the page falls back to the bare document.
    }
  }
  console.warn('readiness-share shell missing')
  return ''
}

export const config = { maxDuration: 15 }

export default async function handler(req, res) {
  const domain = String(queryOf(req).domain || '')
  const host = parseHost(domain)
  if (!host.ok) {
    res.status(400).setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(host.detail)
    return
  }
  let result = null
  try {
    const record = await getReadinessStore().get(host.hostname)
    if (fresh(record)) result = record.latest
  } catch (err) {
    console.warn('readiness-share', err?.message || err)
  }
  res.status(200)
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', result ? 'public, max-age=3600' : 'no-store')
  res.end(readinessShare({ domain: host.hostname, result, shell: pageShell() }))
}
