import { createHash, randomBytes } from 'node:crypto'
import { startStore } from './store.mjs'

const secret = 'orders_db_demo_7c1'
const shopper = { 'content-type': 'application/json', 'cap-version': '1.0', 'cap-from': 'agent:shopper' }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const store = await startStore(0)

async function call(pathname, options = {}) {
  const res = await fetch(`${store.base}${pathname}`, options)
  const text = await res.text()
  assert(!text.includes(secret), `response leaked the orders key: ${text}`)
  return { status: res.status, body: JSON.parse(text), headers: res.headers }
}

function send(message, headers = shopper, context) {
  return call('/cap/v1/messages', { method: 'POST', headers, body: JSON.stringify({ message, context }) })
}

// The same steps the demo page takes in a browser: PKCE, the store's login page, the token exchange.
async function login(account, { write = false } = {}) {
  const card = await (await fetch(`${store.base}/agent.txt`)).text()
  const issuer = new URL(card.match(/^OAuth: (.+)$/m)[1])
  const meta = await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`)).json()
  const verifier = randomBytes(32).toString('base64url')
  const clientId = `${store.base}/client.json`
  const redirectUri = `${store.base}/`
  const authorize = new URL(meta.authorization_endpoint)
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'demo',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(write ? { scope: 'write' } : {}),
  })
  const html = await (await fetch(authorize)).text()
  assert(html.includes('Harbor Goods demo page'), 'login page names the visiting agent')
  const request = html.match(/name="request" value="([^"]+)"/)[1]
  const allowed = await fetch(meta.authorization_endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request, username: account, password: account, decision: write ? 'allow_write' : 'allow' }),
  })
  const code = new URL(allowed.headers.get('location')).searchParams.get('code')
  const { body } = await call(new URL(meta.token_endpoint).pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
  })
  assert(body.access_token && body.scope === (write ? 'read write' : 'read'), JSON.stringify(body))
  return { ...shopper, authorization: `Bearer ${body.access_token}` }
}

try {
  const card = await (await fetch(`${store.base}/agent.txt`)).text()
  assert(card.startsWith('Protocol: CAP/1.0\n') && card.includes('Name: Harbor Goods') && card.includes('OAuth:'), card)

  const outfit = await send('Running shoes in size 12, black sweatpants, and a black hoodie', shopper, {
    style: 'minimal, no logos',
    sizes: { bottoms: 'L', tops: 'L' },
  })
  assert(outfit.status === 200 && outfit.body.status === 'done', JSON.stringify(outfit.body))
  assert(outfit.body.reply.includes('Stride Runner'), outfit.body.reply)
  assert(outfit.body.reply.includes('Everyday Fleece Jogger'), outfit.body.reply)
  assert(outfit.body.reply.includes('Heavyweight Hoodie'), outfit.body.reply)
  assert(!outfit.body.reply.includes('Logo') && !outfit.body.reply.includes('Graphic'), 'brief should rule out logos')

  const cheaper = await call('/cap/v1/messages', {
    method: 'POST',
    headers: shopper,
    body: JSON.stringify({ message: 'Something cheaper?', previous_message_id: outfit.body.id }),
  })
  assert(cheaper.status === 200 && cheaper.body.status === 'done', JSON.stringify(cheaper.body))
  assert(cheaper.body.reply.includes('Tempo Runner') && cheaper.body.reply.includes('Everyday Hoodie'), cheaper.body.reply)
  assert(cheaper.body.reply.includes('Everyday Fleece Jogger at $65 is already the lowest price'), cheaper.body.reply)
  assert(!cheaper.body.reply.includes('Graphic'), 'follow-up kept the brief from the first message')

  const fresh = await send('Something cheaper?')
  assert(fresh.body.reply.startsWith('Cheaper than what?'), 'a new thread has no earlier turns')

  const noLogin = await send("Where's my order?")
  assert(noLogin.body.status === 'failed' && noLogin.body.error.code === 'login_required', JSON.stringify(noLogin.body))

  const maya = await login('maya')
  const mine = await send("Where's my order?", maya)
  assert(mine.status === 200 && mine.body.reply.includes('Stride Runner shipped'), JSON.stringify(mine.body))

  const sam = await login('sam')
  const slow = await send("Where's my order?", sam)
  assert(slow.status === 202 && slow.body.status === 'working', JSON.stringify(slow.body))
  assert(!('reply' in slow.body), 'working message invented a reply')
  assert(slow.headers.get('retry-after') === '1', 'Retry-After is set')

  const peek = await call(`/cap/v1/messages/${slow.body.id}`, { headers: maya })
  assert(peek.status === 404, `Maya should not read Sam's message, got ${peek.status}`)

  let read = slow
  for (let i = 0; i < 10 && read.body.status === 'working'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, Number(read.headers.get('retry-after') || 1) * 1000))
    read = await call(`/cap/v1/messages/${slow.body.id}`, { headers: sam })
  }
  assert(read.body.status === 'done' && read.body.reply.includes('packing'), JSON.stringify(read.body))
  assert(!read.body.reply.includes('Stride'), "Sam saw Maya's order")

  // A read login cannot change the order.
  const readWrap = await send('Add gift wrap to my order', maya)
  assert(readWrap.body.status === 'failed' && readWrap.body.error.code === 'write_required', JSON.stringify(readWrap.body))

  const mayaWrite = await login('maya', { write: true })
  const wrapped = await send('Add gift wrap to my order', mayaWrite)
  assert(wrapped.body.reply.startsWith('Gift wrap added'), JSON.stringify(wrapped.body))

  // A cancel waits for Maya on the store's page.
  const cancel = await send('Cancel my order', mayaWrite)
  const confirmation = cancel.body.confirmation
  assert(cancel.body.status === 'done' && confirmation?.status === 'pending', JSON.stringify(cancel.body))
  assert(confirmation.summary === 'Cancel order hg_1042 (Stride Runner, $120).' && cancel.body.reply.includes(confirmation.url), JSON.stringify(cancel.body))
  assert((await send("Where's my order?", maya)).body.reply.includes('shipped'), 'the order changed before approval')

  const approved = await fetch(new URL(confirmation.url).origin + new URL(confirmation.url).pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: confirmation.id, username: 'maya', password: 'maya', decision: 'approve' }),
  })
  assert(approved.status === 200 && (await approved.text()).includes('refund'), 'approval shows the result')
  const status = await call(`/cap/v1/confirmations/${confirmation.id}`, { headers: mayaWrite })
  assert(status.body.status === 'done' && status.body.result.message.includes('cancelled'), JSON.stringify(status.body))
  assert((await send("Where's my order?", maya)).body.reply === 'Order hg_1042 is cancelled.', 'the order is cancelled after approval')

  console.log('ok')
} finally {
  await store.close()
}
