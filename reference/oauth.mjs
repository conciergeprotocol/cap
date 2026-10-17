import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { readBody, send } from './http.mjs'

const CODE_TTL_MS = 10 * 60_000
const REQUEST_TTL_MS = 10 * 60_000
const DEVICE_TTL_SECONDS = 600
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
// No vowels or look-alikes, so a code never spells a word or misreads (RFC 8628, 6.1).
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const REFRESH_TTL_MS = 30 * 24 * 3_600_000
const MAX_CLIENT_DOC = 16_000
const CAP_FROM_RE = /^agent:([A-Za-z0-9_.-]{1,64})$/
const PKCE_RE = /^[A-Za-z0-9._~-]{43,128}$/
const LOOPBACK = new Set(['127.0.0.1', '[::1]'])

const random = (bytes = 32) => randomBytes(bytes).toString('base64url')
const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url')

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function oauthError(res, status, error, description) {
  send(res, status, { error, error_description: description })
}

function redirect(res, target) {
  res.writeHead(302, { location: target, 'cache-control': 'no-store' })
  res.end()
}

function withParams(uri, params) {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)
  return url.toString()
}

async function readForm(req) {
  const type = String(req.headers['content-type'] || '')
  if (!type.startsWith('application/x-www-form-urlencoded')) return null
  return new URLSearchParams(await readBody(req))
}

/** A loopback redirect matches on any port (RFC 8252). Anything else matches exactly. */
export function redirectAllowed(registered, requested) {
  if (registered.includes(requested)) return true
  let asked
  try {
    asked = new URL(requested)
  } catch {
    return false
  }
  if (asked.protocol !== 'http:' || !LOOPBACK.has(asked.hostname)) return false
  return registered.some((uri) => {
    try {
      const listed = new URL(uri)
      return listed.protocol === 'http:'
        && listed.hostname === asked.hostname
        && listed.pathname === asked.pathname
        && listed.search === asked.search
    } catch {
      return false
    }
  })
}

/**
 * The visiting agent's client id is a URL to its own metadata document. There
 * is no registration step. The document names the CAP-From the token is bound to.
 */
