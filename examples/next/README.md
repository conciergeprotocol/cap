# Next.js example

A door a Next.js app can mount. It serves `agent.txt` and `POST /cap/v1/messages`, and calls `answer` in `answer.mjs`. Replace that function with the one your app already uses to answer a person. Login stays in the [reference server](../../reference).

```bash
cd examples/next
node check.mjs
bun install
bun run dev
```

`node check.mjs` does not start Next. It calls the same handler the routes call. `bun run dev` mounts it at http://127.0.0.1:3000.

```bash
curl http://127.0.0.1:3000/agent.txt
```

```text
Protocol: CAP/1.0
Name: Example
Chat: https://example.com/chat
CAP: http://127.0.0.1:3000/cap/v1
```

```bash
curl -X POST http://127.0.0.1:3000/cap/v1/messages \
  -H 'content-type: application/json' \
  -H 'cap-version: 1.0' \
  -H 'cap-from: agent:shopper' \
  -d '{"message":"What is CAP?"}'
```

If `answer` is still working when the wait ends, the response is `202` with `Location` and `Retry-After`. Read that URL with the same `CAP-From`. A message is visible only to the agent that sent it. The same `Idempotency-Key` returns the original message and does not answer again.

Messages stay in memory for the life of the process. A real app keeps a finished message for at least 24 hours in its own store.
