# Usage

How to call CAP. The [specification](spec.md) is the contract.

## 1. Find the agent

```
GET https://harborgoods.example/agent.txt
```

Use the file only if it has a `CAP` line.

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
```

`CAP` is the base URL. A person uses `Chat` instead.

## 2. Send a message

Every request carries:

```
CAP-Version: 1.0
CAP-From: agent:your-agent-id
```

```
POST /cap/v1/messages

{
  "message": "Running shoes in size 12, black sweatpants, and a black hoodie",
  "context": { "style": "minimal, no logos", "sizes": { "bottoms": "L", "tops": "L" } }
}
```

`context` is a short brief from what your agent knows about the person. Not their profile, and not the company's API payload.

If the answer is ready, the response is `200`:

```json
{
  "id": "msg_c1fac527668c6694",
  "status": "done",
  "reply": "Here is what fits:\n- Running shoes: Stride Runner, black, size 12 in stock, $120. https://harborgoods.example/p/stride-runner\n...",
  "created_at": "2026-10-15T17:09:09.620Z",
  "finished_at": "2026-10-15T17:09:09.621Z"
}
```

## 3. Follow up

To continue the conversation, send only the new text and the id of the last message:

```
POST /cap/v1/messages

{ "message": "Something cheaper?", "previous_message_id": "msg_c1fac527668c6694" }
```

The owner answers with every earlier turn in mind, including the brief you sent with them. Do not resend earlier turns. Keep the newest id and pass it on the next follow-up. Leave `previous_message_id` off to start a new conversation.

`404` means the previous message is gone or not yours. `409` means it is still `working`, or the thread is too long. Wait for it to finish, or start a new conversation.

## 4. Wait when it is still working

If the answer is not ready, the response is `202`:

```
202 Accepted
Location: /cap/v1/messages/msg_22eec828b542bf17
Retry-After: 5
```

```json
{ "id": "msg_22eec828b542bf17", "status": "working", "created_at": "2026-10-15T17:09:09.631Z", "finished_at": null }
```

Tell the person the company is still answering. Wait `Retry-After` seconds, then read it:

```
GET /cap/v1/messages/msg_22eec828b542bf17
```

Each `working` read sets a new `Retry-After`. Keep going until `done` or `failed`.

Send `Idempotency-Key` when a resend after a dropped connection must not ask twice. The same key from the same `CAP-From`, with the same token or none, returns the original message.

## 5. Log in for account questions

Without a token, an account question fails:

```json
{
  "id": "msg_16dcccae07e01cce",
  "status": "failed",
  "error": { "code": "login_required", "message": "Log in to Harbor Goods to ask about your order." }
}
```

Your agent logs in with OAuth 2.1 and PKCE. It needs no secret and no registration with the company.

**Once, for your agent:** host a client document at an https URL you control. That URL is your `client_id`.

```json
{
  "client_id": "https://assistant.example/cap-client.json",
  "client_name": "Example Assistant",
  "redirect_uris": ["https://assistant.example/cap/callback"],
  "cap_from": "agent:your-agent-id"
}
```

An agent that runs on the person's device can list `http://127.0.0.1/callback`. The company accepts it on any port.

**Each login:**

1. Read the server's metadata. For `OAuth: https://harborgoods.example/oauth`, that is `GET https://harborgoods.example/.well-known/oauth-authorization-server/oauth`.
2. Make a random `code_verifier`, and its `code_challenge`: base64url of its SHA-256.
3. Open the `authorization_endpoint` for the person:

```
https://harborgoods.example/oauth/authorize?response_type=code
  &client_id=https://assistant.example/cap-client.json
  &redirect_uri=https://assistant.example/cap/callback
  &state=<random>&code_challenge=<challenge>&code_challenge_method=S256
```

4. The person logs in on the company's page and allows access. The company redirects to your `redirect_uri` with `code`, `state`, and `iss`. Check that `state` is the one you sent.
5. Exchange the code:

```
POST https://harborgoods.example/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=<code>&redirect_uri=<redirect_uri>&client_id=<client_id>&code_verifier=<verifier>
```

```json
{ "access_token": "cap_at_...", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "cap_rt_..." }
```

The token is bound to that account and to the `cap_from` in your document. Store it, and send the message again:

```
POST /cap/v1/messages
Authorization: Bearer <access token>
CAP-Version: 1.0
CAP-From: agent:your-agent-id

{ "message": "Where's my order?", "previous_message_id": "msg_16dcccae07e01cce" }
```

`previous_message_id` is optional here. It keeps the thread going after the login. A thread can gain a token, but it cannot continue without one or on another account.

Only the same `CAP-From` and the same token can read that message later.

When the access token expires, the request is `401`. Renew it with `grant_type=refresh_token&refresh_token=<refresh>&client_id=<client_id>` at the same token endpoint. You get a new refresh token, and the old one stops working. To log out, post `token=<token>&client_id=<client_id>` to the `revocation_endpoint`.

## Errors

A request the owner will not accept returns an HTTP error:

```json
{ "error": { "code": "rate_limited", "message": "Too many messages from this agent today." } }
```

`400` is a bad request or version. `401` is an invalid, expired, or revoked token. `403` is a token issued to a different agent. `404` is a message that does not exist, has expired, or is not yours. `409` is a follow-up to a message still `working`, or a thread that is too long. `429` and `503` set `Retry-After`.

## Client algorithm

```
res = POST {cap}/messages { message, context, previous_message_id: last_id }
if res is 409 or 404:
  res = POST {cap}/messages { message, context }   # start a new conversation
last_id = res.id
while res.status == working:
  tell the person the company is still answering
  wait res.retry_after
  res = GET {cap}/messages/{id}

if res.status == done:
  use(res.reply)
elif res.error.code == login_required:
  ask the person to log in, then send again with the token
else:
  stop                     # failed is final for this message
```

## Conformance checklist

An **owner** conforms if it:

- [ ] Publishes `/agent.txt` starting with `Protocol: CAP/1.0`, with `Name`, `Chat`, `CAP`, and `OAuth` when it answers account questions
- [ ] Returns `200` when it finished within its wait, otherwise `202` with `Location` and `Retry-After`
- [ ] Returns only `id`, `status`, `reply` or `error`, `created_at`, and `finished_at`
- [ ] Answers account questions only with a token for that account. Returns `login_required` without one
- [ ] Returns `401` for a bad token, and `403` for a token used by a different agent
- [ ] Publishes OAuth metadata, accepts a client id document in place of registration, requires PKCE with `S256`, and binds each token to the document's `cap_from`
- [ ] Shows a message only to the agent and token that sent it
- [ ] Returns the original message for a repeated `Idempotency-Key`
- [ ] Keeps its limits private, and returns `429` with `Retry-After`
- [ ] Keeps finished messages for at least 24 hours
- [ ] Answers a follow-up from its own record of the thread, and never from turns the caller sends
- [ ] Returns `404` for a `previous_message_id` the caller cannot read, or on a different account, and `409` while it is `working`

A **caller** conforms if it:

- [ ] Fetches `/agent.txt` and uses it only if it has a `CAP` line
- [ ] Never calls the owner's tools, MCP servers, or APIs
- [ ] Uses `reply` only when `done`
- [ ] Never invents a reply while `working`
- [ ] Waits at least `Retry-After` between reads
- [ ] Treats `failed` as final for that message
- [ ] Sends a short brief, never a password or another company's data
- [ ] Sets `previous_message_id` only to continue the same conversation
- [ ] Logs in through the company's page with PKCE and its own client document, and never asks for the person's password
