# Reference server

One process that speaks `/cap/v1`. SQLite by default, so a local run needs no database server and no account on any vendor. Set `DATABASE_URL` to a Postgres connection string when you deploy somewhere that already has Postgres.

The spec does not require a database. This server keeps five tables (`messages`, `grants`, `oauth_codes`, `oauth_devices`, `confirmations`) because a slow answer, a login, and an action waiting for approval have to survive a restart. Another runtime can store them somewhere else. The HTTP contract does not change.

## Run locally

```bash
cd reference
node start.mjs
```

Then:

```bash
curl http://127.0.0.1:8088/agent.txt
curl -X POST http://127.0.0.1:8088/cap/v1/messages \
  -H 'CAP-Version: 1.0' -H 'CAP-From: agent:visitor' \
  -H 'Content-Type: application/json' \
  -d '{"message":"When are you open?"}'
```

The default `cap.json` answers with a fixed reply, so the response is `200` and already `done`.

```bash
node check.mjs
```

## Configure

`cap.json` next to `start.mjs`, or `CAP_CONFIG` pointing at another file.

```json
{
  "agent": { "name": "Harbor Goods", "status": "active", "chat": "https://harborgoods.example/chat" },
  "handler": { "type": "static", "reply": "We are open Saturday 11am to 9pm." },
  "wait_seconds": 20,
  "retry_after": 5,
  "retention_hours": 24,
  "daily_limit": 500
}
```

Handlers:

- `static` replies with fixed text.
- `echo` replies with the message it was sent.
- `http` `POST`s `{ message, context, history, account, scope }` to a URL you run. That URL returns `{ "reply": "..." }`, or `{ "error": { "code", "message" } }` to fail the message. `account` and `scope` are null unless the caller sent a valid token. `scope` is then `read` or `write`. `history` is the earlier turns of the thread, oldest first, as `{ message, context, reply }`. It is empty for a new conversation, and `reply` is null for a turn that failed.

The hook URL can be `handler.url` or the environment variable named by `handler.url_env` (default `HOOK_URL`). If you set `handler.secret_env` (default `HOOK_SECRET`), that value is sent as `X-Cap-Secret` and is never written into a message.

`"account": true` on the handler fails every message without a token as `login_required`. With `http`, the hook can make that choice per question instead.

From code, `boot({ answer })` takes an async function `({ message, context, history, account, scope, caller }) => ({ reply })` in place of a handler. The [store example](../examples/store) uses it.

The server waits up to `wait_seconds` for an answer. If it is ready, the response is `200`. If not, it is `202` with `Location` and `Retry-After: retry_after`, and the answer finishes in the background. Finished messages are readable for `retention_hours`. `daily_limit` caps messages per `CAP-From` per UTC day. Over it, the caller gets `429` and never sees the number. `0` turns it off.

The server rebuilds `history` from the `previous_message_id` chain in its own table. `max_turns` (default 20) caps how many earlier turns a thread keeps. Past it, a follow-up is `409 conflict`.

A message is readable only by the `CAP-From` that sent it, with the same token or none. A paused, draft, or archived agent returns `503 unavailable`.

## Logins

An `oauth` block turns on the built-in authorization server and adds the `OAuth` line to `agent.txt`:

```json
"oauth": {
  "accounts": [{ "account": "maya", "password_env": "MAYA_PASSWORD" }],
  "access_token_seconds": 3600
}
```

It serves the OAuth metadata at `/.well-known/oauth-authorization-server/oauth`, `/oauth/token`, and `/oauth/revoke`, and both logins:

- The code login: `POST /oauth/device` starts it, and the person enters the code on the page at `/oauth/device`. The `client_id` is the caller's `agent:` id, shown as not verified, or a client document URL. Codes last ten minutes and are approved once. `device_interval` (default 5) is the polling interval in seconds.
- The redirect login: a login and consent page at `/oauth/authorize`. It accepts any visiting agent's client id document and requires PKCE with `S256`.

Each token is bound to the `CAP-From` that logged in. Refresh tokens rotate and last 30 days. Revoking either token of a login ends both.

### Changes and confirmations

`"write": true` offers the `write` scope. A caller asks with `scope=write`, and the person can allow changes, allow read only, or deny. The token response's `scope` is `read` or `read write`, and a renewed token keeps it. Write access tokens last `write_access_token_seconds` (default 900). The handler receives `scope`, and refuses a change on `read`, for example with `write_required`.

To hold an action for the person's OK, `answer` returns `{ confirm: { summary, authorization_details }, reply }` in place of a reply. The server stores the request, and the message is `done` with a `confirmation` and a link to `/oauth/confirm?id=...`. There the person logs in and approves or denies. On approval the server calls `boot({ act })`, an async function `({ account, authorization_details, caller }) => ({ message })` or `({ error: { message } })`, once. The caller reads `GET /cap/v1/confirmations/{id}`. A request expires after ten minutes. A `read` token cannot hold one, and gets `write_required`.

With the `http` handler, the hook returns `confirm` next to `reply`, and after approval it receives `{ "confirmed": { "account", "authorization_details", "caller" } }` and returns `{ "message": "..." }`.

[Add login to your agent](../owners.md) walks through both, with code.

`accounts` is for demos. A real owner checks its own user store by passing `boot({ login })`, an async function `({ username, password }) => accountId | null`. The account id is what the handler receives as `account`.

`"allow_http_clients": true` accepts client documents on `http` and on `localhost`, for local testing. Leave it off on a public deploy, where client ids must be https URLs on public hosts. The server fetches each client document when a person starts a login, with a five-second timeout, no redirects, and a 16 KB limit. Run it behind egress rules if it can reach private services.

Login requests waiting on the consent page are held in memory for ten minutes. Run one process, or pin a login to one process, if you deploy more than one.

Tokens are stored as a hash. `CAP-From` must be the agent the token was issued to. An invalid, expired, or revoked token is `401`. A token used by a different agent is `403`.

Fixed tokens, for tests and scripts, can go in `grants`:

```json
"grants": [{ "token": "grant_demo", "account": "maya", "client": "shopper" }]
```

Add `"scope": "write"` to a fixed token to let it make changes.

Put real tokens and passwords in the environment or in a file that is not committed. `cap.json` in this folder ships with no grants and no accounts.

## Deploy

Any host that runs a container or a Node process can take this folder.

```bash
docker build -t cap-reference reference
docker run -p 8088:8088 -v cap-data:/app/data cap-reference
```

The SQLite file lives at `reference/data/cap.sqlite` unless `SQLITE_PATH` is set. Mount that path so a restart keeps messages.

Postgres, on a host that gives you a connection string:

```bash
cd reference
bun install
DATABASE_URL=postgres://user:pass@host:5432/cap node start.mjs
```

The image installs dependencies with npm because the Node base image includes it. Local SQLite does not need that install.

Set `PORT` if the host assigns one. `GET /health` is there for a probe. `GET /agent.txt` uses the request host, or `PUBLIC_URL` when you want the CAP line to be a public https origin.

`Procfile` is `web: node start.mjs` for hosts that look for one.

Point the CAP line in the company's `agent.txt` at this server:

```
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://cap.harborgoods.example/cap/v1
```

The company domain still serves `agent.txt`. This process only has to be reachable at the CAP URL.
