import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOAuth } from './oauth.mjs'
import { createCapServer } from './server.mjs'
import { createStore } from './store.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HANDLERS = ['static', 'echo', 'http']

export function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'))
  if (!config.agent?.name) throw new Error('cap.json needs agent.name.')
  config.agent.status = config.agent.status || 'active'
  const type = config.handler?.type || 'echo'
  if (!HANDLERS.includes(type)) throw new Error(`Unknown handler type: ${type}.`)
  return config
}

async function postHook(handler, payload) {
  const url = handler.url || process.env[handler.url_env || 'HOOK_URL']
  if (!url) return { error: { code: 'failed', message: 'The agent could not answer.' } }
  const secret = process.env[handler.secret_env || 'HOOK_SECRET'] || ''
  const headers = { 'content-type': 'application/json' }
  if (secret) headers['x-cap-secret'] = secret
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.error) return { error: body.error || { code: 'failed', message: 'The agent could not answer.' } }
  return body
}

export function handlerAnswer(handler = { type: 'echo' }) {
  const login = { error: { code: 'login_required', message: 'Log in to your account to ask about it.' } }
  return async ({ message, context, history, account, scope }) => {
    if (handler.account && !account) return login
    if (handler.type === 'static') return { reply: String(handler.reply ?? '') }
    if (handler.type === 'echo') return { reply: message }
    const body = await postHook(handler, { message, context, history, account, scope })
    if (body.error) return body
    if (body.confirm) return { confirm: body.confirm, reply: typeof body.reply === 'string' ? body.reply : '' }
    return { reply: typeof body.reply === 'string' ? body.reply : '' }
  }
}

/** With `http`, an approved action goes back to the same hook as `{ confirmed }`. */
export function handlerAct(handler = { type: 'echo' }) {
  if (handler.type !== 'http') return null
  return async ({ account, authorization_details, caller }) => {
    const body = await postHook(handler, { confirmed: { account, authorization_details, caller } })
    if (body.error) return { error: { message: body.error.message } }
    return { message: typeof body.message === 'string' ? body.message : '' }
  }
}

const sameText = (a, b) => {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Demo logins from cap.json. A real owner passes `boot({ login })` and checks its own user store. */
export function accountsLogin(accounts = []) {
  return async ({ username, password }) => {
    const match = accounts.find((entry) => entry.account === username)
    const expected = match ? (match.password_env ? process.env[match.password_env] : match.password) : ''
    return match && expected && sameText(password, expected) ? match.account : null
  }
}

export async function boot(options = {}) {
  const configPath = options.configPath || process.env.CAP_CONFIG || join(here, 'cap.json')
  const config = options.config || loadConfig(configPath)
  const store = await createStore({
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    sqlitePath: options.sqlitePath ?? process.env.SQLITE_PATH ?? join(here, 'data', 'cap.sqlite'),
  })
  for (const grant of config.grants || []) {
    if (grant.token && grant.account && grant.client) {
      await store.upsertGrant({ token: grant.token, account: grant.account, clientId: grant.client, scope: grant.scope === 'write' ? 'write' : 'read' })
    }
  }
  const oauthConfig = config.oauth
  const oauth = oauthConfig || options.login
    ? createOAuth({
      store,
      agentName: config.agent.name,
      login: options.login || accountsLogin(oauthConfig?.accounts),
      write: Boolean(oauthConfig?.write),
      act: options.act || handlerAct(config.handler),
      accessTokenSeconds: oauthConfig?.access_token_seconds ?? 3600,
      writeAccessTokenSeconds: oauthConfig?.write_access_token_seconds ?? 900,
      allowHttpClients: Boolean(oauthConfig?.allow_http_clients),
      hint: oauthConfig?.hint || '',
      fetchImpl: options.fetch,
      deviceInterval: oauthConfig?.device_interval ?? 5,
    })
    : null
  const cap = createCapServer({
    store,
    agent: config.agent,
    answer: options.answer || handlerAnswer(config.handler),
    waitMs: options.waitMs ?? (config.wait_seconds ?? 20) * 1000,
    retryAfter: config.retry_after ?? 5,
    retentionHours: config.retention_hours ?? 24,
    dailyLimit: config.daily_limit ?? 0,
    maxTurns: config.max_turns ?? 20,
    oauth,
    publicUrl: options.publicUrl ?? process.env.PUBLIC_URL ?? '',
    extraRoutes: options.extraRoutes,
  })
  return { store, config, ...cap }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const { server } = await boot()
  const port = Number(process.env.PORT || 8088)
  const host = process.env.HOST || '0.0.0.0'
  server.listen(port, host, () => {
    console.log(`CAP reference server on http://${host}:${port}`)
  })
}
