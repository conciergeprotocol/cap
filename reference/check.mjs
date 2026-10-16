import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { boot } from './start.mjs'

const dir = mkdtempSync(join(tmpdir(), 'cap-reference-'))
const failures = []
const running = []

function assert(cond, message) {
  if (!cond) failures.push(message)
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

function headers(extra = {}) {
  return { 'content-type': 'application/json', 'cap-version': '1.0', 'cap-from': 'agent:visitor', ...extra }
}

async function json(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body, text, headers: res.headers }
}

function post(root, message, extra = {}, context) {
  return json(`${root}/cap/v1/messages`, {
    method: 'POST',
    headers: headers(extra),
    body: JSON.stringify(context ? { message, context } : { message }),
  })
}

function follow(root, message, previous, extra = {}) {
  return json(`${root}/cap/v1/messages`, {
    method: 'POST',
    headers: headers(extra),
    body: JSON.stringify({ message, previous_message_id: previous }),
  })
}

async function start(name, config, options = {}) {
  const app = await boot({ config, sqlitePath: join(dir, `${name}.sqlite`), databaseUrl: '', ...options })
  const port = await listen(app.server)
  running.push(app)
  return `http://127.0.0.1:${port}`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const hookHits = { n: 0, sawSecret: false }
const hook = createServer(async (req, res) => {
  hookHits.n += 1
  hookHits.sawSecret = req.headers['x-cap-secret'] === 'hook-demo-secret'
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  await sleep(body.message.includes('slow') ? 350 : 0)
  res.writeHead(200, { 'content-type': 'application/json' })
  if (body.message.includes('break')) {
    res.end(JSON.stringify({ error: { code: 'out_of_stock', message: 'That item is gone.' } }))
    return
  }
  const earlier = (body.history || []).map((turn) => turn.message).join(' | ')
  res.end(JSON.stringify({ reply: `Answer to: ${body.message}${earlier ? ` after: ${earlier}` : ''}` }))
})
process.env.HOOK_SECRET = 'hook-demo-secret'
const hookPort = await listen(hook)

const agent = { name: 'Harbor Goods', status: 'active', chat: 'https://harborgoods.example/chat' }

// Public agent backed by a hook, with a short wait so a slow answer returns 202.
const root = await start('public', {
  agent,
  handler: { type: 'http', url: `http://127.0.0.1:${hookPort}`, secret_env: 'HOOK_SECRET' },
  retry_after: 1,
}, { waitMs: 150 })

const health = await json(`${root}/health`)
assert(health.status === 200 && health.body.ok === true, 'health')

const card = await fetch(`${root}/agent.txt`)
const cardText = await card.text()
assert(card.status === 200 && card.headers.get('content-type').includes('text/plain'), 'agent.txt type')
assert(cardText.startsWith('Protocol: CAP/1.0\n'), 'agent.txt protocol line')
assert(cardText.includes('Name: Harbor Goods'), 'agent.txt name')
assert(cardText.includes(`CAP: ${root}/cap/v1`), 'agent.txt cap url')
assert(!cardText.includes('OAuth:'), 'public card has no oauth line')

const badVersion = await post(root, 'hi', { 'cap-version': '9' })
assert(badVersion.status === 400 && badVersion.body.error.code === 'version_not_supported', 'bad version')

const noFrom = await json(`${root}/cap/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cap-version': '1.0' },
  body: JSON.stringify({ message: 'hi' }),
})
assert(noFrom.status === 400 && noFrom.body.error.code === 'invalid_request', 'missing CAP-From')

const empty = await post(root, '')
assert(empty.status === 400 && empty.body.error.code === 'invalid_request', 'empty message')

const badContext = await json(`${root}/cap/v1/messages`, {
  method: 'POST',
  headers: headers(),
  body: JSON.stringify({ message: 'hi', context: ['no'] }),
})
assert(badContext.status === 400, 'context must be an object')

const fast = await post(root, 'Black running shoes in size 12', { 'idempotency-key': 'shoes-1' }, { style: 'minimal' })
assert(fast.status === 200 && fast.body.status === 'done', 'fast answer is 200 done')
assert(fast.body.reply === 'Answer to: Black running shoes in size 12', 'reply text')
assert(hookHits.sawSecret === true, 'hook receives the owner secret')
assert(!fast.text.includes('hook-demo-secret'), 'reply does not contain the secret')
assert(!('message' in fast.body) && !('context' in fast.body), 'message hides what was sent')

const hitsBefore = hookHits.n
const replay = await post(root, 'Black running shoes in size 12', { 'idempotency-key': 'shoes-1' })
assert(replay.status === 200 && replay.body.id === fast.body.id, 'idempotency returns the same message')
assert(hookHits.n === hitsBefore, 'idempotency does not answer again')

const slow = await post(root, 'slow question', { 'idempotency-key': 'slow-1' })
assert(slow.status === 202 && slow.body.status === 'working', 'slow answer is 202 working')
assert(!('reply' in slow.body), 'working message has no reply')
assert(slow.headers.get('location') === `/cap/v1/messages/${slow.body.id}`, '202 sets Location')
assert(slow.headers.get('retry-after') === '1', '202 sets Retry-After')

const early = await json(`${root}/cap/v1/messages/${slow.body.id}`, { headers: headers() })
assert(early.body.status === 'working' && early.headers.get('retry-after') === '1', 'working read sets Retry-After')

const slowReplay = await post(root, 'slow question', { 'idempotency-key': 'slow-1' })
assert(slowReplay.status === 202 && slowReplay.body.id === slow.body.id, 'replay while working is the same message')

let done = early
for (let i = 0; i < 20 && done.body.status === 'working'; i += 1) {
  await sleep(100)
  done = await json(`${root}/cap/v1/messages/${slow.body.id}`, { headers: headers() })
}
assert(done.body.status === 'done' && done.body.reply === 'Answer to: slow question', 'reply arrives on a later read')
assert(done.body.finished_at, 'finished_at is set')

const stranger = await json(`${root}/cap/v1/messages/${slow.body.id}`, { headers: headers({ 'cap-from': 'agent:other' }) })
assert(stranger.status === 404, 'another agent cannot read the message')

const broken = await post(root, 'break please')
assert(broken.status === 200 && broken.body.status === 'failed', 'owner failure is a failed message')
assert(broken.body.error?.code === 'out_of_stock' && !('reply' in broken.body), 'failed message carries the error')

const missing = await json(`${root}/cap/v1/messages/msg_nope`, { headers: headers() })
assert(missing.status === 404, 'unknown message')

const cheaper = await follow(root, 'Something cheaper?', fast.body.id)
assert(cheaper.status === 200 && cheaper.body.reply === 'Answer to: Something cheaper? after: Black running shoes in size 12', 'follow-up sees the earlier turn')
const white = await follow(root, 'In white?', cheaper.body.id)
assert(white.body.reply.endsWith('after: Black running shoes in size 12 | Something cheaper?'), 'thread keeps every earlier turn in order')

const borrowed = await follow(root, 'Mine now?', fast.body.id, { 'cap-from': 'agent:other' })
assert(borrowed.status === 404, 'another agent cannot continue the thread')
const unknownPrevious = await follow(root, 'Hello?', 'msg_nope')
assert(unknownPrevious.status === 404 && unknownPrevious.body.error.code === 'not_found', 'unknown previous message')

const pending = await post(root, 'slow second question')
const tooSoon = await follow(root, 'And?', pending.body.id)
assert(pending.status === 202 && tooSoon.status === 409 && tooSoon.body.error.code === 'conflict', 'cannot follow a working message')

const shortRoot = await start('short', { agent, handler: { type: 'echo' }, max_turns: 2 })
const t1 = await post(shortRoot, 'one')
const t2 = await follow(shortRoot, 'two', t1.body.id)
const t3 = await follow(shortRoot, 'three', t2.body.id)
const t4 = await follow(shortRoot, 'four', t3.body.id)
assert(t3.status === 200, 'thread under the turn limit')
assert(t4.status === 409 && t4.body.error.code === 'conflict', 'thread over the turn limit')

// One agent that answers public questions and, with a grant, account questions.
const ORDERS = { maya: 'Your 18x24 poster shipped. Track it at https://carrier.example/track/ord_maya', sam: 'Your mug is packing.' }
const accountRoot = await start('account', {
  agent: { ...agent, oauth: 'https://harborgoods.example/oauth' },
  demo_oauth: true,
  grants: [{ token: 'grant_demo', account: 'maya', client: 'shopper' }],
}, {
  answer: async ({ message, account }) => {
    if (!/order/i.test(message)) return { reply: 'We are open Saturday 11am to 9pm.' }
    if (!account) return { error: { code: 'login_required', message: 'Log in to ask about your order.' } }
    return { reply: ORDERS[account] || 'No order on this account.' }
  },
})

const shopper = { 'cap-from': 'agent:shopper' }
const maya = { ...shopper, authorization: 'Bearer grant_demo' }

const accountCard = await (await fetch(`${accountRoot}/agent.txt`)).text()
assert(accountCard.includes('OAuth: https://harborgoods.example/oauth'), 'account card has the oauth line')

const hours = await post(accountRoot, 'When are you open?', shopper)
assert(hours.body.status === 'done' && hours.body.reply.includes('Saturday'), 'public question needs no token')

const noLogin = await post(accountRoot, "Where's my order?", shopper)
assert(noLogin.status === 200 && noLogin.body.status === 'failed', 'account question without a grant fails')
assert(noLogin.body.error?.code === 'login_required', 'failure code is login_required')

const badToken = await post(accountRoot, "Where's my order?", { ...shopper, authorization: 'Bearer nope' })
assert(badToken.status === 401 && badToken.body.error.code === 'unauthorized', 'invalid token is 401')

const wrongAgent = await post(accountRoot, "Where's my order?", { 'cap-from': 'agent:other', authorization: 'Bearer grant_demo' })
assert(wrongAgent.status === 403 && wrongAgent.body.error.code === 'forbidden', 'token for another agent is 403')

const order = await post(accountRoot, "Where's my order?", maya, { account: 'sam' })
assert(order.body.status === 'done' && order.body.reply.includes('poster'), 'grant answers for its own account')
assert(!order.body.reply.includes('mug'), 'context cannot switch the account')

const noTokenRead = await json(`${accountRoot}/cap/v1/messages/${order.body.id}`, { headers: headers(shopper) })
assert(noTokenRead.status === 404, 'account message is not visible without the grant')

const issued = await json(`${accountRoot}/oauth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ account: 'sam', client: 'shopper' }),
})
assert(issued.status === 200 && issued.body.access_token.startsWith('grant_'), 'demo oauth issues a token')
const sam = { ...shopper, authorization: `Bearer ${issued.body.access_token}` }

