import { createServer } from 'node:http'
import { newMessageId, startOfUtcDay } from './store.mjs'

const MAX_BODY = 1_000_000
const MAX_MESSAGE = 8000

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': extra.type || 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, cap-version, cap-from, idempotency-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'location, retry-after',
    'cache-control': 'no-store',
    ...(extra.headers || {}),
  })
  res.end(extra.raw ?? JSON.stringify(body))
}

function fail(res, status, code, message, headers) {
  send(res, status, { error: { code, message } }, { headers })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body is too large.'), { status: 400 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function publicMessage(msg) {
  const view = { id: msg.id, status: msg.status }
  if (msg.status === 'done') view.reply = msg.reply ?? ''
  if (msg.status === 'failed') view.error = msg.error || { code: 'failed', message: 'The agent could not answer.' }
  view.created_at = msg.created_at
  view.finished_at = msg.finished_at || null
  return view
}

function bearer(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : ''
}

function callerId(req) {
  const match = String(req.headers['cap-from'] || '').match(/^agent:([A-Za-z0-9_.-]{1,64})$/)
  return match ? match[1] : ''
}

function outcome(value) {
  if (value?.error) {
    return {
      status: 'failed',
      reply: null,
      error: { code: String(value.error.code || 'failed'), message: String(value.error.message || 'The agent could not answer.') },
    }
  }
  if (typeof value?.reply === 'string') return { status: 'done', reply: value.reply, error: null }
  return { status: 'failed', reply: null, error: { code: 'failed', message: 'The agent could not answer.' } }
}

/**
 * `answer({ message, context, history, account, caller })` resolves to `{ reply }` or `{ error: { code, message } }`.
 * `history` is the earlier turns of the thread, oldest first, from the owner's own records.
 * It runs on the owner. Nothing it uses is returned except the reply text.
 */
