import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

export function handlerAnswer(handler = { type: 'echo' }) {
  const login = { error: { code: 'login_required', message: 'Log in to your account to ask about it.' } }
  return async ({ message, context, history, account }) => {
    if (handler.account && !account) return login
    if (handler.type === 'static') return { reply: String(handler.reply ?? '') }
    if (handler.type === 'echo') return { reply: message }
    const url = handler.url || process.env[handler.url_env || 'HOOK_URL']
    if (!url) return { error: { code: 'failed', message: 'The agent could not answer.' } }
    const secret = process.env[handler.secret_env || 'HOOK_SECRET'] || ''
    const headers = { 'content-type': 'application/json' }
    if (secret) headers['x-cap-secret'] = secret
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, context, history, account }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.error) return { error: body.error || { code: 'failed', message: 'The agent could not answer.' } }
    return { reply: typeof body.reply === 'string' ? body.reply : '' }
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
      await store.upsertGrant({ token: grant.token, account: grant.account, clientId: grant.client })
    }
  }
  const cap = createCapServer({
    store,
    agent: config.agent,
    answer: options.answer || handlerAnswer(config.handler),
    waitMs: options.waitMs ?? (config.wait_seconds ?? 20) * 1000,
    retryAfter: config.retry_after ?? 5,
    retentionHours: config.retention_hours ?? 24,
    dailyLimit: config.daily_limit ?? 0,
    maxTurns: config.max_turns ?? 20,
    demoOauth: Boolean(config.demo_oauth),
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
