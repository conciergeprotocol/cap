# Store example

One store, one agent, two kinds of question. A product search needs no login. An order needs the person to log in. The store's catalog search and its orders key stay in the store process. The visiting agent only sees replies.

```bash
cd examples/store
node start.mjs
```

Open http://127.0.0.1:8810. The page plays the visiting agent. `node check.mjs` runs the same exchange on a random port.

Every request sends `CAP-Version: 1.0` and `CAP-From: agent:shopper`. Ids and timestamps change each run.

## 1. Find the agent

```bash
curl http://127.0.0.1:8810/agent.txt
```

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: http://127.0.0.1:8810/chat
CAP: http://127.0.0.1:8810/cap/v1
OAuth: http://127.0.0.1:8810/oauth
```

## 2. A public question

The person told their agent: "Find me running shoes in size 12, black sweatpants, and a black hoodie in my style." The agent knows the person, so it sends that knowledge as a short brief in `context`. The store knows nothing else about them.

```bash
curl -X POST http://127.0.0.1:8810/cap/v1/messages \
  -H 'content-type: application/json' \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -d '{"message":"Running shoes in size 12, black sweatpants, and a black hoodie","context":{"style":"minimal, no logos","sizes":{"bottoms":"L","tops":"L"}}}'
```

`200`

```json
{
  "id": "msg_c1fac527668c6694",
  "status": "done",
  "reply": "Here is what fits:\n- Running shoes: Stride Runner, black, size 12 in stock, $120. https://harborgoods.example/p/stride-runner\n- Sweatpants: Everyday Fleece Jogger, black, size L in stock, $65. https://harborgoods.example/p/fleece-jogger\n- Hoodie: Heavyweight Hoodie, black, size L in stock, $85. https://harborgoods.example/p/heavyweight-hoodie\nCheckout is on our site.",
  "created_at": "2026-10-15T17:09:09.620Z",
  "finished_at": "2026-10-15T17:09:09.621Z"
}
```

The brief ruled out the logo sweatpants and the graphic hoodie. The search in `catalog.mjs` is a stand-in. A real store would search its own catalog, for example with semantic search over its CMS. The caller never learns which.

## 3. A follow-up

The person says "something cheaper?" The agent sends only that, and points at the last message.

```bash
curl -X POST http://127.0.0.1:8810/cap/v1/messages \
  -H 'content-type: application/json' \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -d '{"message":"Something cheaper?","previous_message_id":"msg_c1fac527668c6694"}'
```

`200`

```json
{
  "id": "msg_92f4ed1fce56ff23",
  "status": "done",
  "reply": "Cheaper options that still fit:\n- Running shoes: Tempo Runner, black, size 12 in stock, $95. https://harborgoods.example/p/tempo-runner\n- Sweatpants: Everyday Fleece Jogger at $65 is already the lowest price in size L.\n- Hoodie: Everyday Hoodie, black, size L in stock, $60. https://harborgoods.example/p/everyday-hoodie\nCheckout is on our site.",
  "created_at": "2026-10-15T17:28:36.879Z",
  "finished_at": "2026-10-15T17:28:36.879Z"
}
```

The store rebuilt the thread from its own records, so it still knew the sizes and "no logos". The caller never resends earlier turns. To keep going, it sends the next message with `previous_message_id` set to this id.

## 4. An account question without a login

```bash
curl -X POST http://127.0.0.1:8810/cap/v1/messages \
  -H 'content-type: application/json' \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -d '{"message":"Where'\''s my order?"}'
```

`200`

```json
{
  "id": "msg_16dcccae07e01cce",
  "status": "failed",
  "error": { "code": "login_required", "message": "Log in to Harbor Goods to ask about your order." },
  "created_at": "2026-10-15T17:09:09.626Z",
  "finished_at": "2026-10-15T17:09:09.626Z"
}
```

## 5. The person logs in

The agent sends the person to the `OAuth` server from `agent.txt`. This route is a local stand-in for a real login page. It is not part of `/cap/v1`.

```bash
curl -X POST http://127.0.0.1:8810/oauth/token \
  -H 'content-type: application/json' \
  -d '{"account":"maya","client":"shopper"}'
```

```json
{ "access_token": "grant_be25a77ad64b26e0", "token_type": "Bearer", "account": "maya" }
```

The token is bound to Maya and to `agent:shopper`. The same token with a different `CAP-From` is `403`.

## 6. The same question with the token

```bash
curl -X POST http://127.0.0.1:8810/cap/v1/messages \
  -H 'content-type: application/json' \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -H 'authorization: Bearer grant_be25a77ad64b26e0' \
  -d '{"message":"Where'\''s my order?"}'
```

`200`

```json
{
  "id": "msg_0bba6e3df8d369a3",
  "status": "done",
  "reply": "Your Stride Runner shipped Tuesday and arrives Friday. Track it at https://carrier.example/track/hg_1042",
  "created_at": "2026-10-15T17:09:09.629Z",
  "finished_at": "2026-10-15T17:09:09.630Z"
}
```

## 7. A slow answer

Sam's order lookup takes about 2.5 seconds. This store waits one second before it replies, so the answer is not ready yet.

`202`, with `Location: /cap/v1/messages/msg_22eec828b542bf17` and `Retry-After: 1`

```json
{
  "id": "msg_22eec828b542bf17",
  "status": "working",
  "created_at": "2026-10-15T17:09:09.631Z",
  "finished_at": null
}
```

The agent tells Sam the store is still checking, waits for `Retry-After`, and reads the message again.

```bash
curl http://127.0.0.1:8810/cap/v1/messages/msg_22eec828b542bf17 \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -H 'authorization: Bearer <Sam token>'
```

```json
{
  "id": "msg_22eec828b542bf17",
  "status": "done",
  "reply": "Your Heavyweight Hoodie is packing. It has no tracking link yet.",
  "created_at": "2026-10-15T17:09:09.631Z",
  "finished_at": "2026-10-15T17:09:12.132Z"
}
```

Maya's token cannot read Sam's message. That read is `404`.
