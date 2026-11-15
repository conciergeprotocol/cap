import { createBucketClient } from '@cosmicjs/sdk'

export const READINESS_TYPE = 'cap-readiness'
export const CACHE_MS = 24 * 60 * 60 * 1000

const readinessType = {
  title: 'CAP readiness',
  singular: 'CAP readiness score',
  slug: READINESS_TYPE,
  emoji: '📊',
  options: { slug_field: true, content_editor: false },
  metafields: [
    { key: 'domain', title: 'Domain', type: 'text', required: true },
    { key: 'score', title: 'Score', type: 'number' },
    { key: 'blocked', title: 'Blocked', type: 'switch', options: 'true,false' },
    { key: 'checked_at', title: 'Checked at', type: 'text' },
    { key: 'record', title: 'Record', type: 'json' },
  ],
}

export function monthOf(date = new Date()) {
  return date.toISOString().slice(0, 7)
}

export function withRun(previous, result) {
  const month = result.checkedAt.slice(0, 7)
  const slim = {
    month,
    checkedAt: result.checkedAt,
    score: result.score,
    checkedMax: result.checkedMax,
    applicableMax: result.applicableMax,
    blocked: result.blocked,
    checks: result.checks.map(({ id, title, status, points, max }) => ({ id, title, status, points, max })),
  }
  const history = [...(previous?.history || []).filter((run) => run.month !== month), slim].slice(-24)
  return { domain: result.domain, latest: result, history }
}

export function fresh(record, now = Date.now()) {
  const at = Date.parse(record?.latest?.checkedAt || '')
  return Number.isFinite(at) && now - at < CACHE_MS
}

let shared

export function getReadinessStore() {
  if (shared) return shared
  const bucket = process.env.COSMIC_BUCKET_SLUG
  const readKey = process.env.COSMIC_READ_KEY
  const writeKey = process.env.COSMIC_WRITE_KEY
  shared = bucket && readKey && writeKey
    ? cosmicStore(createBucketClient({ bucketSlug: bucket, readKey, writeKey }))
    : memoryStore()
  return shared
}

export function memoryStore() {
  const records = new Map()
  const copy = (value) => (value == null ? null : structuredClone(value))
  return {
    async get(domain) {
      return copy(records.get(domain))
    },
    async many(domains) {
      return domains.map((domain) => records.get(domain)).filter(Boolean).map(copy)
    },
    async put(record) {
      records.set(record.domain, copy(record))
    },
  }
}

function cosmicStore(cosmic) {
  const ids = new Map()
  let ready = null
  const orNull = async (run) => {
    try {
      return await run()
    } catch (err) {
      if (err?.status === 404) return null
      throw err
    }
  }
  const ensure = () => {
    if (!ready) {
      ready = (async () => {
        const found = await orNull(() => cosmic.objectTypes.findOne(READINESS_TYPE))
        if (!found) await cosmic.objectTypes.insertOne(readinessType)
      })().catch((err) => {
        ready = null
        throw err
      })
    }
    return ready
  }
  const toRecord = (object) => {
    const record = object?.metadata?.record
    if (!record?.domain) return null
    ids.set(record.domain, object.id)
    return record
  }
  return {
    async get(domain) {
      await ensure()
      const data = await orNull(() => cosmic.objects.find({ type: READINESS_TYPE, 'metadata.domain': domain }).props('id,metadata').limit(1))
      return (data?.objects || []).map(toRecord).find(Boolean) || null
    },
    async many(domains) {
      if (!domains.length) return []
      await ensure()
      const data = await orNull(() => cosmic.objects.find({ type: READINESS_TYPE, 'metadata.domain': { $in: domains } }).props('id,metadata').limit(domains.length))
      return (data?.objects || []).map(toRecord).filter(Boolean)
    },
    async put(record) {
      await ensure()
      const metadata = {
        domain: record.domain,
        score: record.latest?.score ?? '',
        blocked: Boolean(record.latest?.blocked),
        checked_at: record.latest?.checkedAt || '',
        record,
      }
      if (!ids.has(record.domain)) await this.get(record.domain)
      const id = ids.get(record.domain)
      if (id) {
        await cosmic.objects.updateOne(id, { metadata })
        return
      }
      const created = await cosmic.objects.insertOne({
        title: record.domain,
        slug: slug(record.domain),
        type: READINESS_TYPE,
        status: 'published',
        metadata,
      })
      if (created?.object?.id) ids.set(record.domain, created.object.id)
    },
  }
}

function slug(domain) {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
