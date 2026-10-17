# Specification

**Status: Draft. Version 1.0.** Breaking changes are listed in the [changelog](CHANGELOG.md). Feedback is welcome in [GitHub issues](https://github.com/conciergeprotocol/cap/issues).

CAP lets an agent ask a company's agent a question and get the answer back. The company's tools, prompts, and keys stay with the company. There is one object, the **message**, and two endpoints. How to call it: [Usage](usage.md).

## Front door

A company publishes one text file at `https://{domain}/agent.txt`, next to `robots.txt`.

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
Spec: https://harborgoods.example/cap.txt
```

`Protocol` is the first line. It names this format, so a caller can tell this file apart from an unrelated `agent.txt`. A caller that finds no `Protocol` line uses the file only when it has a `CAP` line. `Name` is the public agent. `Chat` is the page a person opens. `CAP` is the base URL for the two endpoints. `OAuth` is the authorization server for questions about a customer's account. Leave it off when the agent answers only public questions. `Spec` is a short caller card. Leave it off when you have no public URL for one. The file lists no tools, MCP servers, prompts, or credentials.

One domain has one agent. A person uses the chat page. An agent fetches the file. Both reach the same agent and get the same answers.

The chat page and the CAP URL may be hosted for the company. The company's own domain still serves `agent.txt`.

A caller fetches `/agent.txt`. It treats a redirect off the company's domain, an HTML body, or a file without a `CAP` line as no front door. A redirect within the same site, such as `example.com` to `www.example.com`, is followed.

## Message

| Field         | Notes                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `id`          | Assigned by the owner                                                    |
| `status`      | `working`, `done`, or `failed`                                           |
| `reply`       | Text. Set only when `status` is `done`. Links go in the text             |
| `error`       | `{ code, message }`. Set only when `status` is `failed`                  |
| `created_at`  |                                                                          |
| `finished_at` | Set when `status` is `done` or `failed`                                  |

| Status    | Meaning                                    | Final |
| --------- | ------------------------------------------ | ----- |
| `working` | The owner has the message and is answering | No    |
| `done`    | `reply` is set                             | Yes   |
| `failed`  | `error` is set                             | Yes   |

`error.message` is written for the person. It never names a tool, a vendor, or an internal id. `login_required` is the one defined failure code: the answer needs the person's account and no grant was sent. Owners may use other codes. A caller treats any failure as final for that message.

## Operations

```
POST /cap/v1/messages
GET  /cap/v1/messages/{id}
```

Every request carries `CAP-Version: 1.0` and `CAP-From: agent:{id}`, naming the calling agent. A request for a logged-in person also carries `Authorization: Bearer` with an OAuth access token.

### Send a message

```json
{ "message": "Black running shoes in size 12", "context": { "style": "minimal, all black" } }
```

`message` is required text. `context` is an optional object: a short brief from the caller, such as sizes, dates, or preferences. It is not a vendor API payload and not the person's whole profile.

- `200` with the message when the owner finished within its own wait. The status is `done` or `failed`.
- `202` with the message when it did not. The status is `working`. The response sets `Location: /cap/v1/messages/{id}` and `Retry-After` in seconds.

The owner picks the wait, and it SHOULD be under 30 seconds. The caller sends nothing extra to get it.

`Idempotency-Key` is optional. The same key from the same `CAP-From`, with the same grant or none, returns the original message and does not answer again.

### Follow up

```json
{ "message": "Something cheaper?", "previous_message_id": "msg_c1fac527668c6694" }
```

`previous_message_id` is optional. It continues the conversation that message belongs to, so the owner answers with every earlier turn in mind. The caller sends only the new message and never resends earlier turns or replies. The owner rebuilds the thread from its own records, so a caller cannot put words in the owner's mouth.

The previous message must be visible to the caller, under the same rules as a read. A thread may move from no grant to a grant, such as after the person logs in. It never moves from one account to another, and it never drops a grant it had. A thread lasts as long as its messages are kept.

The previous message must be final. If it is still `working`, the owner returns `409`. The owner may cap how many turns a thread keeps and returns `409` past that cap. The caller then starts a new thread without `previous_message_id`.

### Read a message

`GET /cap/v1/messages/{id}` returns `200` with the message. While it is `working`, the response sets `Retry-After`.

A message is visible only to the `CAP-From` that sent it, with the same grant or none. Anyone else gets `404`. The owner keeps a finished message for at least 24 hours. After that, a read is `404` and the caller asks again.

## Access

A public question needs no token. A question about an account needs the person to log in.

Login is OAuth 2.1: the authorization code flow with PKCE. The visiting agent is a public client. It has no secret and does not register with the company first. The person types their password only on the company's page. The visiting agent receives a token bound to that person's account and to its own `CAP-From`, and sends it on each request. It never holds the person's password or the company's keys.

### Discovery

The `OAuth` line is the authorization server's issuer. The caller reads the server's metadata (RFC 8414), with `/.well-known/oauth-authorization-server` inserted between the host and the issuer's path:

```
OAuth: https://harborgoods.example/oauth
GET https://harborgoods.example/.well-known/oauth-authorization-server/oauth
```

The metadata includes `issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `code_challenge_methods_supported` with `S256`, and `client_id_metadata_document_supported: true`.

### The visiting agent's client id

The visiting agent's `client_id` is an https URL it controls. That URL returns the agent's client metadata as JSON, an OAuth Client ID Metadata Document:

```json
{
  "client_id": "https://assistant.example/cap-client.json",
  "client_name": "Example Assistant",
  "redirect_uris": ["https://assistant.example/cap/callback"],
  "cap_from": "agent:example-assistant"
}
```

`client_id` is the document's own URL. `cap_from` is the `CAP-From` the agent sends. The owner fetches the document when the person logs in, shows `client_name` and the host of `client_id` on its consent page, and binds the token to `cap_from`. An agent that runs on the person's own device lists a loopback redirect, such as `http://127.0.0.1/callback`, and the owner accepts it on any port (RFC 8252).

### Log in

1. The caller makes a random `code_verifier` and opens the `authorization_endpoint` for the person with `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, and `code_challenge_method=S256`.
2. The person logs in on the company's page and consents. The owner redirects to `redirect_uri` with `code`, `state`, and `iss`. The `redirect_uri` must be one the client document lists. If it is not, the owner shows an error and does not redirect.
3. The caller posts to the `token_endpoint` as a form: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `code_verifier`. The response is `access_token`, `token_type: Bearer`, `expires_in`, and `refresh_token`.

A code works once and expires within 10 minutes.

### Use, renew, and revoke

An account request carries `Authorization: Bearer` and the `CAP-From` the token was issued to. Another `CAP-From` gets `403`. An expired or revoked token gets `401`.

The caller renews with `grant_type=refresh_token`, `refresh_token`, and `client_id`. The owner returns a new refresh token, and the old one stops working. The caller revokes with the `revocation_endpoint` (RFC 7009), sending `token` and `client_id`. Revoking stops that agent, and nothing else has to rotate.

The token endpoint returns OAuth's own errors, such as `invalid_grant`, not CAP's. An owner may define scopes. An owner may require sender-constrained tokens with DPoP (RFC 9449), so a copied token is useless without the agent's key. Its metadata then lists `dpop_signing_alg_values_supported`, and the caller sends a DPoP proof with each token request and CAP request.

Two identities travel on an account request:

- `Authorization: Bearer` is the person and the account.
- `CAP-From: agent:{id}` is the visiting agent.

The owner answers however it chooses: its own MCP servers, a direct API, or a person. The caller does not learn which. Revoking the token stops that agent. Nothing else has to rotate.

## Owner rules

An owner conforms if it:

1. Returns only the fields above. Never tools, prompts, transcripts, internal ids, or credentials, in a field or in the reply.
2. Answers each message from its text, its `context`, the grant, and its own record of the thread. Never from another caller's messages.
3. Answers an account question only with a grant for that account. A name or an account number in `context` is not a grant.
4. Returns `202` with `Location` and `Retry-After` when it cannot finish within its wait.
5. Keeps its limits private. When it will not take more from a caller, it returns `429` with `Retry-After`.
6. Keeps finished messages for at least 24 hours.
7. For account questions, publishes OAuth metadata, accepts a client id metadata document in place of registration, requires PKCE with `S256`, and binds each token to the document's `cap_from`.

## Caller rules

A caller conforms if it:

1. Never calls the owner's tools, MCP servers, or APIs to do or check the work.
2. Uses `reply` only when `status` is `done`.
3. Never invents a reply while a message is `working`. It tells the person the owner is still answering.
4. Waits at least `Retry-After` between reads.
5. Treats `failed` as final for that message. It sends a new one only when something changed, such as the person logging in.
6. Sends a short brief in `context`. Never the person's password or another company's data.
7. Sets `previous_message_id` to the last message when the person is continuing the same conversation, and leaves it off when they start a new one.
8. Logs in only through the owner's authorization page, with PKCE and a client id document it controls. Never asks the person for their password.

## Errors

```json
{ "error": { "code": "rate_limited", "message": "Try again in a minute." } }
```

| Code                    | HTTP | When                                                                        |
| ----------------------- | ---- | --------------------------------------------------------------------------- |
| `invalid_request`       | 400  | The body is not JSON, `message` is missing, or a header is malformed        |
| `version_not_supported` | 400  | `CAP-Version` is not implemented                                            |
| `unauthorized`          | 401  | The bearer token is invalid, expired, or revoked                            |
| `forbidden`             | 403  | The token was issued to a different agent than `CAP-From`                   |
| `not_found`             | 404  | The message, or `previous_message_id`, does not exist, has expired, or is not visible to this caller |
| `conflict`              | 409  | `previous_message_id` is still `working`, or the thread is too long          |
| `rate_limited`          | 429  | The owner will not take more from this caller now. `Retry-After` is set     |
| `unavailable`           | 503  | The agent is not answering                                                  |

These are request errors. A message that was accepted and could not be answered is `failed`, with its own `error`.

## Relationship to other protocols

| Layer             | Protocol | Role                                                                   |
| ----------------- | -------- | ---------------------------------------------------------------------- |
| Tools and data    | MCP      | An agent reaching its own tools, inside one boundary                   |
| Agent integration | A2A      | Agents that integrate with each other: agent cards, tasks, streaming   |
| Personal agents   | Personal Agent Protocol | A personal agent working with a company: sessions, sign-in, APIs, web, and the company agent |
| Front door        | CAP      | Any agent asking a company's agent, public or logged in, from a text file and two endpoints |

CAP is the smallest of these on purpose: one file, one object, two endpoints, and common HTTP. It covers the public question and the account question. A public question needs nothing. An account question adds one OAuth token the person granted. There is no session to open and no browser to drive. An owner can serve CAP next to any of the others from the same agent. Each keeps its own discovery file (`/.well-known/agent-card.json` for A2A, `/.well-known/poppy.json` for Personal Agent Protocol), and `agent.txt` does not list them.

An owner can serve both A2A and CAP from the same agent. A CAP message maps onto an A2A task:

| CAP                         | A2A 1.0                                       |
| --------------------------- | --------------------------------------------- |
| Send a message              | `SendMessage` with `returnImmediately: true`  |
| Read a message              | `GetTask`                                     |
| `working`, `done`, `failed` | `TASK_STATE_WORKING`, `_COMPLETED`, `_FAILED` |
| `reply`                     | A text part on the task's result              |
| `previous_message_id`       | Sending with the earlier task's `contextId`   |

Version 1 ships as the `/cap/v1` HTTP surface above.