export async function fetchClient(clientId, { allowHttpClients = false, fetchImpl = fetch } = {}) {
  let url
  try {
    url = new URL(clientId)
  } catch {
    return { error: 'client_id must be a URL.' }
  }
  const local = url.hostname === 'localhost' || isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0
  if (!allowHttpClients && (url.protocol !== 'https:' || local)) {
    return { error: 'client_id must be an https URL on a public host.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'client_id must be an http(s) URL.' }

  let text
  try {
    const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
    if (!res.ok) return { error: 'The client document could not be fetched.' }
    text = await res.text()
  } catch {
    return { error: 'The client document could not be fetched.' }
  }
  if (text.length > MAX_CLIENT_DOC) return { error: 'The client document is too large.' }

  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return { error: 'The client document is not JSON.' }
  }
  if (doc?.client_id !== clientId) return { error: 'The client document names a different client_id.' }
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((uri) => typeof uri === 'string') : []
  if (!redirectUris.length) return { error: 'The client document lists no redirect_uris.' }
  const capFrom = String(doc.cap_from || '').match(CAP_FROM_RE)
  if (!capFrom) return { error: 'The client document needs cap_from, such as agent:example.' }
  const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim().slice(0, 80) : url.host
  return { client: { clientId, name, host: url.host, redirectUris, capFrom: capFrom[1] } }
}

export function newUserCode() {
  const bytes = randomBytes(8)
  const chars = [...bytes].map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

export function normalizeUserCode(input) {
  const chars = String(input || '').toUpperCase().replace(/[^A-Z]/g, '')
  return chars.length === 8 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : ''
}

/**
 * The client id for the code login: either the caller's own CAP-From, which the
 * owner shows as unverified, or a client id metadata document URL.
 */
export async function resolveDeviceClient(clientId, clientName, options) {
  const bare = String(clientId || '').match(CAP_FROM_RE)
  if (bare) {
    const name = typeof clientName === 'string' && clientName.trim() ? clientName.trim().slice(0, 80) : bare[0]
    return { client: { clientId: bare[0], name, host: '', capFrom: bare[1] } }
  }
  const found = await fetchClient(clientId, options)
  if (found.error) return found
  return { client: { ...found.client } }
}

/**
 * OAuth 2.1 for account questions: the device code login, authorization code
 * with PKCE, client id metadata documents, refresh rotation, and revocation.
 *
 * `login({ username, password })` resolves to the account id, or null.
 */
export function createOAuth({
  store,
  agentName,
  login,
  path = '/oauth',
  accessTokenSeconds = 3600,
  allowHttpClients = false,
  hint = '',
  fetchImpl = fetch,
  deviceInterval = 5,
}) {
  const requests = new Map()
  const issuer = (origin) => `${origin}${path}`
  const metadataPath = `/.well-known/oauth-authorization-server${path}`

  function metadata(origin) {
    return {
      issuer: issuer(origin),
      device_authorization_endpoint: `${issuer(origin)}/device`,
      authorization_endpoint: `${issuer(origin)}/authorize`,
      token_endpoint: `${issuer(origin)}/token`,
      revocation_endpoint: `${issuer(origin)}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: [DEVICE_GRANT, 'authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }
  }

  function page(res, status, { title, body }) {
    send(res, status, null, {
      type: 'text/html; charset=utf-8',
      headers: { 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" },
      raw: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 20px}label{display:block;margin-top:12px}input{width:100%;padding:8px;font:inherit;box-sizing:border-box}.row{display:flex;gap:8px;margin-top:20px}button{padding:10px 14px;font:inherit}.muted{color:#666}.error{color:#b00020}</style>
</head><body>${body}</body></html>`,
    })
  }

  function errorPage(res, status, message) {
    page(res, status, { title: 'Login error', body: `<h1>Login error</h1><p>${escape(message)}</p><p class="muted">Go back to your agent and start again.</p>` })
  }

  function consentPage(res, status, id, pending, error = '') {
    const { client } = pending
    page(res, status, {
      title: `Log in to ${agentName}`,
      body: `<h1>Log in to ${escape(agentName)}</h1>
<p><strong>${escape(client.name)}</strong> (${escape(client.host)}) wants to ask ${escape(agentName)} about your account.</p>
<p class="muted">It will get answers about your account. It will not see your password.</p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
${hint ? `<p class="muted">${escape(hint)}</p>` : ''}
<form method="post" action="${escape(path)}/authorize">
<input type="hidden" name="request" value="${escape(id)}">
<label>Username <input name="username" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<div class="row"><button name="decision" value="allow">Log in and allow</button><button name="decision" value="deny" formnovalidate>Deny</button></div>
</form>`,
    })
  }

  async function authorizeStart(res, url, origin) {
    const q = url.searchParams
    const clientId = q.get('client_id') || ''
    const redirectUri = q.get('redirect_uri') || ''
    const found = await fetchClient(clientId, { allowHttpClients, fetchImpl })
    if (found.error) return errorPage(res, 400, found.error)
    if (!redirectAllowed(found.client.redirectUris, redirectUri)) {
      return errorPage(res, 400, 'redirect_uri is not one the client document lists.')
    }
    const state = q.get('state') || ''
    const back = (error, description) => redirect(res, withParams(redirectUri, { error, error_description: description, state, iss: issuer(origin) }))
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be code.')
    if (!state) return back('invalid_request', 'state is required.')
    if (q.get('code_challenge_method') !== 'S256' || !PKCE_RE.test(q.get('code_challenge') || '')) {
      return back('invalid_request', 'PKCE with S256 is required.')
    }

    const now = Date.now()
    for (const [key, value] of requests) if (value.expires < now) requests.delete(key)
    const id = random(24)
    const pending = { client: found.client, redirectUri, state, codeChallenge: q.get('code_challenge'), expires: now + REQUEST_TTL_MS }
    requests.set(id, pending)
    consentPage(res, 200, id, pending)
  }

  async function authorizeFinish(req, res, origin) {
    const form = await readForm(req)
    const id = form?.get('request') || ''
    const pending = requests.get(id)
    if (!pending || pending.expires < Date.now()) {
      requests.delete(id)
      return errorPage(res, 400, 'This login expired.')
    }
    const back = (params) => redirect(res, withParams(pending.redirectUri, { ...params, state: pending.state, iss: issuer(origin) }))
    if (form.get('decision') !== 'allow') {
      requests.delete(id)
      return back({ error: 'access_denied', error_description: 'The person denied access.' })
    }
    const account = await login({ username: form.get('username') || '', password: form.get('password') || '' })
    if (!account) return consentPage(res, 401, id, pending, 'That username and password did not match.')

    requests.delete(id)
    const code = random()
    await store.insertCode({
      code,
      account,
      oauthClient: pending.client.clientId,
      capFrom: pending.client.capFrom,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    back({ code })
  }

  async function deviceStart(req, res, origin) {
    const form = await readForm(req)
    if (!form) return oauthError(res, 400, 'invalid_request', 'The body must be a form.')
    const found = await resolveDeviceClient(form.get('client_id'), form.get('client_name'), { allowHttpClients, fetchImpl })
    if (found.error) return oauthError(res, 400, 'invalid_client', found.error)
    const { client } = found
    const deviceCode = random()
    let userCode = newUserCode()
    for (let attempt = 0; await store.deviceByUserCode(userCode); attempt++) {
      if (attempt > 5) return oauthError(res, 503, 'temporarily_unavailable', 'Try again.')
      userCode = newUserCode()
    }
    await store.insertDevice({
      deviceCode,
      userCode,
      oauthClient: client.clientId,
      capFrom: client.capFrom,
      clientName: client.name,
      verifiedHost: client.host,
      expiresAt: new Date(Date.now() + DEVICE_TTL_SECONDS * 1000).toISOString(),
    })
    const verification = `${issuer(origin)}/device`
    send(res, 200, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verification,
      verification_uri_complete: `${verification}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_TTL_SECONDS,
      interval: deviceInterval,
    })
  }

  function devicePage(res, status, { userCode = '', device = null, error = '', done = '' }) {
    const who = device
      ? device.verified_host
        ? `<p><strong>${escape(device.client_name)}</strong> (${escape(device.verified_host)}) wants to ask ${escape(agentName)} about your account.</p>`
        : `<p><strong>${escape(device.client_name)}</strong> (agent:${escape(device.cap_from)}, name not verified) wants to ask ${escape(agentName)} about your account.</p>`
      : ''
    const body = done
      ? `<h1>${escape(done)}</h1><p class="muted">Go back to your agent.</p>`
      : `<h1>Log in to ${escape(agentName)}</h1>
${who}
<p class="muted">Allow this only if your agent just showed you this code. It will get answers about your account. It will not see your password.</p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
${hint ? `<p class="muted">${escape(hint)}</p>` : ''}
<form method="post" action="${escape(path)}/device/approve">
<label>Code <input name="user_code" value="${escape(userCode)}" autocomplete="off" required></label>
<label>Username <input name="username" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<div class="row"><button name="decision" value="allow">Log in and allow</button><button name="decision" value="deny" formnovalidate>Deny</button></div>
</form>`
    page(res, status, { title: `Log in to ${agentName}`, body })
  }

  async function deviceView(res, url) {
    const userCode = normalizeUserCode(url.searchParams.get('user_code'))
    const device = userCode ? await store.deviceByUserCode(userCode) : null
    const status = device && device.status === 'pending' ? 200 : userCode ? 400 : 200
    const error = userCode && (!device || device.status !== 'pending') ? 'That code is expired or already used.' : ''
    devicePage(res, status, { userCode: device ? userCode : '', device: device && device.status === 'pending' ? device : null, error })
  }

  async function deviceApprove(req, res) {
    const form = await readForm(req)
    if (!form) return devicePage(res, 400, { error: 'The body must be a form.' })
    const userCode = normalizeUserCode(form.get('user_code'))
    const device = userCode ? await store.deviceByUserCode(userCode) : null
    if (!device || device.status !== 'pending') {
      return devicePage(res, 400, { userCode: form.get('user_code') || '', error: 'That code is expired or already used.' })
    }
    if (form.get('decision') !== 'allow') {
      await store.decideDevice(userCode, { status: 'denied' })
      return devicePage(res, 200, { done: 'Access denied' })
    }
    const account = await login({ username: form.get('username') || '', password: form.get('password') || '' })
    if (!account) return devicePage(res, 401, { userCode, device, error: 'That username and password did not match.' })
    const decided = await store.decideDevice(userCode, { status: 'approved', account })
    if (!decided) return devicePage(res, 400, { error: 'That code is expired or already used.' })
    devicePage(res, 200, { done: 'You are logged in' })
  }

  async function deviceToken(res, form) {
    const deviceCode = form.get('device_code') || ''
    const clientId = form.get('client_id') || ''
    const device = await store.deviceByCode(deviceCode)
    if (!device || device.oauth_client !== clientId) {
      return oauthError(res, 400, 'invalid_grant', 'The device code is invalid or already used.')
    }
    if (Date.parse(device.expires_at) <= Date.now()) return oauthError(res, 400, 'expired_token', 'The login expired. Start again.')
    if (device.status === 'denied') return oauthError(res, 400, 'access_denied', 'The person denied access.')
    if (device.status === 'pending') {
      const now = Date.now()
      const last = device.last_poll_at ? Date.parse(device.last_poll_at) : 0
      await store.touchDevice(deviceCode, new Date(now).toISOString())
      if (last && now - last < deviceInterval * 1000) {
        return oauthError(res, 400, 'slow_down', 'Poll less often.')
      }
      return oauthError(res, 400, 'authorization_pending', 'The person has not decided yet.')
    }
    const row = await store.takeApprovedDevice(deviceCode)
    if (!row) return oauthError(res, 400, 'invalid_grant', 'The device code is invalid or already used.')
    return issue(res, { account: row.account, capFrom: row.cap_from, oauthClient: row.oauth_client, grantId: random(16) })
  }

  async function issue(res, { account, capFrom, oauthClient, grantId }) {
    const accessToken = `cap_at_${random()}`
    const refreshToken = `cap_rt_${random()}`
    const shared = { account, clientId: capFrom, oauthClient, grantId }
    await store.upsertGrant({ ...shared, token: accessToken, kind: 'access', expiresAt: new Date(Date.now() + accessTokenSeconds * 1000).toISOString() })
    await store.upsertGrant({ ...shared, token: refreshToken, kind: 'refresh', expiresAt: new Date(Date.now() + REFRESH_TTL_MS).toISOString() })
    send(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: accessTokenSeconds, refresh_token: refreshToken })
  }

  async function token(req, res) {
    const form = await readForm(req)
    if (!form) return oauthError(res, 400, 'invalid_request', 'The body must be a form.')
    const clientId = form.get('client_id') || ''
    const grantType = form.get('grant_type')

    if (grantType === DEVICE_GRANT) return deviceToken(res, form)

    if (grantType === 'authorization_code') {
      const row = await store.takeCode(form.get('code') || '')
      const verifier = form.get('code_verifier') || ''
      const valid = row
        && row.oauth_client === clientId
        && row.redirect_uri === (form.get('redirect_uri') || '')
        && PKCE_RE.test(verifier)
        && s256(verifier) === row.code_challenge
      if (!valid) return oauthError(res, 400, 'invalid_grant', 'The code is invalid, expired, or already used.')
      return issue(res, { account: row.account, capFrom: row.cap_from, oauthClient: row.oauth_client, grantId: random(16) })
    }

    if (grantType === 'refresh_token') {
      const presented = form.get('refresh_token') || ''
      const grant = await store.grantByToken(presented)
      if (!grant || grant.kind !== 'refresh' || grant.oauth_client !== clientId) {
        return oauthError(res, 400, 'invalid_grant', 'The refresh token is invalid, expired, or revoked.')
      }
      await store.revokeGrant(presented)
      return issue(res, { account: grant.account, capFrom: grant.client_id, oauthClient: grant.oauth_client, grantId: grant.grant_id })
    }

    oauthError(res, 400, 'unsupported_grant_type', `grant_type must be ${DEVICE_GRANT}, authorization_code, or refresh_token.`)
  }

  // Always 200, so a caller cannot probe which tokens exist (RFC 7009).
  async function revoke(req, res) {
    const form = await readForm(req)
    if (!form) return oauthError(res, 400, 'invalid_request', 'The body must be a form.')
    const presented = form.get('token') || ''
    const grant = await store.grantByToken(presented)
    if (grant && grant.oauth_client === (form.get('client_id') || '')) {
      if (grant.grant_id) await store.revokeGrantId(grant.grant_id)
      else await store.revokeGrant(presented)
    }
    send(res, 200, {})
  }

  async function handle(req, res, url, origin) {
    if (req.method === 'GET' && url.pathname === metadataPath) {
      send(res, 200, metadata(origin))
      return true
    }
    if (url.pathname === `${path}/authorize`) {
      if (req.method === 'GET') await authorizeStart(res, url, origin)
      else if (req.method === 'POST') await authorizeFinish(req, res, origin)
      else return false
      return true
    }
    if (url.pathname === `${path}/device`) {
      if (req.method === 'POST') await deviceStart(req, res, origin)
      else if (req.method === 'GET') await deviceView(res, url)
      else return false
      return true
    }
    if (req.method === 'POST' && url.pathname === `${path}/device/approve`) {
      await deviceApprove(req, res)
      return true
    }
    if (req.method === 'POST' && url.pathname === `${path}/token`) {
      await token(req, res)
      return true
    }
    if (req.method === 'POST' && url.pathname === `${path}/revoke`) {
      await revoke(req, res)
      return true
    }
    return false
  }

  return { handle, issuer }
}
