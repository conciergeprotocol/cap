import { randomBytes } from 'node:crypto'

const MAX_MESSAGE = 8000
const MAX_BODY = 1_000_000
const MAX_THREAD = 20
const FROM = /^agent:[A-Za-z0-9_.-]{1,64}$/
const KEY = /^[A-Za-z0-9_.:-]{1,128}$/

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, cap-version, cap-from, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'location, retry-after',
  'cache-control': 'no-store',
}

/**
 * A CAP door for one app. `answer` is the function the app already has.
 * It receives `{ message, context, history }` and returns a reply string,
 * `{ reply }`, or `{ error: { code, message } }`.
 */
export function createDoor({ name, chat = '', answer, waitMs = 2000, retryAfter = 2 }) {
  const messages = new Map()
  const byKey = new Map()

  function handle(request) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method === 'GET' && url.pathname === '/agent.txt') return card(url, name, chat)
    if (!url.pathname.startsWith('/cap/v1/')) return fail(404, 'not_found', 'Not found.')
    if (request.headers.get('cap-version') !== '1.0') return fail(400, 'version_not_supported', 'CAP-Version must be 1.0.')
    const caller = request.headers.get('cap-from') || ''
    if (!FROM.test(caller)) return fail(400, 'invalid_request', 'CAP-From must be agent:{id}.')

    if (request.method === 'POST' && url.pathname === '/cap/v1/messages') return post(request, caller, url)
    const read = url.pathname.match(/^\/cap\/v1\/messages\/([^/]+)$/)
    if (request.method === 'GET' && read) return get(caller, decodeURIComponent(read[1]), url)
    return fail(404, 'not_found', 'Not found.')
  }

  async function post(request, caller, url) {
    const raw = await request.text()
    if (raw.length > MAX_BODY) return fail(400, 'invalid_request', 'Body is too large.')
    let body
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      return fail(400, 'invalid_request', 'Body must be JSON.')
    }
    const text = typeof body.message === 'string' ? body.message.trim() : ''
    if (!text || text.length > MAX_MESSAGE) return fail(400, 'invalid_request', `message must be text, up to ${MAX_MESSAGE} characters.`)
    if (body.context != null && (typeof body.context !== 'object' || Array.isArray(body.context))) {
      return fail(400, 'invalid_request', 'context must be an object.')
    }
    const previousId = body.previous_message_id ?? null
    if (previousId != null && typeof previousId !== 'string') return fail(400, 'invalid_request', 'previous_message_id must be a message id.')

    const key = request.headers.get('idempotency-key') || ''
    if (key && !KEY.test(key)) return fail(400, 'invalid_request', 'Idempotency-Key is invalid.')
    if (key && byKey.has(`${caller}\n${key}`)) return respond(byKey.get(`${caller}\n${key}`), url)

    let history = []
    if (previousId) {
      const thread = earlier(previousId, caller)
      if (thread.error) return fail(thread.error.status, thread.error.code, thread.error.message)
      history = thread.history
    }

    const msg = {
      id: `msg_${randomBytes(8).toString('hex')}`,
      caller,
      key,
      previous_id: previousId,
      message: text,
      context: body.context || {},
      status: 'working',
      reply: null,
      error: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    }
    messages.set(msg.id, msg)
    if (key) byKey.set(`${caller}\n${key}`, msg)

    const work = Promise.resolve()
      .then(() => answer({ message: msg.message, context: msg.context, history }))
      .then((value) => finish(msg, value))
      .catch(() => finish(msg, { error: { code: 'failed', message: 'The agent could not answer.' } }))
    await Promise.race([work, sleep(waitMs)])
    return respond(msg, url)
  }

  function get(caller, id, url) {
    const msg = messages.get(id)
    if (!msg || msg.caller !== caller) return fail(404, 'not_found', 'Message not found.')
    return respond(msg, url)
  }

  function earlier(id, caller) {
    const history = []
    const seen = new Set()
    while (id) {
      if (seen.has(id) || history.length >= MAX_THREAD) {
        return { error: { status: 409, code: 'conflict', message: 'This thread is too long. Start a new conversation.' } }
      }
      const msg = messages.get(id)
      if (!msg || msg.caller !== caller) return { error: { status: 404, code: 'not_found', message: 'previous_message_id was not found.' } }
      if (msg.status === 'working') return { error: { status: 409, code: 'conflict', message: 'The previous message is still working.' } }
      seen.add(id)
      history.push({ message: msg.message, context: msg.context, reply: msg.reply })
      id = msg.previous_id
    }
    history.reverse()
    return { history }
  }

  function respond(msg, url) {
    const headers = {}
    let status = 200
    if (msg.status === 'working') {
      status = 202
      headers.location = `${url.origin}/cap/v1/messages/${msg.id}`
      headers['retry-after'] = String(retryAfter)
    }
    return json(status, view(msg), headers)
  }

  return { handle }
}

function finish(msg, value) {
  const reply = typeof value === 'string' ? value : value?.reply
  if (value?.error) {
    msg.status = 'failed'
    msg.error = { code: String(value.error.code || 'failed'), message: String(value.error.message || 'The agent could not answer.') }
  } else if (typeof reply === 'string') {
    msg.status = 'done'
    msg.reply = reply
  } else {
    msg.status = 'failed'
    msg.error = { code: 'failed', message: 'The agent could not answer.' }
  }
  msg.finished_at = new Date().toISOString()
}

function view(msg) {
  const body = { id: msg.id, status: msg.status }
  if (msg.status === 'done') body.reply = msg.reply ?? ''
  if (msg.status === 'failed') body.error = msg.error
  body.created_at = msg.created_at
  body.finished_at = msg.finished_at
  return body
}

function card(url, name, chat) {
  const lines = ['Protocol: CAP/1.0', `Name: ${name}`, chat ? `Chat: ${chat}` : '', `CAP: ${url.origin}/cap/v1`].filter(Boolean)
  return new Response(`${lines.join('\n')}\n`, { headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } })
}

function json(status, body, extra) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', ...extra } })
}

function fail(status, code, message) {
  return json(status, { error: { code, message } })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
