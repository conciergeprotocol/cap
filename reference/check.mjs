import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { publicConfirmation } from './server.mjs'
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
const orderAnswer = async ({ message, account }) => {
  if (!/order/i.test(message)) return { reply: 'We are open Saturday 11am to 9pm.' }
  if (!account) return { error: { code: 'login_required', message: 'Log in to ask about your order.' } }
  return { reply: ORDERS[account] || 'No order on this account.' }
}
const oauthConfig = {
  accounts: [{ account: 'maya', password: 'maya-pass' }, { account: 'sam', password: 'sam-pass' }],
  allow_http_clients: true,
  device_interval: 0,
}
const accountRoot = await start('account', {
  agent,
  oauth: oauthConfig,
  grants: [{ token: 'grant_demo', account: 'maya', client: 'shopper' }],
}, { answer: orderAnswer })

// The visiting agent hosts its own client document. No registration with the owner.
const clientDocs = createServer((req, res) => {
  const base = `http://${req.headers.host}`
  const docs = {
    '/client.json': { client_id: `${base}/client.json`, client_name: 'Shopper', redirect_uris: ['http://127.0.0.1/callback'], cap_from: 'agent:shopper' },
    '/wrong-id.json': { client_id: `${base}/client.json`, redirect_uris: ['http://127.0.0.1/callback'], cap_from: 'agent:shopper' },
    '/no-from.json': { client_id: `${base}/no-from.json`, redirect_uris: ['http://127.0.0.1/callback'] },
  }
  const doc = docs[req.url]
  res.writeHead(doc ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(doc || {}))
})
const clientBase = `http://127.0.0.1:${await listen(clientDocs)}`
const clientId = `${clientBase}/client.json`
const redirectUri = 'http://127.0.0.1:5555/callback'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function startLogin(rootUrl, params = {}) {
  const { verifier, challenge } = pkce()
  const url = new URL(`${rootUrl}/oauth/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 's1',
    code_challenge: challenge, code_challenge_method: 'S256', ...params,
  })
  const res = await fetch(url, { redirect: 'manual' })
  const html = await res.text()
  return { res, html, verifier, request: html.match(/name="request" value="([^"]+)"/)?.[1] || '' }
}

function submitLogin(rootUrl, request, fields) {
  return fetch(`${rootUrl}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request, ...fields }),
  })
}

