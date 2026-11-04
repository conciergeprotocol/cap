import { checkDoor, findIcon, parseHost } from './check.mjs'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// A full check spends the owner's tokens. Any domain or CAP endpoint is asked at most once in this window.
export const RESULT_TTL_S = 10 * 60
export const ASK_EVERY_DAYS = 7
export const ASK_EVERY_STEADY_DAYS = 30
export const STEADY_AFTER = 4
export const DELIST_AFTER = 3
// Rechecks run when the directory or a door's page is viewed, at most this often per door.
export const RECHECK_HOURS = 20
const RECHECK_MS = RECHECK_HOURS * 60 * MINUTE

// One check per domain at a time on this instance. The record's lastAskedAt covers the rest.
const running = new Set()

const bare = (host) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
const fresh = (door, at) => Boolean(door?.lastAskedAt) && at - Date.parse(door.lastAskedAt) < RESULT_TTL_S * 1000

/** Days until a passing door is asked again. Doors that keep passing are asked less. */
export function askEveryDays(passes) {
  return passes >= STEADY_AFTER ? ASK_EVERY_STEADY_DAYS : ASK_EVERY_DAYS
}

/** The check behind POST /api/check: one fresh check per domain per window, shared by every caller. */
export async function publicCheck(store, input, { check = checkDoor, now = Date.now, icon = findIcon } = {}) {
  const host = parseHost(input)
  if (!host.ok) return { status: 200, body: await check(input) }
  const domain = host.hostname
  const key = bare(domain)

  const door = await quiet(() => store.get(key))
  if (fresh(door, now()) && door.lastResult) return { status: 200, body: { ...door.lastResult, cached: true } }

  if (running.has(key)) {
    return { status: 429, body: { error: { message: `A check of ${domain} is already running. Open this page again in a minute.` } } }
  }
  running.add(key)
  try {
    return { status: 200, body: await runFull(store, domain, { check, now, icon }) }
  } finally {
    running.delete(key)
  }
}

async function runFull(store, domain, { check, now, icon }) {
  const mayAsk = async (cap) => !(await quiet(() => store.withCap(cap), [])).some((door) => fresh(door, now()))
  const result = await check(domain, { mayAsk })
  result.checkedAt = new Date(now()).toISOString()
  if (result.passed && result.asked) result.icon = await quiet(() => icon(result.domain || domain))
  await quiet(() => recordResult(store, result, now()))
  return result
}

/** Update the domain's record. Any asked check creates one, so the window holds; only a pass lists it. */
export async function recordResult(store, result, at = Date.now()) {
  if (!result?.domain || result.throttled) return null
  // One record per site: www and the bare domain are the same door. `host` keeps the address that passed, for rechecks.
  const domain = bare(result.domain)
  let door = await store.get(domain)
  if (!door) {
    if (!result.asked) return null
    door = { domain, host: result.domain, listed: false, passes: 0, failures: 0, skips: 0 }
  }
  if (result.passed && result.asked) door.host = result.domain
  const stamp = new Date(at).toISOString()
  door.lastCheckedAt = stamp
  if (result.cap) door.cap = result.cap
  if (result.cardHash) door.cardHash = result.cardHash
  if (result.asked) {
    door.lastAskedAt = stamp
    door.lastResult = result
  }

  if (result.skipped) {
    door.skips += 1
    door.lastStatus = 'skipped'
    door.lastDetail = lastDetail(result)
    door.nextAskAt = new Date(at + Math.max((result.retryAfter || 0) * 1000, DAY)).toISOString()
  } else if (!result.passed) {
    door.failures += 1
    door.lastStatus = 'failed'
    door.lastDetail = lastDetail(result)
    door.lastChecks = result.checks
    if (door.listed && door.failures >= DELIST_AFTER) {
      door.listed = false
      door.unlistedAt = stamp
    }
  } else if (result.asked) {
    door.passes += 1
    door.failures = 0
    door.skips = 0
    door.lastStatus = 'passed'
    door.lastDetail = ''
    door.lastChecks = result.checks
    door.lastAnsweredAt = stamp
    if ('icon' in result) door.icon = result.icon || null
    door.lastReply = result.checks.find((item) => item.id === 'reply')?.detail || ''
    door.firstPassedAt ||= stamp
    if (!door.listed) {
      door.listed = true
      door.listedAt = stamp
      delete door.unlistedAt
    }
    door.nextAskAt = new Date(at + askEveryDays(door.passes) * DAY).toISOString()
  } else {
    door.lastFileCheckAt = stamp
  }
  await store.put(door)
  return door
}

