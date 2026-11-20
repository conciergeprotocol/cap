import { waitUntil } from '@vercel/functions'
import { randomUUID } from 'node:crypto'
import { clientIp, queryOf, readJson, tooMany } from '../site/readiness-http.mjs'
import { siteKey } from '../site/readiness-store.mjs'
import { allowed, CACHE_MS } from '../site/effectiveness/constants.mjs'
import { hostOf } from '../site/effectiveness/fetch.mjs'
import { runEffectiveness } from '../site/effectiveness/run.mjs'
import { createRuns } from '../site/effectiveness/runs.mjs'

export const config = { maxDuration: 300 }

const records = new Map()
const runs = createRuns()

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method === 'GET') {
    await read(req, res)
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST, OPTIONS')
    res.status(405).json({ error: { message: 'POST a domain.' } })
    return
  }
  await start(req, res)
}

async function start(req, res) {
  if (process.env.EFFECTIVENESS_ENABLED === '0') {
    res.status(503).json({ error: { code: 'disabled', message: 'Effectiveness scoring is off.' } })
    return
  }
  const body = readJson(req)
  const host = hostOf(body?.domain || '')
  if (!host) {
    res.status(400).json({ error: { code: 'invalid_domain', message: 'Enter a domain.' } })
    return
  }
  if (!allowed(host)) {
    res.status(403).json({
      error: {
        code: 'not_enabled',
        message: 'Live effectiveness scoring is in beta for cosmicjs.com and marlow.cosmic.site.',
      },
    })
    return
  }
  if (tooMany(clientIp(req), 'effectiveness', 2, 60 * 60 * 1000)) {
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Too many runs from here. Wait an hour.', retryAfter: 3600 },
    })
    return
  }
  const cached = records.get(siteKey(host))
  const age = cached ? Date.now() - Date.parse(cached.latest.checkedAt) : Infinity
  if (cached && !body?.fresh && age < CACHE_MS) {
    res.status(200).json({ ...cached.latest, cached: true })
    return
  }
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const result = await runEffectiveness(host, { apiKey: process.env.ANTHROPIC_API_KEY })
      save(result)
      res.status(200).json(result)
    } catch (err) {
      res.status(500).json({ error: { code: err.code || 'error', message: err.message || 'The run failed.' } })
    }
    return
  }
  const runId = `er_${randomUUID()}`
  const run = {
    runId,
    domain: host,
    state: 'queued',
    phase: 'tasks',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: { done: 0, total: 5 },
    tasks: [],
  }
  await runs.put(run)
  waitUntil(execute(runId, host).catch((err) => fail(runId, err)))
  res.status(202).json({
    runId,
    domain: host,
    state: 'queued',
    pollUrl: `/api/effectiveness?run=${encodeURIComponent(runId)}`,
    etaSeconds: 180,
  })
}

async function execute(runId, host) {
  const result = await runEffectiveness(host, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    onTask: async (task) => {
      const current = await runs.get(runId)
      if (!current) return
      const tasks = [...(current.tasks || []).filter((item) => item.id !== task.id), task]
      await runs.put({
        ...current,
        state: 'running',
        updatedAt: new Date().toISOString(),
        tasks,
        progress: { done: tasks.filter((item) => item.state === 'judged').length, total: 5 },
      })
    },
  })
  save(result)
  const current = await runs.get(runId)
  await runs.put({
    ...current,
    runId,
    domain: host,
    state: 'done',
    updatedAt: new Date().toISOString(),
    result,
  })
}

async function fail(runId, err) {
  const current = (await runs.get(runId)) || { runId }
  await runs.put({
    ...current,
    state: 'failed',
    updatedAt: new Date().toISOString(),
    error: { code: err.code || 'error', message: err.message || 'The run failed.' },
  })
}

function save(result) {
  records.set(siteKey(result.domain), {
    domain: siteKey(result.domain),
    latest: result,
    history: [{ month: result.checkedAt.slice(0, 7), ...result }],
  })
}

async function read(req, res) {
  const query = queryOf(req)
  if (query.run) {
    const run = await runs.get(String(query.run))
    if (!run) {
      res.status(404).json({ error: { code: 'not_found', message: 'That run was not found.' } })
      return
    }
    res.setHeader('cache-control', 'no-store')
    res.status(200).json(run)
    return
  }
  const host = hostOf(query.domain || '')
  if (!host) {
    res.status(400).json({ error: { message: 'Pass ?domain= or ?run=.' } })
    return
  }
  const record = records.get(siteKey(host)) || null
  res.setHeader('cache-control', 'public, max-age=60')
  res.status(200).json({ records: record ? [record] : [] })
}
