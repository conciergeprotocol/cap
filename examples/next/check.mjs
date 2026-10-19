import { createDoor } from './door.mjs'
import { answer } from './answer.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const door = createDoor({ name: 'Example', chat: 'https://example.com/chat', answer, waitMs: 50 })
const headers = { 'content-type': 'application/json', 'cap-version': '1.0', 'cap-from': 'agent:shopper' }

async function call(pathname, options = {}) {
  const res = await door.handle(new Request(`http://127.0.0.1${pathname}`, options))
  const type = res.headers.get('content-type') || ''
  const body = type.includes('json') ? await res.json() : await res.text()
  return { status: res.status, body, headers: res.headers }
}

const card = await call('/agent.txt')
assert(card.status === 200, 'agent.txt status')
assert(card.body.includes('Protocol: CAP/1.0'), 'agent.txt protocol')
assert(card.body.includes('CAP: http://127.0.0.1/cap/v1'), 'agent.txt cap url')

const missing = await call('/cap/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
assert(missing.status === 400 && missing.body.error.code === 'version_not_supported', 'version')

const first = await call('/cap/v1/messages', { method: 'POST', headers, body: JSON.stringify({ message: 'What is CAP?' }) })
assert(first.status === 200 && first.body.status === 'done', 'first status')
assert(first.body.reply.includes('front door'), 'first reply')
assert(/^msg_[0-9a-f]{16}$/.test(first.body.id), 'message id')

const follow = await call('/cap/v1/messages', {
  method: 'POST',
  headers,
  body: JSON.stringify({ message: 'Shorter?', previous_message_id: first.body.id }),
})
assert(follow.status === 200 && follow.body.reply === 'CAP is one file and two endpoints.', 'follow-up saw the thread')

const other = await call(`/cap/v1/messages/${first.body.id}`, { headers: { ...headers, 'cap-from': 'agent:other' } })
assert(other.status === 404, 'another caller cannot read it')

const key = { ...headers, 'idempotency-key': 'once' }
const again = await call('/cap/v1/messages', { method: 'POST', headers: key, body: JSON.stringify({ message: 'What is CAP?' }) })
const replay = await call('/cap/v1/messages', { method: 'POST', headers: key, body: JSON.stringify({ message: 'What is CAP?' }) })
assert(again.body.id === replay.body.id, 'idempotency')

let release
const slow = createDoor({
  name: 'Example',
  answer: () => new Promise((resolve) => { release = () => resolve('done later') }),
  waitMs: 20,
  retryAfter: 1,
})
const posted = await slow.handle(new Request('http://127.0.0.1/cap/v1/messages', {
  method: 'POST',
  headers,
  body: JSON.stringify({ message: 'wait' }),
}))
assert(posted.status === 202, 'still working')
const working = await posted.json()
assert(working.status === 'working' && posted.headers.get('location')?.endsWith(working.id), 'location')
release()
await new Promise((resolve) => setTimeout(resolve, 30))
const read = await slow.handle(new Request(`http://127.0.0.1/cap/v1/messages/${working.id}`, { headers }))
assert(read.status === 200, 'read status')
const done = await read.json()
assert(done.status === 'done' && done.reply === 'done later', 'finished on read')

console.log('ok')
