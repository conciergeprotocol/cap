import assert from 'node:assert/strict'
import test from 'node:test'
import { getDoor, listDoors, planCheck, publicCheck, recheckAll } from './doors.mjs'
import { memoryStore } from './store.mjs'

const DAY = 24 * 60 * 60 * 1000

function setup() {
  let at = Date.parse('2026-11-04T12:00:00Z')
  const clock = { now: () => at, advance: (ms) => { at += ms } }
  const store = memoryStore()
  const calls = []
  let reply = 'pass'
  let hash = 'aaaa'
  const check = async (domain, options = {}) => {
    const base = { domain, cap: `https://${domain}/cap/v1`, cardHash: hash }
    const file = [{ id: 'host', pass: true }, { id: 'card', pass: true }]
    if (options.ask === false) {
      calls.push({ domain, ask: false })
      return { ...base, passed: true, asked: false, checks: file }
    }
    if (options.mayAsk && !(await options.mayAsk(base.cap))) {
      calls.push({ domain, ask: false, throttled: true })
      return { ...base, passed: false, asked: false, skipped: true, throttled: true, checks: file }
    }
    calls.push({ domain, ask: true })
    if (reply === 'skip') return { ...base, passed: false, asked: true, skipped: true, retryAfter: 60, checks: [...file, { id: 'reply', pass: false, skipped: true, title: 'A public reply', detail: '429' }] }
    if (reply === 'fail') return { ...base, passed: false, asked: true, checks: [...file, { id: 'reply', pass: false, title: 'A public reply', detail: 'broken' }] }
    return { ...base, passed: true, asked: true, checks: [...file, { id: 'reply', pass: true, detail: 'We help.' }, { id: 'private', pass: true }] }
  }
  return {
    store,
    clock,
    calls,
    check,
    set: (next) => { reply = next },
    setHash: (next) => { hash = next },
    asks: () => calls.filter((call) => call.ask).length,
  }
}

const icon = async (host) => `https://${host}/icon.png`
const run = (ctx, domain = 'example.com') => publicCheck(ctx.store, domain, { check: ctx.check, now: ctx.clock.now, icon })
const recheck = (ctx) => recheckAll(ctx.store, { check: ctx.check, now: ctx.clock.now, icon })

test('a passing check lists the door, and repeat checks within 10 minutes reuse the result', async () => {
  const ctx = setup()
  const first = await run(ctx)
  assert.equal(first.body.passed, true)
  assert.equal((await listDoors(ctx.store)).map((door) => door.domain).join(), 'example.com')

  for (let i = 0; i < 20; i++) {
    const again = await run(ctx, i % 2 ? 'www.example.com' : 'Example.com')
    assert.equal(again.body.cached, true)
  }
  assert.equal(ctx.asks(), 1)

  ctx.clock.advance(11 * 60 * 1000)
  await run(ctx)
  assert.equal(ctx.asks(), 2)
})

test('another domain pointing at the same CAP endpoint is not asked again within the window', async () => {
  const ctx = setup()
  const shared = async (domain, options) => ctx.check('example.com', options).then((result) => ({ ...result, domain }))
  await publicCheck(ctx.store, 'example.com', { check: shared, now: ctx.clock.now, icon })
  const other = await publicCheck(ctx.store, 'alias.example.net', { check: shared, now: ctx.clock.now, icon })
  assert.equal(other.body.throttled, true)
  assert.equal(ctx.asks(), 1)
  assert.equal(await getDoor(ctx.store, 'alias.example.net'), null)
})

test('www and the bare domain share one entry, and rechecks use the host that passed', async () => {
  const ctx = setup()
  await run(ctx, 'www.example.com')
  assert.deepEqual((await listDoors(ctx.store)).map((door) => [door.domain, door.host, door.icon]), [['example.com', 'www.example.com', 'https://www.example.com/icon.png']])
  assert.equal((await getDoor(ctx.store, 'www.example.com')).domain, 'example.com')
  ctx.clock.advance(DAY)
  await recheck(ctx)
  assert.equal(ctx.calls.at(-1).domain, 'www.example.com')
})

