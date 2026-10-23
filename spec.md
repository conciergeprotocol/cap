# Specification

**Status: Draft. Version 1.0.** Breaking changes are listed in the [changelog](CHANGELOG.md). Feedback is welcome in [GitHub issues](https://github.com/conciergeprotocol/cap/issues).

CAP lets an agent ask a company's agent a question and get the answer back. The company's tools, prompts, and keys stay with the company. There is one object, the **message**, and two endpoints. How to call it: [Usage](usage.md).

## Front door

A company publishes one text file at `https://{domain}/agent.txt`, next to `robots.txt`. It lives at the root rather than under `/.well-known/` so that any site owner can publish it the same way they publish `robots.txt`, on hosts that do not serve dot-directories. The `Protocol` line tells it apart from other files with the same name.

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
Spec: https://conciergeprotocol.org/cap.txt
```

`Protocol` is the first line. It names this format, so a caller can tell this file apart from an unrelated `agent.txt`. A caller that finds no `Protocol` line uses the file only when it has a `CAP` line. `Name` is the public agent. `Chat` is the page a person opens. `CAP` is the base URL for the two endpoints. `OAuth` is the authorization server for questions about a customer's account. Leave it off when the agent answers only public questions. `Spec` is a short caller card. Use the hosted card at `https://conciergeprotocol.org/cap.txt`. It covers every CAP 1.x door and is updated in one place, so do not copy it to your own domain. A caller may skip fetching it when it already knows CAP. Notes for your door belong in your agent's replies, not in a separate card. The file lists no tools, MCP servers, prompts, or credentials.

One domain has one agent. A person uses the chat page. An agent fetches the file. Both reach the same agent and get the same answers.

The chat page and the CAP URL may be hosted for the company. The company's domain is what a caller trusts. The file itself may be hosted elsewhere when that domain points at it.

A caller looks for the file in this order and stops at the first valid one:

1. `GET https://{domain}/agent.txt`. A redirect is followed, including one to another https host. The company's domain is vouching for the target by redirecting to it. A redirect within the same site, such as `example.com` to `www.example.com`, is followed too.
2. When that request is not a front door (a missing file, an HTML page, or a file with no `CAP` line), the caller reads the homepage, `GET https://{domain}/`. A redirect of the homepage is followed only within the same site. The caller reads at most the first 256 KB, and only through `</head>`. When `</head>` is missing, it stops at `<body>`. It takes the first of these:
   - a `Link` header: `Link: <https://cdn.example/agent.txt>; rel="agent"`
   - a tag in the head: `<link rel="agent" href="https://cdn.example/agent.txt">`

The caller fetches that URL once and does not follow a pointer from the target. It treats an HTML body, a redirect to a URL that is not https, or a file without a `CAP` line as no front door. When `/agent.txt` is a valid front door, the homepage is ignored. The door belongs to the domain the caller asked, not to the host that served the file.

An owner also points at the door from the pages an agent already reads. CAP callers still try `/agent.txt` first. The link is how every other agent finds the door, and it remains the fallback when the root file is missing.

- On the homepage, including when `/agent.txt` is a valid door: `<link rel="agent" href="https://{domain}/agent.txt">` in `<head>`, or `Link: <https://{domain}/agent.txt>; rel="agent"` on that response.
- In `llms.txt`, one line that points at `/agent.txt` and says to ask there.
- Optionally, one entry in `/.well-known/ai-catalog.json` whose `url` is the `agent.txt` file and whose `type` is `text/plain`. A site that also publishes `/.well-known/ard.json` lists the same entry there. The entry is a link to the file. CAP has no catalog type of its own.

## Message

| Field         | Notes                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| `id`          | Assigned by the owner                                                    |
| `status`      | `working`, `done`, or `failed`                                           |
| `reply`       | Text. Set only when `status` is `done`. Links go in the text             |
| `error`       | `{ code, message }`. Set only when `status` is `failed`                  |
| `confirmation` | Optional. Set with `done` when an action waits for the person (see [Confirm an action](#confirm-an-action)) |
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
GET  /cap/v1/confirmations/{id}   (only for owners that confirm actions)
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

`GET /cap/v1/messages/{id}` returns `200` with the message. While it is `working`, the response sets `Retry-After`. An owner may hold a read open, under 30 seconds, and answer as soon as the message finishes. It may do the same for a confirmation read and for a code login's token request. A caller sets its timeout to allow that, and sends the next read right after a response that is still `working` or `pending` comes back after a hold.

A message is visible only to the `CAP-From` that sent it, with the same grant or none. Anyone else gets `404`. The owner keeps a finished message for at least 24 hours. After that, a read is `404` and the caller asks again.

## Access

A public question needs no token. A question about an account needs the person to log in.

Login is OAuth 2.1. The visiting agent is a public client. It has no secret and does not register with the company first. The person types their password only on the company's page. The visiting agent receives a token bound to that person's account and to its own `CAP-From`, and sends it on each request. It never holds the person's password or the company's keys.

There are two ways to log in. Every caller can use the **code login** (the device authorization grant, RFC 8628), because it needs only HTTP requests: the agent shows the person a link, the person approves on the company's page, and the agent picks up the token. A caller that can receive a browser redirect may use the **redirect login** (the authorization code flow with PKCE) instead. An owner with an `OAuth` line supports the code login. The redirect login is optional.

### Discovery

The `OAuth` line is the authorization server's issuer. The caller reads the server's metadata (RFC 8414), with `/.well-known/oauth-authorization-server` inserted between the host and the issuer's path:

```
OAuth: https://harborgoods.example/oauth
GET https://harborgoods.example/.well-known/oauth-authorization-server/oauth
```

The metadata includes `issuer`, `device_authorization_endpoint`, `token_endpoint`, and `revocation_endpoint`. An owner with the redirect login also lists `authorization_endpoint`, `code_challenge_methods_supported` with `S256`, and `client_id_metadata_document_supported: true`.

### Log in with a code

1. The caller posts a form to the `device_authorization_endpoint` with `client_id` set to its `CAP-From`, such as `agent:example-assistant`. It may add `client_name`, a short name the person will recognize, and `scope` (see [Access scope](#access-scope)).

```
POST https://harborgoods.example/oauth/device
Content-Type: application/x-www-form-urlencoded

client_id=agent:example-assistant&client_name=Example Assistant
```

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://harborgoods.example/oauth/device",
  "verification_uri_complete": "https://harborgoods.example/oauth/device?user_code=WDJB-MJHT",
  "expires_in": 600,
  "interval": 5
}
```

2. The caller gives the person `verification_uri_complete` and the `user_code`, and tells them to allow it only if the code matches. The caller keeps `device_code` to itself.
3. The person opens the link, logs in on the company's page, checks the code, and allows or denies.
4. Meanwhile the caller posts to the `token_endpoint` every `interval` seconds:

```
POST https://harborgoods.example/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=GmRhmh...&client_id=agent:example-assistant
```

Until the person decides, the response is `400` with `error: authorization_pending`. `slow_down` means add 5 seconds to the interval. `access_denied` and `expired_token` are final. Once the person allows, the response is `access_token`, `token_type: Bearer`, `expires_in`, `refresh_token`, and `scope`. A device code yields a token once.

The owner shows the `client_name` and the `CAP-From` on its page, says the name is not verified, and binds the token to that `CAP-From`. Codes expire within 10 minutes.

### Log in with a redirect

The caller's `client_id` is an https URL it controls. That URL returns the agent's client metadata as JSON, an OAuth Client ID Metadata Document:

```json
{
  "client_id": "https://assistant.example/cap-client.json",
  "client_name": "Example Assistant",
  "redirect_uris": ["https://assistant.example/cap/callback"],
  "cap_from": "agent:example-assistant"
}
```

`client_id` is the document's own URL. `cap_from` is the `CAP-From` the agent sends. The owner fetches the document when the person logs in, shows `client_name` and the host of `client_id` on its consent page, and binds the token to `cap_from`. An agent that runs on the person's own device lists a loopback redirect, such as `http://127.0.0.1/callback`, and the owner accepts it on any port (RFC 8252). A caller may also use this URL as its `client_id` in the code login. The owner then shows the name as verified by that host.

The steps:

1. The caller makes a random `code_verifier` and opens the `authorization_endpoint` for the person with `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, and optionally `scope`.
2. The person logs in on the company's page and consents. The owner redirects to `redirect_uri` with `code`, `state`, and `iss`. The `redirect_uri` must be one the client document lists. If it is not, the owner shows an error and does not redirect.
3. The caller posts to the `token_endpoint` as a form: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `code_verifier`. The response is `access_token`, `token_type: Bearer`, `expires_in`, and `refresh_token`.

A code works once and expires within 10 minutes.

### Access scope

A login reads by default. A caller that needs the owner's agent to make changes for the person asks for `scope=write`, which includes read. An owner that offers changes lists `scopes_supported: ["read", "write"]` in its metadata, and returns `invalid_scope` for a scope it does not know.

The owner's page says what the caller is asking for. When the caller asks to write, the person can allow changes, allow read only, or deny. The token response's `scope` is what the person granted: `read`, or `read write`. It is never more than the caller asked for, and a renewed token keeps it.

Write access lets the owner's agent act within what the person could do themselves. The owner decides which actions that covers, and may give write tokens a shorter `expires_in`. Actions that are hard to undo, such as deletes or payments, should need the person to confirm each one on the owner's page.

### Confirm an action

A write token does not let an agent delete or pay on its own. When a message asks for such an action, the owner does not do it. It holds the action, answers `done` with a `reply` that says what is waiting, and adds `confirmation`:

```json
{
  "id": "msg_9b1e44c0a7d2f310",
  "status": "done",
  "reply": "Deleting the post \"Hello World\" needs your OK: https://harborgoods.example/confirm?id=cfm_4kq...",
  "confirmation": {
    "id": "cfm_4kq...",
    "status": "pending",
    "url": "https://harborgoods.example/confirm?id=cfm_4kq...",
    "summary": "Delete the post \"Hello World\" from Blog.",
    "authorization_details": [{ "type": "delete_post", "post": "hello-world" }],
    "expires_at": "2026-10-17T06:07:58Z"
  }
}
```

1. The caller gives the person `url` and `summary`. It never says the action is done.
2. The person opens the link, logged in on the owner's page, and approves or denies. The owner runs an approved action once, as the person, and never twice.
3. The caller reads `GET /cap/v1/confirmations/{id}` with the same token and `CAP-From`, waiting `Retry-After` between reads. `status` is `pending`, `working`, `done`, `failed`, `denied`, or `expired`. `done` and `failed` may carry `result.message`, written for the person.

A confirmation is visible only to the `CAP-From` and account that asked for it. It expires within 10 minutes if no one decides. `authorization_details` describes the action in the owner's own types, in the style of Rich Authorization Requests (RFC 9396). The pattern is the one OpenID CIBA uses for approving an action out of band, applied to one action.

### Use, renew, and revoke

An account request carries `Authorization: Bearer` and the `CAP-From` the token was issued to. Another `CAP-From` gets `403`. An expired or revoked token gets `401`.

The caller renews with `grant_type=refresh_token`, `refresh_token`, and `client_id`. The owner returns a new refresh token, and the old one stops working. The caller revokes with the `revocation_endpoint` (RFC 7009), sending `token` and `client_id`. Revoking stops that agent, and nothing else has to rotate.

The token endpoint returns OAuth's own errors, such as `invalid_grant`, not CAP's. An owner may require sender-constrained tokens with DPoP (RFC 9449), so a copied token is useless without the agent's key. Its metadata then lists `dpop_signing_alg_values_supported`, and the caller sends a DPoP proof with each token request and CAP request.

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
7. For account questions, publishes OAuth metadata and supports the code login, with no registration. Binds each token to the `CAP-From` that logged in. If it offers the redirect login, it accepts client id metadata documents and requires PKCE with `S256`.

## Caller rules

A caller conforms if it:

1. Never calls the owner's tools, MCP servers, or APIs to do or check the work.
2. Uses `reply` only when `status` is `done`.
3. Never invents a reply while a message is `working`. It tells the person the owner is still answering.
4. Waits at least `Retry-After` between reads.
5. Treats `failed` as final for that message. It sends a new one only when something changed, such as the person logging in.
6. Sends a short brief in `context`. Never the person's password or another company's data.
7. Sets `previous_message_id` to the last message when the person is continuing the same conversation, and leaves it off when they start a new one.
8. Logs in only through the owner's page, with the code login or the redirect login. Never asks the person for their password, and never sends the `device_code` to the person.
9. Gives the person a `confirmation` link as it is, and never reports a confirmed action as done until its status is `done`.

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
| `not_found`             | 404  | The message, confirmation, or `previous_message_id` does not exist, has expired, or is not visible to this caller |
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

---

Copyright 2026 Tony Spiro. Licensed under [CC BY 4.0](LICENSE-SPEC). Attribute as: "Concierge Agent Protocol (CAP), by Tony Spiro, https://conciergeprotocol.org." "CAP" and "Concierge Agent Protocol" are trademarks of Tony Spiro. See [TRADEMARKS.md](TRADEMARKS.md).