const samReadsMaya = await json(`${accountRoot}/cap/v1/messages/${order.body.id}`, { headers: headers(sam) })
assert(samReadsMaya.status === 404, 'another account cannot read the message')

const samOrder = await post(accountRoot, "Where's my order?", sam)
assert(samOrder.body.reply === 'Your mug is packing.', 'issued grant answers for that account')

const afterLogin = await follow(accountRoot, 'Where is my order now?', noLogin.body.id, maya)
assert(afterLogin.body.status === 'done' && afterLogin.body.reply.includes('poster'), 'a public thread can continue after login')
const loggedOut = await follow(accountRoot, 'And the date?', order.body.id, shopper)
assert(loggedOut.status === 404, 'an account thread cannot continue without the token')
const otherAccount = await follow(accountRoot, 'And the date?', order.body.id, sam)
assert(otherAccount.status === 404, 'an account thread cannot continue on another account')

const mayaReads = await json(`${accountRoot}/cap/v1/messages/${order.body.id}`, { headers: headers(maya) })
assert(mayaReads.status === 200 && mayaReads.body.reply.includes('poster'), 'the same grant can read the message')

const revoke = await json(`${accountRoot}/oauth/revoke`, { method: 'POST', headers: { authorization: 'Bearer grant_demo' } })
assert(revoke.status === 200, 'revoke')
const afterRevoke = await json(`${accountRoot}/cap/v1/messages/${order.body.id}`, { headers: headers(maya) })
assert(afterRevoke.status === 401, 'revoked token is 401')