test('a check already running for a domain returns 429 instead of asking twice', async () => {
  const ctx = setup()
  let release
  const slow = (domain, options) => new Promise((resolve) => { release = () => resolve(ctx.check(domain, options)) })
  const first = publicCheck(ctx.store, 'example.com', { check: slow, now: ctx.clock.now, icon })
  const blocked = await run(ctx)
  assert.equal(blocked.status, 429)
  release()
  assert.equal((await first).body.passed, true)
  assert.equal(ctx.asks(), 1)
})

test('a failing domain is not listed, but its result is still shared for 10 minutes', async () => {
  const ctx = setup()
  ctx.set('fail')
  await run(ctx)
  assert.equal(await getDoor(ctx.store, 'example.com'), null)
  assert.equal((await listDoors(ctx.store)).length, 0)
  assert.equal((await run(ctx)).body.cached, true)
  assert.equal(ctx.asks(), 1)
})

test('daily rechecks read agent.txt and ask once a week, then monthly once steady', async () => {
  const ctx = setup()
  await run(ctx)
  const asksAfter = (days) => {
    const out = []
    return (async () => {
      for (let day = 0; day < days; day++) {
        ctx.clock.advance(DAY)
        await recheck(ctx)
        out.push(ctx.asks())
      }
      return out
    })()
  }
  const asks = await asksAfter(28)
  // The first check, then days 7, 14, and 21. The fourth pass moves the next question 30 days out.
  assert.deepEqual([asks[5], asks[6], asks[13], asks[20], asks[27]], [1, 2, 3, 4, 4])
  assert.equal(ctx.calls.filter((call) => !call.ask).length, 25)
  const door = await getDoor(ctx.store, 'example.com')
  assert.equal(Date.parse(door.nextAskAt) - ctx.clock.now(), 23 * DAY)
})

test('a changed agent.txt is asked right away', async () => {
  const ctx = setup()
  await run(ctx)
  ctx.clock.advance(DAY)
  await recheck(ctx)
  assert.equal(ctx.asks(), 1)
  ctx.setHash('bbbb')
  ctx.clock.advance(DAY)
  await recheck(ctx)
  assert.equal(ctx.asks(), 2)
})

test('a 429 is skipped, waits at least a day, and never delists', async () => {
  const ctx = setup()
  await run(ctx)
  ctx.set('skip')
  for (let week = 0; week < 6; week++) {
    ctx.clock.advance(7 * DAY)
    await recheck(ctx)
  }
  const door = await getDoor(ctx.store, 'example.com')
  assert.equal(door.listed, true)
  assert.equal(door.lastStatus, 'skipped')
  assert.equal(door.failures, 0)
  assert.equal(planCheck({ ...door, lastStatus: 'skipped' }, ctx.clock.now()), 'file')
})

test('three failures in a row delist the door, and a pass puts it back', async () => {
  const ctx = setup()
  await run(ctx)
  ctx.set('fail')
  ctx.clock.advance(7 * DAY)
  await recheck(ctx)
  for (let day = 0; day < 2; day++) {
    ctx.clock.advance(DAY)
    await recheck(ctx)
  }
  let door = await getDoor(ctx.store, 'example.com')
  assert.equal(door.listed, false)
  assert.equal(door.failures, 3)
  assert.equal((await listDoors(ctx.store)).length, 0)

  ctx.clock.advance(DAY)
  const before = ctx.asks()
  await recheck(ctx)
  assert.equal(ctx.asks(), before, 'unlisted doors are not rechecked')

  ctx.set('pass')
  await run(ctx)
  door = await getDoor(ctx.store, 'example.com')
  assert.equal(door.listed, true)
})

test('store errors do not block a check', async () => {
  const ctx = setup()
  const broken = new Proxy({}, { get: () => async () => { throw new Error('down') } })
  const result = await publicCheck(broken, 'example.com', { check: ctx.check, now: ctx.clock.now, icon })
  assert.equal(result.status, 200)
  assert.equal(result.body.passed, true)
})
