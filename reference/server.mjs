import { createServer } from 'node:http'
import { fail, readBody, requestOrigin, send } from './http.mjs'
import { newConfirmationId, newMessageId, startOfUtcDay } from './store.mjs'

const MAX_MESSAGE = 8000
const MAX_SUMMARY = 300
const CONFIRM_TTL_MS = 10 * 60_000

export function publicMessage(msg, confirmation = null) {
  const view = { id: msg.id, status: msg.status }
  if (msg.status === 'done') view.reply = msg.reply ?? ''
  if (msg.status === 'failed') view.error = msg.error || { code: 'failed', message: 'The agent could not answer.' }
  if (msg.status === 'done' && confirmation) view.confirmation = confirmation
  view.created_at = msg.created_at
  view.finished_at = msg.finished_at || null
  return view
}

/** A pending request past its time reads as expired, and only a pending one carries the link. */
export function publicConfirmation(c, url) {
  const status = c.status === 'pending' && Date.parse(c.expires_at) <= Date.now() ? 'expired' : c.status
  const view = { id: c.id, status }
  if (status === 'pending') view.url = url
  view.summary = c.summary
  view.authorization_details = c.authorization_details
  view.expires_at = c.expires_at
  if ((status === 'done' || status === 'failed') && c.result) view.result = c.result
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
 * `answer({ message, context, history, account, scope, caller })` resolves to `{ reply }` or `{ error: { code, message } }`.
 * `history` is the earlier turns of the thread, oldest first, from the owner's own records.
 * `scope` is `read` or `write` with a token, and null without one.
 * To hold an action for the person's approval, it resolves to
 * `{ confirm: { summary, authorization_details }, reply? }` instead.
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
  oauth = null,
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

  async function view(msg, origin) {
    if (msg.status !== 'done' || !msg.confirmation_id || !oauth) return publicMessage(msg)
    const confirmation = await store.confirmationById(msg.confirmation_id)
    return publicMessage(msg, confirmation ? publicConfirmation(confirmation, oauth.confirmUrl(origin, confirmation.id)) : null)
  }

  async function respond(res, msg, origin) {
    if (msg.status === 'working') {
      send(res, 202, publicMessage(msg), {
        headers: { location: `/cap/v1/messages/${msg.id}`, 'retry-after': String(retryAfter) },
      })
      return
    }
    send(res, 200, await view(msg, origin))
  }

  const failedWith = (code, message) => ({ status: 'failed', reply: null, error: { code, message } })

  // The action is not run here. It waits for the person on the confirm page.
  async function hold(value, msg, scope, origin) {
    if (!oauth?.canConfirm || !msg.account) {
      return { result: failedWith('failed', `${agent.name} cannot hold an action for approval.`) }
    }
    if (scope !== 'write') {
      return { result: failedWith('write_required', 'This login can read but not make changes. Log in again and allow changes.') }
    }
    const summary = String(value.confirm.summary || '').trim().slice(0, MAX_SUMMARY)
    if (!summary) return { result: failedWith('failed', 'The agent could not answer.') }
    const details = Array.isArray(value.confirm.authorization_details) ? value.confirm.authorization_details : []
    const id = newConfirmationId()
    const now = Date.now()
    await store.insertConfirmation({
      id,
      caller_id: msg.caller_id,
      account: msg.account,
      client_id: msg.client_id,
      message_id: msg.id,
      summary,
      authorization_details: details,
      expires_at: new Date(now + CONFIRM_TTL_MS).toISOString(),
      created_at: new Date(now).toISOString(),
    })
    const lead = typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : `${summary} This needs your OK first:`
    return { id, result: { status: 'done', reply: `${lead} ${oauth.confirmUrl(origin, id)}`, error: null } }
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
    if (!grant || grant.kind === 'refresh') return { status: 401, code: 'unauthorized', message: 'The token is invalid, expired, or revoked.' }
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
    const origin = requestOrigin(req, publicUrl)
    if (req.method === 'GET' && url.pathname === '/agent.txt') {
      const oauthLine = agent.oauth || (oauth ? oauth.issuer(origin) : '')
      const lines = [
        'Protocol: CAP/1.0',
        `Name: ${agent.name}`,
        agent.chat ? `Chat: ${agent.chat}` : '',
        `CAP: ${origin}/cap/v1`,
        oauthLine ? `OAuth: ${oauthLine}` : '',
        agent.spec ? `Spec: ${agent.spec}` : '',
      ].filter(Boolean)
      send(res, 200, null, { type: 'text/plain; charset=utf-8', raw: `${lines.join('\n')}\n` })
      return
    }
    if (oauth && (await oauth.handle(req, res, url, origin))) return
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
      await sendMessage(req, res, caller, origin)
      return
    }
    const readMatch = url.pathname.match(/^\/cap\/v1\/messages\/([^/]+)$/)
    if (req.method === 'GET' && readMatch) {
      await readMessage(req, res, caller, decodeURIComponent(readMatch[1]), origin)
      return
    }
    const confirmMatch = url.pathname.match(/^\/cap\/v1\/confirmations\/([^/]+)$/)
    if (req.method === 'GET' && confirmMatch) {
      await readConfirmation(req, res, caller, decodeURIComponent(confirmMatch[1]), origin)
      return
    }
    fail(res, 404, 'not_found', 'Not found.')
  }

  async function sendMessage(req, res, caller, origin) {
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
    const scope = access.grant ? (access.grant.scope === 'write' ? 'write' : 'read') : null
    const key = String(req.headers['idempotency-key'] || '')
    if (key && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
      fail(res, 400, 'invalid_request', 'Idempotency-Key is invalid.')
      return
    }
    if (key) {
      const existing = await store.byIdempotency({ callerId: caller, account, clientId: client, key })
      if (existing) {
        await respond(res, existing, origin)
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
      await respond(res, saved.message, origin)
      return
    }

    const work = Promise.resolve()
      .then(() => answer({ message: msg.message, context: msg.context, history, account: account || null, scope, caller }))
      .catch(() => ({ error: { code: 'failed', message: 'The agent could not answer.' } }))
      .then(async (value) => {
        const held = value?.confirm && !value.error ? await hold(value, msg, scope, origin) : null
        const result = held ? held.result : outcome(value)
        const confirmationId = held?.id || null
        const finishedAt = new Date().toISOString()
        await store.finish(msg.id, { ...result, finishedAt, confirmationId })
        Object.assign(msg, result, { finished_at: finishedAt, confirmation_id: confirmationId })
      })
    let timer
    const waited = new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })
    await Promise.race([work, waited])
    clearTimeout(timer)
    await respond(res, msg, origin)
  }

  async function readConfirmation(req, res, caller, id, origin) {
    const access = await grantFor(req, caller)
    if (!access.grant && access.status) {
      fail(res, access.status, access.code, access.message)
      return
    }
    const confirmation = oauth && access.grant ? await store.confirmationById(id) : null
    const visible = confirmation
      && confirmation.caller_id === caller
      && confirmation.account === access.grant.account
      && confirmation.client_id === access.grant.client_id
    if (!visible) {
      fail(res, 404, 'not_found', 'Confirmation not found.')
      return
    }
    const body = publicConfirmation(confirmation, oauth.confirmUrl(origin, confirmation.id))
    const waiting = body.status === 'pending' || body.status === 'working'
    send(res, 200, body, waiting ? { headers: { 'retry-after': String(retryAfter) } } : {})
  }

  async function readMessage(req, res, caller, id, origin) {
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
    send(res, 200, await view(msg, origin))
  }

  return { server }
}