function oauthForm(rootUrl, path, fields) {
  return json(`${rootUrl}/oauth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
}

async function codeFor(rootUrl, username, password) {
  const login = await startLogin(rootUrl)
  const res = await submitLogin(rootUrl, login.request, { username, password, decision: 'allow' })
  return { code: new URL(res.headers.get('location')).searchParams.get('code'), verifier: login.verifier }
}

async function loginAs(rootUrl, username, password) {
  const { code, verifier } = await codeFor(rootUrl, username, password)
  const exchange = { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }
  return (await oauthForm(rootUrl, 'token', exchange)).body
}

const shopper = { 'cap-from': 'agent:shopper' }
const maya = { ...shopper, authorization: 'Bearer grant_demo' }

const accountCard = await (await fetch(`${accountRoot}/agent.txt`)).text()
assert(accountCard.includes(`OAuth: ${accountRoot}/oauth`), 'account card has the oauth line')

const meta = await json(`${accountRoot}/.well-known/oauth-authorization-server/oauth`)
assert(meta.status === 200 && meta.body.issuer === `${accountRoot}/oauth`, 'oauth metadata at the RFC 8414 path')
assert(meta.body.code_challenge_methods_supported.includes('S256'), 'metadata lists S256')
assert(meta.body.client_id_metadata_document_supported === true, 'metadata accepts client id documents')
assert(meta.body.token_endpoint === `${accountRoot}/oauth/token` && meta.body.revocation_endpoint === `${accountRoot}/oauth/revoke`, 'metadata endpoints')

const consent = await startLogin(accountRoot)
assert(consent.res.status === 200 && consent.request, 'authorize shows the login page')
assert(consent.html.includes('Shopper') && consent.html.includes(clientBase.slice(7)), 'login page names the visiting agent and its host')
assert(!consent.html.includes('maya-pass'), 'login page does not leak passwords')

const evilRedirect = await startLogin(accountRoot, { redirect_uri: 'https://evil.example/callback' })
assert(evilRedirect.res.status === 400 && !evilRedirect.res.headers.get('location'), 'an unlisted redirect_uri is refused without redirecting')
const wrongDoc = await startLogin(accountRoot, { client_id: `${clientBase}/wrong-id.json` })
assert(wrongDoc.res.status === 400, 'a document naming another client_id is refused')
const noFromDoc = await startLogin(accountRoot, { client_id: `${clientBase}/no-from.json` })
assert(noFromDoc.res.status === 400, 'a document without cap_from is refused')
const noPkce = await startLogin(accountRoot, { code_challenge: '' })
const noPkceBack = new URL(noPkce.res.headers.get('location') || 'http://x/')
assert(noPkce.res.status === 302 && noPkceBack.searchParams.get('error') === 'invalid_request' && noPkceBack.searchParams.get('state') === 's1', 'missing PKCE redirects with invalid_request')

const badPassword = await submitLogin(accountRoot, consent.request, { username: 'sam', password: 'nope', decision: 'allow' })
assert(badPassword.status === 401 && (await badPassword.text()).includes('did not match'), 'a wrong password stays on the login page')
const allowed = await submitLogin(accountRoot, consent.request, { username: 'sam', password: 'sam-pass', decision: 'allow' })
const back = new URL(allowed.headers.get('location') || 'http://x/')
assert(allowed.status === 302 && back.origin + back.pathname === redirectUri, 'login redirects to the loopback redirect on its own port')
assert(back.searchParams.get('code') && back.searchParams.get('state') === 's1' && back.searchParams.get('iss') === `${accountRoot}/oauth`, 'redirect carries code, state, and iss')
const reusedRequest = await submitLogin(accountRoot, consent.request, { username: 'sam', password: 'sam-pass', decision: 'allow' })
assert(reusedRequest.status === 400, 'a login request works once')

const denyLogin = await startLogin(accountRoot)
const denied = new URL((await submitLogin(accountRoot, denyLogin.request, { decision: 'deny' })).headers.get('location'))
assert(denied.searchParams.get('error') === 'access_denied', 'deny redirects with access_denied')

const exchange = (code, verifier) => ({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier })
const guessed = await oauthForm(accountRoot, 'token', exchange(back.searchParams.get('code'), pkce().verifier))
assert(guessed.status === 400 && guessed.body.error === 'invalid_grant', 'a wrong code_verifier is invalid_grant')
const afterGuess = await oauthForm(accountRoot, 'token', exchange(back.searchParams.get('code'), consent.verifier))
assert(afterGuess.body.error === 'invalid_grant', 'a code is gone after one try')

const fresh = await codeFor(accountRoot, 'sam', 'sam-pass')
const wrongClient = await oauthForm(accountRoot, 'token', { ...exchange(fresh.code, fresh.verifier), client_id: `${clientBase}/other.json` })
assert(wrongClient.body.error === 'invalid_grant', 'a code works only for the client it was issued to')
const issuedCode = await codeFor(accountRoot, 'sam', 'sam-pass')
const issued = await oauthForm(accountRoot, 'token', exchange(issuedCode.code, issuedCode.verifier))
assert(issued.status === 200 && issued.body.token_type === 'Bearer' && issued.body.expires_in === 3600, 'token response')
assert(issued.body.access_token.startsWith('cap_at_') && issued.body.refresh_token.startsWith('cap_rt_'), 'access and refresh tokens')
const reusedCode = await oauthForm(accountRoot, 'token', exchange(issuedCode.code, issuedCode.verifier))
assert(reusedCode.body.error === 'invalid_grant', 'a used code is invalid_grant')
const notForm = await json(`${accountRoot}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
assert(notForm.status === 400 && notForm.body.error === 'invalid_request', 'the token endpoint takes a form')

const sam = { ...shopper, authorization: `Bearer ${issued.body.access_token}` }
const samAsOther = await post(accountRoot, "Where's my order?", { 'cap-from': 'agent:other', authorization: sam.authorization })
assert(samAsOther.status === 403, 'an OAuth token works only with the cap_from it was issued to')
const refreshAsBearer = await post(accountRoot, "Where's my order?", { ...shopper, authorization: `Bearer ${issued.body.refresh_token}` })
assert(refreshAsBearer.status === 401, 'a refresh token is not an access token')

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

const revoke = await oauthForm(accountRoot, 'revoke', { token: 'grant_demo', client_id: '' })
assert(revoke.status === 200, 'revoke')
const afterRevoke = await json(`${accountRoot}/cap/v1/messages/${order.body.id}`, { headers: headers(maya) })
assert(afterRevoke.status === 401, 'revoked token is 401')

const renewed = await oauthForm(accountRoot, 'token', { grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, client_id: clientId })
assert(renewed.status === 200 && renewed.body.refresh_token !== issued.body.refresh_token, 'refresh returns a new refresh token')
const replayedRefresh = await oauthForm(accountRoot, 'token', { grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, client_id: clientId })
assert(replayedRefresh.body.error === 'invalid_grant', 'an old refresh token stops working')
const refreshWrongClient = await oauthForm(accountRoot, 'token', { grant_type: 'refresh_token', refresh_token: renewed.body.refresh_token, client_id: `${clientBase}/other.json` })
assert(refreshWrongClient.body.error === 'invalid_grant', 'refresh works only for its own client')
const samRenewed = { ...shopper, authorization: `Bearer ${renewed.body.access_token}` }
const renewedOrder = await post(accountRoot, "Where's my order?", samRenewed)
assert(renewedOrder.body.reply === 'Your mug is packing.', 'the renewed token answers for the same account')

const strangerRevoke = await oauthForm(accountRoot, 'revoke', { token: renewed.body.refresh_token, client_id: `${clientBase}/other.json` })
assert(strangerRevoke.status === 200, 'revoke answers 200 whatever the token')
assert((await post(accountRoot, "Where's my order?", samRenewed)).body.status === 'done', 'another client cannot revoke the token')
await oauthForm(accountRoot, 'revoke', { token: renewed.body.refresh_token, client_id: clientId })
const afterLogout = await post(accountRoot, "Where's my order?", samRenewed)
assert(afterLogout.status === 401, 'revoking the refresh token also ends its access token')

const shortRootTokens = await start('short-tokens', { agent, oauth: { ...oauthConfig, access_token_seconds: 1 } }, { answer: orderAnswer })
const shortLived = await loginAs(shortRootTokens, 'maya', 'maya-pass')
await sleep(1100)
const expiredToken = await post(shortRootTokens, "Where's my order?", { ...shopper, authorization: `Bearer ${shortLived.access_token}` })
assert(expiredToken.status === 401, 'an expired access token is 401')

// The code login needs nothing but HTTP requests from the visiting agent.
const DEVICE = 'urn:ietf:params:oauth:grant-type:device_code'
assert(meta.body.device_authorization_endpoint === `${accountRoot}/oauth/device`, 'metadata lists the device endpoint')
assert(meta.body.grant_types_supported.includes(DEVICE), 'metadata lists the device grant')

function approveDevice(rootUrl, fields) {
  return fetch(`${rootUrl}/oauth/device/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
}
const pollDevice = (rootUrl, deviceCode, clientIdValue = 'agent:shopper') =>
  oauthForm(rootUrl, 'token', { grant_type: DEVICE, device_code: deviceCode, client_id: clientIdValue })

const started = await oauthForm(accountRoot, 'device', { client_id: 'agent:shopper', client_name: 'Shopper' })
assert(started.status === 200 && started.body.device_code && /^[B-Z]{4}-[B-Z]{4}$/.test(started.body.user_code), 'device login returns a device code and a user code')
assert(started.body.verification_uri_complete === `${accountRoot}/oauth/device?user_code=${started.body.user_code}`, 'device login links to the approval page with the code')
assert(started.body.expires_in === 600 && started.body.interval === 0, 'device login sets expires_in and interval')
const noDeviceClient = await oauthForm(accountRoot, 'device', { client_id: 'not an agent' })
assert(noDeviceClient.status === 400 && noDeviceClient.body.error === 'invalid_client', 'the code login needs an agent: id or a client document')

const notYet = await pollDevice(accountRoot, started.body.device_code)
assert(notYet.status === 400 && notYet.body.error === 'authorization_pending', 'polling before approval is authorization_pending')

const approvalPage = await fetch(started.body.verification_uri_complete)
const approvalHtml = await approvalPage.text()
assert(approvalPage.status === 200 && approvalHtml.includes('Shopper') && approvalHtml.includes('not verified') && approvalHtml.includes(started.body.user_code), 'approval page shows the unverified name and the code')
assert(!approvalHtml.includes(started.body.device_code), 'approval page never shows the device code')

const badDevicePassword = await approveDevice(accountRoot, { user_code: started.body.user_code, username: 'maya', password: 'nope', decision: 'allow' })
assert(badDevicePassword.status === 401, 'a wrong password does not approve the device login')
assert((await pollDevice(accountRoot, started.body.device_code)).body.error === 'authorization_pending', 'still pending after a wrong password')

const lowercase = started.body.user_code.toLowerCase().replace('-', ' ')
const approved = await approveDevice(accountRoot, { user_code: lowercase, username: 'maya', password: 'maya-pass', decision: 'allow' })
assert(approved.status === 200 && (await approved.text()).includes('logged in'), 'the person approves with the code in any case and spacing')
const twice = await approveDevice(accountRoot, { user_code: started.body.user_code, username: 'sam', password: 'sam-pass', decision: 'allow' })
assert(twice.status === 400, 'a code is approved once')

const wrongDeviceClient = await pollDevice(accountRoot, started.body.device_code, 'agent:other')
assert(wrongDeviceClient.body.error === 'invalid_grant', 'a device code works only for the agent that started it')
const deviceToken = await pollDevice(accountRoot, started.body.device_code)
assert(deviceToken.status === 200 && deviceToken.body.access_token.startsWith('cap_at_') && deviceToken.body.refresh_token, 'polling after approval returns the tokens')
const deviceAgain = await pollDevice(accountRoot, started.body.device_code)
assert(deviceAgain.body.error === 'invalid_grant', 'a device code yields a token once')

const deviceMaya = { ...shopper, authorization: `Bearer ${deviceToken.body.access_token}` }
const deviceOrder = await post(accountRoot, "Where's my order?", deviceMaya)
assert(deviceOrder.body.status === 'done' && deviceOrder.body.reply.includes('poster'), 'the device token answers for the account that approved')
const deviceOther = await post(accountRoot, "Where's my order?", { 'cap-from': 'agent:other', authorization: deviceMaya.authorization })
assert(deviceOther.status === 403, 'the device token is bound to the CAP-From that started the login')

const deviceRenew = await oauthForm(accountRoot, 'token', { grant_type: 'refresh_token', refresh_token: deviceToken.body.refresh_token, client_id: 'agent:shopper' })
assert(deviceRenew.status === 200, 'a device login refreshes with its agent: client id')
await oauthForm(accountRoot, 'revoke', { token: deviceRenew.body.refresh_token, client_id: 'agent:shopper' })
assert((await post(accountRoot, "Where's my order?", { ...shopper, authorization: `Bearer ${deviceRenew.body.access_token}` })).status === 401, 'revoking ends the device login')

const toDeny = await oauthForm(accountRoot, 'device', { client_id: 'agent:shopper' })
await approveDevice(accountRoot, { user_code: toDeny.body.user_code, decision: 'deny' })
assert((await pollDevice(accountRoot, toDeny.body.device_code)).body.error === 'access_denied', 'a denied device login is access_denied')

const verifiedStart = await oauthForm(accountRoot, 'device', { client_id: clientId })
const verifiedHtml = await (await fetch(verifiedStart.body.verification_uri_complete)).text()
assert(verifiedStart.status === 200 && verifiedHtml.includes(clientBase.slice(7)) && !verifiedHtml.includes('not verified'), 'a client document makes the name verified by its host')

const slowRoot = await start('slow-device', { agent, oauth: { ...oauthConfig, device_interval: 60 } }, { answer: orderAnswer })
const slowStart = await oauthForm(slowRoot, 'device', { client_id: 'agent:shopper' })
await pollDevice(slowRoot, slowStart.body.device_code)
const tooFast = await pollDevice(slowRoot, slowStart.body.device_code)
assert(tooFast.body.error === 'slow_down', 'polling faster than the interval is slow_down')

// Write access: asked for by the caller, chosen by the person, never widened.
assert(!('scopes_supported' in meta.body), 'an owner without write lists no scopes')
const writeOnReadOwner = await oauthForm(accountRoot, 'device', { client_id: 'agent:shopper', scope: 'write' })
assert(writeOnReadOwner.status === 400 && writeOnReadOwner.body.error === 'invalid_scope', 'write on an owner that does not offer it is invalid_scope')
const writeRedirect = new URL((await startLogin(accountRoot, { scope: 'write' })).res.headers.get('location') || 'http://x/')
assert(writeRedirect.searchParams.get('error') === 'invalid_scope', 'the redirect login returns invalid_scope too')

const POSTS = new Map([['hello-world', 'Hello World'], ['second-post', 'Second Post']])
const actions = []
const writeAnswer = async ({ message, account, scope }) => {
  if (!account) return { error: { code: 'login_required', message: 'Log in first.' } }
  const remove = message.match(/^delete (\S+)$/i)
  if (remove) {
    if (!POSTS.has(remove[1])) return { reply: 'There is no such post.' }
    return { confirm: { summary: `Delete the post "${POSTS.get(remove[1])}".`, authorization_details: [{ type: 'delete_post', post: remove[1] }] } }
  }
  if (/^rename/i.test(message)) {
    if (scope !== 'write') return { error: { code: 'write_required', message: 'This login can read but not make changes.' } }
    return { reply: 'Renamed.' }
  }
  return { reply: `Posts: ${[...POSTS.values()].join(', ')}` }
}
const writeAct = async ({ account, authorization_details, caller }) => {
  actions.push({ account, caller })
  POSTS.delete(authorization_details[0].post)
  return { message: `Deleted ${authorization_details[0].post}.` }
}
const writeRoot = await start('write', { agent, oauth: { ...oauthConfig, write: true } }, { answer: writeAnswer, act: writeAct })
const writeMeta = await json(`${writeRoot}/.well-known/oauth-authorization-server/oauth`)
assert(JSON.stringify(writeMeta.body.scopes_supported) === '["read","write"]', 'an owner with write lists read and write')
const bogusScope = await oauthForm(writeRoot, 'device', { client_id: 'agent:shopper', scope: 'admin' })
assert(bogusScope.body.error === 'invalid_scope', 'an unknown scope is invalid_scope')

async function deviceLogin(rootUrl, { scope, decision, username = 'maya' }) {
  const begun = await oauthForm(rootUrl, 'device', { client_id: 'agent:shopper', ...(scope ? { scope } : {}) })
  const html = await (await fetch(begun.body.verification_uri_complete)).text()
  await approveDevice(rootUrl, { user_code: begun.body.user_code, username, password: `${username}-pass`, decision })
  return { html, token: (await pollDevice(rootUrl, begun.body.device_code)).body }
}

const writeLogin = await deviceLogin(writeRoot, { scope: 'write', decision: 'allow_write' })
assert(writeLogin.html.includes('make changes') && writeLogin.html.includes('value="allow_write"') && writeLogin.html.includes('Allow read only'), 'the page says changes were asked for and offers read only')
assert(writeLogin.token.scope === 'read write' && writeLogin.token.expires_in === 900, 'allowing changes grants read write with a shorter token')
const narrowed = await deviceLogin(writeRoot, { scope: 'write', decision: 'allow' })
assert(narrowed.token.scope === 'read' && narrowed.token.expires_in === 3600, 'the person can narrow write to read')
const widened = await deviceLogin(writeRoot, { decision: 'allow_write' })
assert(!widened.html.includes('allow_write') && widened.token.scope === 'read', 'a read login is never widened to write')

const redirectWrite = await startLogin(writeRoot, { scope: 'write' })
assert(redirectWrite.html.includes('make changes'), 'the redirect login page says changes were asked for')
const redirectBack = await submitLogin(writeRoot, redirectWrite.request, { username: 'maya', password: 'maya-pass', decision: 'allow_write' })
const redirectCode = new URL(redirectBack.headers.get('location')).searchParams.get('code')
const redirectToken = await oauthForm(writeRoot, 'token', exchange(redirectCode, redirectWrite.verifier))
assert(redirectToken.body.scope === 'read write', 'the redirect login grants write when the person allows it')
const renewedWrite = await oauthForm(writeRoot, 'token', { grant_type: 'refresh_token', refresh_token: redirectToken.body.refresh_token, client_id: clientId })
assert(renewedWrite.body.scope === 'read write', 'a renewed token keeps its scope')

const writer = { ...shopper, authorization: `Bearer ${writeLogin.token.access_token}` }
const reader = { ...shopper, authorization: `Bearer ${narrowed.token.access_token}` }
const readRename = await post(writeRoot, 'rename hello-world', reader)
assert(readRename.body.status === 'failed' && readRename.body.error.code === 'write_required', 'the owner sees the scope and refuses a change on read')
const readDelete = await post(writeRoot, 'delete hello-world', reader)
assert(readDelete.body.status === 'failed' && readDelete.body.error.code === 'write_required' && !readDelete.body.confirmation, 'a read login cannot even ask for a confirmed action')
assert((await post(writeRoot, 'rename hello-world', writer)).body.reply === 'Renamed.', 'a write login makes a plain change')

// A delete waits for the person. The token alone never runs it.
const held = await post(writeRoot, 'delete hello-world', writer)
const confirmation = held.body.confirmation
assert(held.body.status === 'done' && confirmation?.status === 'pending', 'a held action is done with a pending confirmation')
assert(/^cfm_[A-Za-z0-9_-]{20,}$/.test(confirmation.id) && confirmation.url === `${writeRoot}/oauth/confirm?id=${confirmation.id}`, 'the confirmation carries its id and link')
assert(held.body.reply.includes(confirmation.url) && confirmation.summary === 'Delete the post "Hello World".', 'the reply gives the person the summary and the link')
assert(confirmation.authorization_details[0].type === 'delete_post' && confirmation.expires_at, 'the confirmation describes the action and when it expires')
assert(POSTS.has('hello-world') && actions.length === 0, 'nothing runs before the person approves')

const confirmPath = `${writeRoot}/cap/v1/confirmations/${confirmation.id}`
const pendingRead = await json(confirmPath, { headers: headers(writer) })
assert(pendingRead.status === 200 && pendingRead.body.status === 'pending' && pendingRead.headers.get('retry-after') === '5', 'a pending confirmation reads with Retry-After')
assert((await json(confirmPath, { headers: headers(shopper) })).status === 404, 'a confirmation is not visible without a token')
assert((await json(confirmPath, { headers: headers({ 'cap-from': 'agent:other', authorization: writer.authorization }) })).status === 403, 'a confirmation read with another CAP-From is 403')
const samWrite = await deviceLogin(writeRoot, { scope: 'write', decision: 'allow_write', username: 'sam' })
assert((await json(confirmPath, { headers: headers({ ...shopper, authorization: `Bearer ${samWrite.token.access_token}` }) })).status === 404, 'another account cannot see the confirmation')

function decide(fields) {
  return fetch(`${writeRoot}/oauth/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: confirmation.id, ...fields }),
  })
}
const confirmHtml = await (await fetch(confirmation.url)).text()
assert(confirmHtml.includes('Delete the post &quot;Hello World&quot;.') && confirmHtml.includes('agent:shopper'), 'the confirm page shows the summary and the asking agent')
const wrongPerson = await decide({ username: 'sam', password: 'sam-pass', decision: 'approve' })
assert(wrongPerson.status === 401 && POSTS.has('hello-world'), 'another account cannot approve')
const approvedAction = await decide({ username: 'maya', password: 'maya-pass', decision: 'approve' })
assert(approvedAction.status === 200 && (await approvedAction.text()).includes('Deleted hello-world.'), 'the person approves and sees the result')
assert(!POSTS.has('hello-world') && actions.length === 1 && actions[0].account === 'maya' && actions[0].caller === 'shopper', 'the action runs once, as the person')
const againAction = await decide({ username: 'maya', password: 'maya-pass', decision: 'approve' })
assert(againAction.status === 400 && actions.length === 1, 'an approved action never runs twice')

