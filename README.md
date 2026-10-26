# 🧢 Concierge Agent Protocol (CAP)

**The front door to your website, for every AI agent.**

<p align="center">
  <img src="site/public/mascot-capybara.png" alt="A capybara wearing a CAP ball cap" width="180">
</p>

A website publishes one text file, `agent.txt`. A visiting AI agent reads it, sends the person's question to the site's own agent, and gets a reply from the company's catalog, docs, and records, with a link to the next step. The company's tools, keys, and data stay on its servers.

**Status: Draft. Version 1.0.** The full overview is at [conciergeprotocol.org](https://conciergeprotocol.org). Feedback is welcome in [issues](https://github.com/conciergeprotocol/cap/issues).

## Get started

- **For websites:** [Publish a door](publish.md). [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) serves the endpoints. You pass an `answer` function, or [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds one from a model and your sources. A coding assistant can do it from [conciergeprotocol.org/implement.txt](https://conciergeprotocol.org/implement.txt).
- **For AI agents:** [Call a door](callers.md) with `@conciergeprotocol/client`, or from any MCP host with `@conciergeprotocol/mcp`.

## agent.txt

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
Spec: https://conciergeprotocol.org/cap.txt
```

Each line is explained in the [overview](home.md#agenttxt).

## The wire

```
POST /cap/v1/messages        { "message": "...", "context": { ... }, "previous_message_id": "..." }
GET  /cap/v1/messages/{id}

CAP-Version: 1.0
CAP-From: agent:your-agent-id
```

Every request carries `CAP-Version` and `CAP-From`. Without them the reply is `400`. `200` with the reply when it is ready. `202` with `Location` and `Retry-After` when it is not. Account questions return `login_required` and use OAuth 2.1. Details are in [Usage](usage.md) and the [specification](spec.md).

## Run a door

[`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) serves `agent.txt` and `/cap/v1`. You write `answer`. [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds that function from a model, an `llms.txt` file, and MCP tools. Node.js 22 or newer.

```bash
npm install @conciergeprotocol/server @conciergeprotocol/agent
```

```js
import { createAnswer } from '@conciergeprotocol/agent'
import { createCapServer } from '@conciergeprotocol/server'

const answer = await createAnswer({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You answer for Harbor Goods. Link to the page.',
  sources: [{ type: 'llms', url: 'https://harborgoods.example/llms.txt' }],
})

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer,
})
await cap.listen(8088)
```

A company that already answers questions passes its own `answer` and skips the agent package.

## Run the reference server

The server in this repository is the one the spec is checked against. Node.js is the only install. Messages are stored in SQLite.

```bash
cd reference
node start.mjs
curl http://127.0.0.1:8088/agent.txt
```

Configuration, logins, and deployment are in the [reference server README](reference/README.md).

## Docs

- [Overview](home.md)
- [Specification](spec.md) and [Usage](usage.md)
- [Concepts](concepts/README.md)
- [Publish a door](publish.md) and [Add login to your agent](login.md)
- [Call a door](callers.md)
- [Benchmark](benchmark/README.md)
- [Store example](examples/store) and [Next.js example](examples/next)
- [Check a door](https://conciergeprotocol.org/check)
- [Introducing the Concierge Agent Protocol](article/introducing-the-concierge-agent-protocol.md) and the [white paper](article/white-paper.md)

## Contributing

The spec is the contract. A behavior change belongs in `spec.md` and in the reference server together. From `reference/`, run `node check.mjs` before opening a pull request.

The spec does not require a database or a vendor. A product's own notes stay with that product. Examples stay free of real credentials. Use an obvious demo token when a login is required.

How changes are proposed and decided is in [GOVERNANCE.md](GOVERNANCE.md). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Releases are in the [changelog](CHANGELOG.md).

## License

The specification and documentation are licensed under [CC BY 4.0](LICENSE-SPEC). The reference server, examples, and other code are licensed under [Apache 2.0](LICENSE). The cap icon is from [Noto Emoji](https://github.com/googlefonts/noto-emoji), licensed under Apache 2.0.

Copyright 2026 Tony Spiro. "Concierge Agent Protocol" and "CAP" are trademarks of Tony Spiro. See [TRADEMARKS.md](TRADEMARKS.md).