export function createCapServer({
  store,
  agent,
  answer,
  waitMs = 20_000,
  retryAfter = 5,
  retentionHours = 24,
  dailyLimit = 0,
  maxTurns = 20,
  demoOauth = false,
  publicUrl = '',
  extraRoutes,
}) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res)
    } catch (err) {
      if (res.headersSent) return
      const status = err.status || 500
      fail(res, status, status === 400 ? 'invalid_request' : 'failed', status === 400 ? err.message : 'Request failed.')
    }
  })

  function respond(res, msg) {
    if (msg.status === 'working') {
      send(res, 202, publicMessage(msg), {
        headers: { location: `/cap/v1/messages/${msg.id}`, 'retry-after': String(retryAfter) },
      })
      return
    }
    send(res, 200, publicMessage(msg))
  }

  function expired(msg) {
    return Boolean(msg.finished_at) && Date.now() - Date.parse(msg.finished_at) > retentionHours * 3_600_000
  }

  // A thread may move from no token to a token, never from one account to another.
  function canContinue(prev, caller, account, client) {
    if (!prev || prev.caller_id !== caller || expired(prev)) return false
    if (!prev.account && !prev.client_id) return true
    return prev.account === account && prev.client_id === client
  }

  async function threadFor(previousId, caller, account, client) {
    const first = await store.byId(previousId)
    if (!canContinue(first, caller, account, client)) {
      return { status: 404, code: 'not_found', message: 'previous_message_id was not found.' }
    }
    if (first.status === 'working') {
      return { status: 409, code: 'conflict', message: 'The previous message is still working.' }
    }
    const turns = []
    let cursor = first
    while (cursor) {
      if (turns.length >= maxTurns) {
        return { status: 409, code: 'conflict', message: 'This conversation is too long. Start a new one.' }
      }
      turns.unshift({ message: cursor.message, context: cursor.context, reply: cursor.status === 'done' ? cursor.reply : null })
      cursor = cursor.previous_id ? await store.byId(cursor.previous_id) : null
    }
    return { history: turns }
  }

  async function grantFor(req, caller) {
    if (!req.headers.authorization) return { grant: null }
    const grant = await store.grantByToken(bearer(req))
    if (!grant) return { status: 401, code: 'unauthorized', message: 'The token is invalid, expired, or revoked.' }
    if (grant.client_id !== caller) return { status: 403, code: 'forbidden', message: 'This token was issued to a different agent.' }
    return { grant }
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'OPTIONS') {
      send(res, 204, null, { raw: '' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname === '/agent.txt') {
      const origin = (publicUrl || forwardedOrigin(req)).replace(/\/$/, '')
      const lines = [
        'Protocol: CAP/1.0',
        `Name: ${agent.name}`,
        agent.chat ? `Chat: ${agent.chat}` : '',
        `CAP: ${origin}/cap/v1`,
        agent.oauth ? `OAuth: ${agent.oauth}` : '',
        agent.spec ? `Spec: ${agent.spec}` : '',
      ].filter(Boolean)
      send(res, 200, null, { type: 'text/plain; charset=utf-8', raw: `${lines.join('\n')}\n` })
      return
    }
    if (demoOauth && req.method === 'POST' && url.pathname === '/oauth/token') {
      let body = {}
      try {
        body = JSON.parse(await readBody(req) || '{}')
      } catch {
        fail(res, 400, 'invalid_request', 'Body must be JSON.')
        return
      }
      const account = String(body.account || '')
      const client = String(body.client || body.client_id || '')
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(account) || !/^[A-Za-z0-9_.-]{1,64}$/.test(client)) {
        fail(res, 400, 'invalid_request', 'account and client are required.')
        return
      }
      const token = `grant_${newMessageId().slice(4)}`
      await store.upsertGrant({ token, account, clientId: client })
      send(res, 200, { access_token: token, token_type: 'Bearer', account })
      return
    }
    if (demoOauth && req.method === 'POST' && url.pathname === '/oauth/revoke') {
      const token = bearer(req)
      if (!token || !(await store.grantByToken(token))) {
        fail(res, 401, 'unauthorized', 'The token is invalid, expired, or revoked.')
        return
      }
      await store.revokeGrant(token)
      send(res, 200, { revoked: true })
      return
    }
    if (extraRoutes && (await extraRoutes(req, res, url))) return

    if (!url.pathname.startsWith('/cap/v1/')) {
      fail(res, 404, 'not_found', 'Not found.')
      return
    }
    if (req.headers['cap-version'] !== '1.0') {
      fail(res, 400, 'version_not_supported', 'CAP-Version must be 1.0.')
      return
    }
    const caller = callerId(req)
    if (!caller) {
      fail(res, 400, 'invalid_request', 'CAP-From must be agent:{id}.')
      return
    }

    if (req.method === 'POST' && url.pathname === '/cap/v1/messages') {
      await sendMessage(req, res, caller)
      return
    }
    const readMatch = url.pathname.match(/^\/cap\/v1\/messages\/([^/]+)$/)
    if (req.method === 'GET' && readMatch) {
      await readMessage(req, res, caller, decodeURIComponent(readMatch[1]))
      return
    }
    fail(res, 404, 'not_found', 'Not found.')
  }

  async function sendMessage(req, res, caller) {
    if (agent.status && agent.status !== 'active') {
      fail(res, 503, 'unavailable', `${agent.name} is not answering right now.`)
      return
    }
    const access = await grantFor(req, caller)
    if (!access.grant && access.status) {
      fail(res, access.status, access.code, access.message)
      return
    }

    let body
    try {
      body = JSON.parse(await readBody(req) || '{}')
    } catch {
      fail(res, 400, 'invalid_request', 'Body must be JSON.')
      return
    }
    const text = typeof body.message === 'string' ? body.message.trim() : ''
    if (!text || text.length > MAX_MESSAGE) {
      fail(res, 400, 'invalid_request', `message must be text, up to ${MAX_MESSAGE} characters.`)
      return
    }
    if (body.context != null && (typeof body.context !== 'object' || Array.isArray(body.context))) {
      fail(res, 400, 'invalid_request', 'context must be an object.')
      return
    }
    const previousId = body.previous_message_id ?? null
    if (previousId != null && (typeof previousId !== 'string' || !previousId)) {
      fail(res, 400, 'invalid_request', 'previous_message_id must be a message id.')
      return
    }

    const account = access.grant?.account || ''
    const client = access.grant?.client_id || ''
    const key = String(req.headers['idempotency-key'] || '')
    if (key && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
      fail(res, 400, 'invalid_request', 'Idempotency-Key is invalid.')
      return
    }
    if (key) {
      const existing = await store.byIdempotency({ callerId: caller, account, clientId: client, key })
      if (existing) {
        respond(res, existing)
        return
      }
    }

    let history = []
    if (previousId) {
      const thread = await threadFor(previousId, caller, account, client)
      if (thread.status) {
        fail(res, thread.status, thread.code, thread.message)
        return
      }
      history = thread.history
    }

    if (dailyLimit > 0 && (await store.countSince(caller, startOfUtcDay())) >= dailyLimit) {
      fail(res, 429, 'rate_limited', 'Too many messages from this agent today.', { 'retry-after': '3600' })
      return
    }

    const msg = {
      id: newMessageId(),
      caller_id: caller,
      account,
      client_id: client,
      idempotency_key: key,
      previous_id: previousId,
      message: text,
      context: body.context || {},
      status: 'working',
      reply: null,
      error: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    }
    const saved = await store.insert(msg)
    if (!saved.created) {
      respond(res, saved.message)
      return
    }

    const work = Promise.resolve()
      .then(() => answer({ message: msg.message, context: msg.context, history, account: account || null, caller }))
      .catch(() => ({ error: { code: 'failed', message: 'The agent could not answer.' } }))
      .then(async (value) => {
        const result = outcome(value)
        const finishedAt = new Date().toISOString()
        await store.finish(msg.id, { ...result, finishedAt })
        Object.assign(msg, result, { finished_at: finishedAt })
      })
    let timer
    const waited = new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })
    await Promise.race([work, waited])
    clearTimeout(timer)
    respond(res, msg)
  }

  async function readMessage(req, res, caller, id) {
    const access = await grantFor(req, caller)
    if (!access.grant && access.status) {
      fail(res, access.status, access.code, access.message)
      return
    }
    const msg = await store.byId(id)
    const visible = msg
      && msg.caller_id === caller
      && msg.account === (access.grant?.account || '')
      && msg.client_id === (access.grant?.client_id || '')
    if (!visible || expired(msg)) {
      fail(res, 404, 'not_found', 'Message not found.')
      return
    }
    if (msg.status === 'working') {
      send(res, 200, publicMessage(msg), { headers: { 'retry-after': String(retryAfter) } })
      return
    }
    send(res, 200, publicMessage(msg))
  }

  return { server }
}

function forwardedOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1'
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${host}`
}
