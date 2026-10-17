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
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  oauth_client TEXT NOT NULL,
  cap_from TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_devices (
  device_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  oauth_client TEXT NOT NULL,
  cap_from TEXT NOT NULL,
  client_name TEXT NOT NULL,
  verified_host TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  last_poll_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);
`

// Columns added after the first release. Older databases get them on migrate.
const GRANT_COLUMNS = [
  "ALTER TABLE grants ADD COLUMN kind TEXT NOT NULL DEFAULT 'access'",
  "ALTER TABLE grants ADD COLUMN oauth_client TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE grants ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE grants ADD COLUMN grant_id TEXT NOT NULL DEFAULT ''",
]

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
      for (const sql of ['ALTER TABLE messages ADD COLUMN previous_id TEXT', ...GRANT_COLUMNS]) {
        try {
          await run(sql)
        } catch {
          // Already there.
        }
      }
    },
    /**
     * `clientId` is the CAP-From id the token is bound to. `oauthClient` is the
     * client id URL that logged in, empty for tokens set in cap.json. Tokens from
     * one login share a `grantId`, so revoking one revokes the rest.
     */
    async upsertGrant({ token, account, clientId, kind = 'access', oauthClient = '', expiresAt = '', grantId = '' }) {
      await run(
        `INSERT INTO grants (token_hash, account, client_id, kind, oauth_client, expires_at, grant_id) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET account = excluded.account, client_id = excluded.client_id,
           kind = excluded.kind, oauth_client = excluded.oauth_client, expires_at = excluded.expires_at,
           grant_id = excluded.grant_id`,
        [tokenHash(token), account, clientId, kind, oauthClient, expiresAt, grantId],
      )
    },
    async revokeGrant(token) {
      await run('DELETE FROM grants WHERE token_hash = ?', [tokenHash(token)])
    },
    async revokeGrantId(grantId) {
      if (grantId) await run('DELETE FROM grants WHERE grant_id = ?', [grantId])
    },
    async grantByToken(token) {
      if (!token) return null
      const row = await get(
        'SELECT token_hash, account, client_id, kind, oauth_client, expires_at, grant_id FROM grants WHERE token_hash = ?',
        [tokenHash(token)],
      )
      if (!row) return null
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null
      return row
    },
    async insertCode({ code, account, oauthClient, capFrom, redirectUri, codeChallenge, expiresAt }) {
      await run(
        `INSERT INTO oauth_codes (code_hash, account, oauth_client, cap_from, redirect_uri, code_challenge, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tokenHash(code), account, oauthClient, capFrom, redirectUri, codeChallenge, expiresAt],
      )
    },
    // A code works once: it is deleted as it is read.
    async takeCode(code) {
      if (!code) return null
      const row = await get('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *', [tokenHash(code)])
      if (!row || Date.parse(row.expires_at) <= Date.now()) return null
      return row
    },
    async insertDevice({ deviceCode, userCode, oauthClient, capFrom, clientName, verifiedHost, expiresAt }) {
      await run(
        `INSERT INTO oauth_devices (device_hash, user_code, oauth_client, cap_from, client_name, verified_host, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [tokenHash(deviceCode), userCode, oauthClient, capFrom, clientName, verifiedHost, expiresAt],
      )
    },
    async deviceByUserCode(userCode) {
      const row = await get('SELECT * FROM oauth_devices WHERE user_code = ?', [userCode])
      if (!row || Date.parse(row.expires_at) <= Date.now()) return null
      return row
    },
    async deviceByCode(deviceCode) {
      if (!deviceCode) return null
      return (await get('SELECT * FROM oauth_devices WHERE device_hash = ?', [tokenHash(deviceCode)])) || null
    },
    // Only a pending login can be decided, and only once.
    async decideDevice(userCode, { status, account = '', expiresAt = null }) {
      const row = await get(
        `UPDATE oauth_devices SET status = ?, account = ?, expires_at = COALESCE(?, expires_at)
         WHERE user_code = ? AND status = 'pending' RETURNING *`,
        [status, account, expiresAt, userCode],
      )
      return row || null
    },
    async touchDevice(deviceCode, at) {
      await run('UPDATE oauth_devices SET last_poll_at = ? WHERE device_hash = ?', [at, tokenHash(deviceCode)])
    },
    // An approved login yields a token once: it is deleted as it is read.
    async takeApprovedDevice(deviceCode) {
      return (await get(
        `DELETE FROM oauth_devices WHERE device_hash = ? AND status = 'approved' RETURNING *`,
        [tokenHash(deviceCode)],
      )) || null
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
