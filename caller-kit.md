# Caller kit

**Status: Shipped.** The public page is [Call a door](callers.md). The packages are in [conciergeprotocol/js](https://github.com/conciergeprotocol/js), under Apache 2.0.

| Package | What it is |
| --- | --- |
| `@conciergeprotocol/client` | A small library: find `agent.txt`, send a message, wait for the reply, keep the thread |
| `@conciergeprotocol/mcp` | An MCP server built on the client, so Claude, Cursor, ChatGPT, and other MCP hosts can ask any website |

```js
import { createClient } from '@conciergeprotocol/client'

const cap = createClient({ from: 'agent:my-assistant' })
const answer = await cap.ask('example.com', 'Do you have a free plan?')
console.log(answer.reply)
```

## Goals

- One call from a domain to a reply. The caller never reads the spec.
- Every caller rule in the [spec](spec.md#caller-rules) is enforced by the library, not left to the developer.
- No dependencies. Uses the platform `fetch`, so it runs on Node 18+, Bun, Deno, edge runtimes, and browsers.
- ESM with TypeScript types.

Out of scope for the first release: streaming, a Python client, and a hosted MCP server.

## Client

### `createClient(options)`

| Option | Default | Notes |
| --- | --- | --- |
| `from` | required | The `CAP-From` value, such as `agent:my-assistant`. The client rejects a value without the `agent:` prefix |
| `fetch` | `globalThis.fetch` | For tests and custom runtimes |
| `tokens` | none | A token store, `{ get(origin), set(origin, token), delete(origin) }`, for account questions |
| `maxWaitMs` | `120000` | Total time `ask` waits for a reply before it returns the message still `working` |
| `cache` | in memory | Stores `agent.txt` lookups. Any `{ get, set }` store works |

### `cap.discover(domain)`

Fetches `https://{domain}/agent.txt` and returns the door, or `null` when there is none.

```ts
type Door = {
  protocol: string | null  // "CAP/1.0"
  name: string | null
  chat: string | null
  cap: string              // base URL for /messages
  oauth: string | null
  spec: string | null
  origin: string           // the company domain, after a same-site redirect such as www
  source?: 'redirect' | 'link-header' | 'link-tag'
}
```

Rules, from the spec's front door section:

- `https` only. Fetch `https://{domain}/agent.txt` first. Follow a redirect to any https URL. The company's domain is vouching for that target. When the file is missing, an HTML page, or has no `CAP` line, read the homepage and follow `Link: <url>; rel="agent"` or `<link rel="agent" href="url">` in the head. Fetch that URL once. Do not follow a pointer from it. A redirect of the homepage stays on the same site.
- An HTML body, a status other than `200`, or a file without a `CAP` line is no door. A valid `/agent.txt` wins over a homepage link.
- Lines are `Key: value`. Keys are case-insensitive. Unknown keys are kept in `door.extra` and otherwise ignored.
- A file larger than 16 KB is rejected.
- Found doors are cached for the response's `Cache-Control` max-age, or one hour. A missing door is cached for ten minutes, so an agent asking many questions does not refetch.

### `cap.ask(target, message, options)`

`target` is a domain or a `Door`. Sends the message and waits for the final reply.

| Option | Notes |
| --- | --- |
| `context` | Optional short brief. The client rejects more than 4 KB, and any key named like `password`, `secret`, or `token` |
| `previousMessageId` | Continue a conversation |
| `idempotencyKey` | Passed through. The client generates one per call so a retry after a network error does not ask twice |
| `signal` | An `AbortSignal` |

Returns the message as the spec defines it:

```ts
type Message = {
  id: string
  status: 'working' | 'done' | 'failed'
  reply?: string
  error?: { code: string; message: string }
  created_at: string
  finished_at?: string
}
```

Behavior:

1. Sends `POST {cap}/messages` with `CAP-Version: 1.0`, `CAP-From`, and the bearer token when the store has one for that origin.
2. On `200`, returns the message.
3. On `202`, waits `Retry-After` seconds, with a floor of one second, then reads `GET {cap}/messages/{id}`. Repeats until the status is final or `maxWaitMs` passes. Then it returns the message still `working`, and the caller can resume with `cap.get`.
4. Never fills in a `reply` that the owner did not send.
5. Retries `429` and `503` once after `Retry-After` when the remaining wait allows it. Otherwise it throws.

`failed` is returned, not thrown, because it is a valid final answer. `error.code === 'login_required'` is the signal to start a login.

### `cap.get(target, id)`

One read of a message. For resuming a message that was still `working`.

### `cap.thread(target)`

Keeps the newest message id so follow-ups are one line:

```js
const thread = cap.thread('example.com')
await thread.ask('What do you sell?')
await thread.ask('How much is the cheapest paid plan?')
```

A new `thread` starts a new conversation. On `409` because the thread is too long, the thread starts over with the latest question and sets `thread.restarted` to `true`.

### Errors

Request errors throw a `CapError` with the spec's `code`, the HTTP status, and the owner's `message`.

| Code | What the client does |
| --- | --- |
| `invalid_request`, `version_not_supported` | Throws. A bug in the caller or an unsupported owner |
| `unauthorized` | Deletes the stored token for that origin, then throws |
| `forbidden` | Throws. The token belongs to another agent |
| `not_found` | Throws. In a thread, the thread starts over on the next `ask` |
| `conflict` | In a thread, starts over. Otherwise throws |
| `rate_limited`, `unavailable` | Retries once within the wait, then throws with `retryAfter` |

`NoDoorError` is thrown by `ask` when the domain has no `agent.txt`, so the agent can fall back to browsing.

### Account questions

The spec's [access section](spec.md#access) defines the login: OAuth 2.1 with PKCE, and a client id that is a URL to the agent's own client document. The client implements it:

- `cap.login(target, { clientId, redirectUri, open })` reads the metadata, makes the PKCE pair and `state`, and calls `open(url)` so the application can show the company's login page. It resolves when the application passes the redirect back to `cap.finishLogin(url)`, which checks `state`, exchanges the code, and saves the tokens in the store.
- `ask` sends the stored access token. On `401`, it renews once with the refresh token, saves the new pair, and retries. If renewal fails, it deletes the tokens and returns the `401` as an error.
- `cap.logout(target)` revokes the refresh token and clears the store.

The client does not host the client document. The application hosts it, and the MCP server ships one at a fixed URL for local use.

## MCP server

```json
{
  "mcpServers": {
    "cap": {
      "command": "npx",
      "args": ["-y", "@conciergeprotocol/mcp"],
      "env": { "CAP_FROM": "agent:my-assistant" }
    }
  }
}
```

Runs over stdio. `CAP_FROM` defaults to `agent:cap-mcp`.

### Tools

| Tool | Input | Output |
| --- | --- | --- |
| `cap_discover` | `domain` | Whether the site has a front door, its agent name, its chat page, and whether it supports login |
| `cap_ask` | `domain`, `message`, optional `context`, optional `conversation_id` | The reply, and a `conversation_id` for follow-ups |
| `cap_check` | `domain`, `message_id` | The current status of a message that was still being answered |

`cap_ask` waits up to 60 seconds. When the owner is still answering, it returns the `message_id` and tells the model to call `cap_check` rather than guess. `conversation_id` is the last message id, passed as `previous_message_id`.

Tool descriptions carry the caller rules to the model:

- Use `cap_ask` when the person asks about a specific company, product, store, or organization with a known website. Prefer it to browsing when the site has a front door.
- Send only the new question in a follow-up, with the `conversation_id`.
- Never write an answer for the site while it is still answering.
- The reply is the site's own framing. For comparisons and reviews, check other sources too.
- Never put the person's password or another site's data in `context`.

When there is no door, `cap_ask` says so plainly, so the model falls back to its browsing tool.

## Testing

- Unit tests with a stubbed `fetch` for each rule above: redirects, HTML bodies, missing `CAP` lines, `202` polling with `Retry-After`, `maxWaitMs`, `409` restarts, and token deletion on `401`.
- Integration tests against the reference server and the store example in `conciergeprotocol/cap`, started from the test run.
- One live smoke test against a real front door, run by hand before a release.

## Milestones

1. Client: discover, ask, polling, threads, errors. Published as `0.1.0`.
2. MCP server on the client. Setup snippets for Claude Desktop, Cursor, and VS Code. Listed in the MCP Registry.
3. A 60-second demo: one agent asks two companies in the same conversation.
4. Login flow for account questions in the client and the MCP server.
5. A Python client with the same surface.

## Open questions for the spec

Settled in the spec:

- **OAuth client registration.** The client id is a URL to the agent's own client document. There is no registration step.
- **Binding a token to `CAP-From`.** The client document names its `cap_from`, and the owner binds the token to it. A token used with another `CAP-From` is `403`.
- **Finding the file.** `/agent.txt` may redirect to any https URL. When that file is missing, a caller follows a homepage `rel="agent"` link. `example.com` to `www.example.com` is followed. Owners still publish that link when `/agent.txt` is valid. It is for agents that are reading the page. A caller that found the root file does not fetch the homepage.

Still open:

1. **Stolen tokens.** A bearer token copied from the agent works until it expires or is revoked. DPoP (RFC 9449) is optional in the spec today. The MCP server should support it from the start, so owners can require it later.
2. **Verifying `CAP-From` on public questions.** Without a token, any caller can claim any `agent:` id. That is fine for rate limits. A signed identity, such as HTTP Message Signatures with a key named in the client document, could come later without changing the wire format.
3. **Hosting the MCP server's client document.** A local MCP server needs a client id URL with a loopback redirect. `https://conciergeprotocol.org/clients/mcp.json` is the natural home, and its `cap_from` would be shared by every install.