const doneRead = await json(confirmPath, { headers: headers(writer) })
assert(doneRead.body.status === 'done' && doneRead.body.result?.message === 'Deleted hello-world.' && !doneRead.body.url, 'a done confirmation carries the result and no link')
assert(!doneRead.headers.get('retry-after'), 'a finished confirmation sets no Retry-After')
const heldAgain = await json(`${writeRoot}/cap/v1/messages/${held.body.id}`, { headers: headers(writer) })
assert(heldAgain.body.confirmation?.status === 'done', 'the message shows the confirmation as it is now')

const toRefuse = await post(writeRoot, 'delete second-post', writer)
const refuseId = toRefuse.body.confirmation.id
await fetch(`${writeRoot}/oauth/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id: refuseId, decision: 'deny' }) })
const refused = await json(`${writeRoot}/cap/v1/confirmations/${refuseId}`, { headers: headers(writer) })
assert(refused.body.status === 'denied' && POSTS.has('second-post') && actions.length === 1, 'a denied action never runs')
assert((await json(`${writeRoot}/cap/v1/confirmations/cfm_nope`, { headers: headers(writer) })).status === 404, 'an unknown confirmation is 404')

// With the http handler, the hook holds the action and later receives it as `confirmed`.
const hookActions = []
const actionHook = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  res.writeHead(200, { 'content-type': 'application/json' })
  if (body.confirmed) {
    hookActions.push(body.confirmed)
    res.end(JSON.stringify({ message: 'Refunded.' }))
    return
  }
  res.end(JSON.stringify(body.scope === 'write'
    ? { reply: 'A refund needs your OK:', confirm: { summary: 'Refund order 42.', authorization_details: [{ type: 'refund', order: '42' }] } }
    : { reply: `scope ${body.scope}` }))
})
const actionHookPort = await listen(actionHook)
const hookWriteRoot = await start('hook-write', {
  agent,
  oauth: { ...oauthConfig, write: true },
  handler: { type: 'http', url: `http://127.0.0.1:${actionHookPort}` },
})
const hookWriter = await deviceLogin(hookWriteRoot, { scope: 'write', decision: 'allow_write' })
const hookHeld = await post(hookWriteRoot, 'refund please', { ...shopper, authorization: `Bearer ${hookWriter.token.access_token}` })
assert(hookHeld.body.confirmation?.status === 'pending' && hookHeld.body.reply.startsWith('A refund needs your OK: http'), 'the hook can hold an action, and its reply leads the link')
await fetch(`${hookWriteRoot}/oauth/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ id: hookHeld.body.confirmation.id, username: 'maya', password: 'maya-pass', decision: 'approve' }),
})
assert(hookActions.length === 1 && hookActions[0].account === 'maya' && hookActions[0].authorization_details[0].order === '42', 'the approved action goes back to the hook once')
actionHook.close()

const lapsed = publicConfirmation({ id: 'cfm_x', status: 'pending', summary: 's', authorization_details: [], expires_at: new Date(Date.now() - 1000).toISOString() }, 'https://x/confirm')
assert(lapsed.status === 'expired' && !lapsed.url, 'a pending confirmation past its time reads as expired, with no link')

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
clientDocs.close()
rmSync(dir, { recursive: true, force: true })

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('reference server checks passed')
