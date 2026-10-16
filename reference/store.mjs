import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  previous_id TEXT,
  message TEXT NOT NULL,
  context_json TEXT NOT NULL,
  status TEXT NOT NULL,
  reply TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_by_caller ON messages (caller_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency
  ON messages (caller_id, account, client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS grants (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  client_id TEXT NOT NULL
);
`

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function newMessageId() {
  return `msg_${randomBytes(8).toString('hex')}`
}

function isUniqueViolation(err) {
  const text = `${err.code || ''} ${err.message || ''}`
  return text.includes('UNIQUE') || err.code === '23505' || err.errcode === 2067
}

function mapMessage(row) {
  if (!row) return null
  return {
    id: row.id,
    caller_id: row.caller_id,
    account: row.account || '',
    client_id: row.client_id || '',
    idempotency_key: row.idempotency_key,
    previous_id: row.previous_id || null,
    message: row.message,
    context: JSON.parse(row.context_json || '{}'),
    status: row.status,
    reply: row.reply ?? null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    created_at: row.created_at,
    finished_at: row.finished_at ?? null,
  }
}

function sqliteStore(db) {
  const run = (sql, params = []) => db.prepare(sql).run(...params)
  const get = (sql, params = []) => db.prepare(sql).get(...params)
  return driver({ run, get, close: () => db.close() })
}

async function postgresStore(connectionString) {
  let pg
  try {
    pg = await import('pg')
  } catch {
    throw new Error('Postgres needs the pg package. From reference/, run: bun install')
  }
  const pool = new pg.default.Pool({ connectionString })
  const run = async (sql, params = []) => { await pool.query(toPg(sql), params) }
  const get = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows[0]
  return driver({ run, get, close: () => pool.end() })
}

function toPg(sql) {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

function driver({ run, get, close }) {
  return {
    close,
    async migrate() {
      for (const statement of SCHEMA.split(';')) {
        const sql = statement.trim()
        if (sql) await run(sql)
      }
      // Databases created before follow-ups existed lack this column.
      try {
        await run('ALTER TABLE messages ADD COLUMN previous_id TEXT')
      } catch {
        // Already there.
      }
    },
    async upsertGrant({ token, account, clientId }) {
      await run(
        `INSERT INTO grants (token_hash, account, client_id) VALUES (?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET account = excluded.account, client_id = excluded.client_id`,
        [tokenHash(token), account, clientId],
      )
    },
    async revokeGrant(token) {
      await run('DELETE FROM grants WHERE token_hash = ?', [tokenHash(token)])
    },
    async grantByToken(token) {
      if (!token) return null
      return await get('SELECT token_hash, account, client_id FROM grants WHERE token_hash = ?', [tokenHash(token)]) || null
    },
    async countSince(callerId, sinceIso) {
      const row = await get(
        'SELECT COUNT(*) AS n FROM messages WHERE caller_id = ? AND created_at >= ?',
        [callerId, sinceIso],
      )
      return Number(row?.n || 0)
    },
    async byIdempotency({ callerId, account, clientId, key }) {
      return mapMessage(await get(
        `SELECT * FROM messages
         WHERE caller_id = ? AND account = ? AND client_id = ? AND idempotency_key = ?`,
        [callerId, account, clientId, key],
      ))
    },
    async insert(msg) {
      try {
        await run(
          `INSERT INTO messages (
            id, caller_id, account, client_id, idempotency_key, previous_id,
            message, context_json, status, reply, error_json, created_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msg.id,
            msg.caller_id,
            msg.account || '',
            msg.client_id || '',
            msg.idempotency_key || null,
            msg.previous_id || null,
            msg.message,
            JSON.stringify(msg.context || {}),
            msg.status,
            msg.reply ?? null,
            msg.error ? JSON.stringify(msg.error) : null,
            msg.created_at,
            msg.finished_at || null,
          ],
        )
        return { message: msg, created: true }
      } catch (err) {
        if (!isUniqueViolation(err) || !msg.idempotency_key) throw err
        const existing = await this.byIdempotency({
          callerId: msg.caller_id,
          account: msg.account || '',
          clientId: msg.client_id || '',
          key: msg.idempotency_key,
        })
        return { message: existing, created: false }
      }
    },
    async finish(id, { status, reply, error, finishedAt }) {
      await run(
        'UPDATE messages SET status = ?, reply = ?, error_json = ?, finished_at = ? WHERE id = ?',
        [status, reply ?? null, error ? JSON.stringify(error) : null, finishedAt, id],
      )
    },
    async byId(id) {
      return mapMessage(await get('SELECT * FROM messages WHERE id = ?', [id]))
    },
  }
}

export async function createStore({ databaseUrl, sqlitePath }) {
  if (databaseUrl && /^postgres(ql)?:\/\//.test(databaseUrl)) {
    const store = await postgresStore(databaseUrl)
    await store.migrate()
    return store
  }
  const { DatabaseSync } = await import('node:sqlite')
  const path = sqlitePath || ':memory:'
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  const store = sqliteStore(db)
  await store.migrate()
  return store
}

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString()
}