/** Whether a recheck asks the question, or only reads agent.txt. */
export function planCheck(door, at = Date.now()) {
  const due = !door.nextAskAt || Date.parse(door.nextAskAt) <= at
  if (door.lastStatus === 'skipped') return due ? 'full' : 'file'
  if (door.failures > 0 || due) return 'full'
  return 'file'
}

export function needsRecheck(door, at = Date.now()) {
  return Boolean(door?.listed) && (!door.lastCheckedAt || at - Date.parse(door.lastCheckedAt) >= RECHECK_MS)
}

/** Recheck one listed door. The question goes out only when it is due, after a failure, or when agent.txt changed. */
export async function recheckDoor(store, door, { check = checkDoor, now = Date.now, icon = findIcon } = {}) {
  const key = bare(door.domain)
  if (running.has(key)) return { domain: door.domain, ran: 'none', status: 'running' }
  running.add(key)
  try {
    // Claim the door first, so another instance that reads it in the meantime leaves it alone.
    const latest = (await store.get(key)) || door
    if (!needsRecheck(latest, now())) return { domain: door.domain, ran: 'none', status: 'recent' }
    latest.lastCheckedAt = new Date(now()).toISOString()
    await store.put(latest)

    const host = latest.host || latest.domain
    if (planCheck(latest, now()) === 'file') {
      const file = await check(host, { ask: false })
      const changed = file.passed && (file.cardHash !== latest.cardHash || file.cap !== latest.cap)
      if (!changed) {
        await recordResult(store, file, now())
        return { domain: door.domain, ran: 'file', status: file.passed ? 'passed' : 'failed' }
      }
    }
    const result = await runFull(store, host, { check, now, icon })
    const status = result.throttled ? 'throttled' : result.skipped ? 'skipped' : result.passed ? 'passed' : 'failed'
    return { domain: door.domain, ran: 'full', status }
  } finally {
    running.delete(key)
  }
}

/** Recheck the listed doors that are due, oldest first, within a limit and a time budget. */
export async function recheckAll(store, { check = checkDoor, now = Date.now, icon = findIcon, limit = Infinity, budgetMs = 60_000, concurrency = 2 } = {}) {
  const started = now()
  const doors = await store.list()
  const queue = doors
    .filter((door) => needsRecheck(door, started))
    .sort((a, b) => (a.lastCheckedAt || '').localeCompare(b.lastCheckedAt || ''))
    .slice(0, limit)
  const ran = []
  const worker = async () => {
    while (queue.length && now() - started < budgetMs) {
      const door = queue.shift()
      try {
        ran.push(await recheckDoor(store, door, { check, now, icon }))
      } catch (err) {
        ran.push({ domain: door.domain, ran: 'error', status: String(err?.message || err) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return { listed: doors.length, ran, left: queue.length }
}

/** A door's public record. Domains that never passed have none. */
export async function getDoor(store, domain) {
  const door = await store.get(bare(domain))
  return door?.firstPassedAt ? door : null
}

export async function listDoors(store) {
  const doors = (await store.list()).filter((door) => door.listed)
  return doors.sort((a, b) => (a.firstPassedAt || '').localeCompare(b.firstPassedAt || '') || a.domain.localeCompare(b.domain))
}

export function publicDoor(door) {
  return {
    domain: door.domain,
    host: door.host || door.domain,
    icon: door.icon || null,
    listed: door.listed,
    firstPassedAt: door.firstPassedAt || null,
    listedAt: door.listedAt || null,
    unlistedAt: door.unlistedAt || null,
    lastCheckedAt: door.lastCheckedAt || null,
    lastAnsweredAt: door.lastAnsweredAt || null,
    nextAskAt: door.nextAskAt || null,
    lastStatus: door.lastStatus || null,
    lastDetail: door.lastDetail || '',
    lastReply: door.lastReply || '',
    lastChecks: door.lastChecks || [],
    failures: door.failures || 0,
  }
}

function lastDetail(result) {
  const failed = result.checks.find((item) => !item.pass)
  return failed ? `${failed.title}: ${failed.detail}` : ''
}

/** Store errors never block a check. Without the store, a check still runs, just uncached. */
async function quiet(run, fallback = null) {
  try {
    return await run()
  } catch (err) {
    console.warn('cap-store:', err?.message || err)
    return fallback
  }
}
