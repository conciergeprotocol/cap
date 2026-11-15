import { parseHost } from '../site/check.mjs'
import { queryOf } from '../site/readiness-http.mjs'
import { renderScoreCard } from '../site/readiness-og.mjs'
import { getReadinessStore } from '../site/readiness-store.mjs'

export default async function handler(req, res) {
  const domain = String(queryOf(req).domain || '')
  const host = parseHost(domain)
  const name = host.ok ? host.hostname : domain.slice(0, 80)
  let card = { domain: name, pending: true }
  if (host.ok) {
    try {
      const record = await getReadinessStore().get(host.hostname)
      if (record?.latest) {
        const latest = record.latest
        card = {
          domain: host.hostname,
          score: latest.score,
          checkedMax: latest.blocked ? latest.checkedMax : latest.applicableMax,
          blocked: latest.blocked,
        }
      }
    } catch (err) {
      console.warn('readiness-og', err?.message || err)
    }
  }
  const png = renderScoreCard(card)
  res.setHeader('content-type', 'image/png')
  res.setHeader('cache-control', 'public, max-age=86400')
  res.status(200).end(png)
}
