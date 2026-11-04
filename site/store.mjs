import { createBucketClient } from '@cosmicjs/sdk'

export const DOOR_TYPE = 'cap-doors'

// One Cosmic object per domain the check has asked. The full record is the `record` JSON field;
// the other fields mirror it so entries read well in the dashboard and can be queried.
const doorType = {
  title: 'CAP doors',
  singular: 'CAP door',
  slug: DOOR_TYPE,
  emoji: '🚪',
  options: { slug_field: true, content_editor: false },
  metafields: [
    { key: 'domain', title: 'Domain', type: 'text', required: true },
    { key: 'host', title: 'Host that passed', type: 'text' },
    { key: 'listed', title: 'Listed', type: 'switch', options: 'true,false' },
    { key: 'last_status', title: 'Last status', type: 'text' },
    { key: 'last_answered', title: 'Last answered', type: 'text' },
    { key: 'last_asked', title: 'Last asked', type: 'text' },
    { key: 'next_ask', title: 'Next question', type: 'text' },
    { key: 'cap', title: 'CAP endpoint', type: 'text' },
    { key: 'icon', title: 'Icon URL', type: 'text' },
    { key: 'record', title: 'Record', type: 'json' },
  ],
}

let shared

export function getStore() {
  if (shared) return shared
  const bucket = process.env.COSMIC_BUCKET_SLUG
  const readKey = process.env.COSMIC_READ_KEY
  const writeKey = process.env.COSMIC_WRITE_KEY
  if (!bucket || !readKey || !writeKey) {
    console.warn('cap-store: COSMIC_BUCKET_SLUG, COSMIC_READ_KEY, or COSMIC_WRITE_KEY is missing. The directory is in memory only.')
    shared = memoryStore()
  } else {
    shared = cosmicStore(createBucketClient({ bucketSlug: bucket, readKey, writeKey }))
  }
  return shared
}

export function cosmicStore(cosmic) {
  const ids = new Map()
  let typeReady

  // The SDK throws the API's error body. A query that matches nothing is a 404.
  const orNull = async (run) => {
    try {
      return await run()
    } catch (err) {
      if (err?.status === 404) return null
      throw new Error(`cosmic: ${err?.status || ''} ${err?.message || err}`.trim())
    }
  }
  // A query on a metafield the bucket does not have yet is a 400, so the type comes first.
  const find = async (query, limit) => {
    await ensureType()
    const data = await orNull(() => cosmic.objects.find({ type: DOOR_TYPE, ...query }).props('id,metadata').limit(limit))
    return (data?.objects || []).map(toDoor).filter(Boolean)
  }
  const toDoor = (object) => {
    const door = object?.metadata?.record
    if (!door?.domain) return null
    ids.set(door.domain, object.id)
    return door
  }
  const ensureType = () => {
    typeReady ||= (async () => {
      const found = await orNull(() => cosmic.objectTypes.findOne(DOOR_TYPE))
      if (!found) await cosmic.objectTypes.insertOne(doorType)
    })().catch((err) => {
      typeReady = null
      throw err
    })
    return typeReady
  }

  return {
    async get(domain) {
      return (await find({ 'metadata.domain': domain }, 1))[0] || null
    },
    async list() {
      return find({ 'metadata.listed': true }, 1000)
    },
    async withCap(cap) {
      return find({ 'metadata.cap': cap }, 20)
    },
    async put(door) {
      const metadata = {
        domain: door.domain,
        host: door.host || door.domain,
        listed: Boolean(door.listed),
        last_status: door.lastStatus || '',
        last_answered: door.lastAnsweredAt || '',
        last_asked: door.lastAskedAt || '',
        next_ask: door.nextAskAt || '',
        cap: door.cap || '',
        icon: door.icon || '',
        record: door,
      }
      if (!ids.has(door.domain)) await this.get(door.domain)
      const id = ids.get(door.domain)
      if (id) {
        await cosmic.objects.updateOne(id, { metadata })
        return
      }
      const created = await cosmic.objects.insertOne({
        title: door.domain,
        slug: door.domain.replace(/[^a-z0-9]+/g, '-'),
        type: DOOR_TYPE,
        status: 'published',
        metadata,
      })
      if (created?.object?.id) ids.set(door.domain, created.object.id)
    },
  }
}

/** The same interface in memory, for tests and for running without Cosmic keys. */
export function memoryStore() {
  const doors = new Map()
  const copy = (value) => (value == null ? null : structuredClone(value))
  return {
    async get(domain) {
      return copy(doors.get(domain))
    },
    async list() {
      return [...doors.values()].filter((door) => door.listed).map(copy)
    },
    async withCap(cap) {
      return [...doors.values()].filter((door) => door.cap === cap).map(copy)
    },
    async put(door) {
      doors.set(door.domain, copy(door))
    },
  }
}