// Limits stay private. The caller only sees 429 and Retry-After.
const limitedRoot = await start('limited', { agent, handler: { type: 'echo' }, daily_limit: 2 })
await post(limitedRoot, 'one')
await post(limitedRoot, 'two')
const third = await post(limitedRoot, 'three')
assert(third.status === 429 && third.body.error.code === 'rate_limited', 'over the limit is 429')
assert(Number(third.headers.get('retry-after')) > 0, '429 sets Retry-After')
assert(!third.text.includes('daily_limit') && !third.text.includes('2'), '429 does not reveal the limit')
const otherCaller = await post(limitedRoot, 'one', { 'cap-from': 'agent:someone' })
assert(otherCaller.status === 200, 'the limit is per caller')

const expiringRoot = await start('expiring', { agent, handler: { type: 'echo' }, retention_hours: 0 })
const gone = await post(expiringRoot, 'remember me')
await sleep(5)
const expired = await json(`${expiringRoot}/cap/v1/messages/${gone.body.id}`, { headers: headers() })
assert(expired.status === 404, 'expired message is 404')

const pausedRoot = await start('paused', { agent: { ...agent, status: 'paused' }, handler: { type: 'echo' } })
const paused = await post(pausedRoot, 'hello')
assert(paused.status === 503 && paused.body.error.code === 'unavailable', 'paused agent is 503')

for (const app of running) {
  app.server.close()
  await app.store.close()
}
hook.close()
rmSync(dir, { recursive: true, force: true })

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('reference server checks passed')
