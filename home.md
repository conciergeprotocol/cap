# Concierge Agent Protocol (CAP)

**The front door to your website, for every AI agent.**

Let AI agents ask your business directly. Your agent answers from your catalog, docs, and records, with a link to the next step on your site. Agents stop guessing from your pages, and your internal tools stay private.

<p class="hero-cta"><a class="cta" href="/publish">Make your website agent-ready</a><a class="cta-alt" href="#see-cap-in-action">See CAP in action</a></p>

### See CAP in action

<div class="proof" data-proof></div>

The same shopping question, read from the site and asked through CAP. [See the benchmark](benchmark/README.md).

<figure class="bench-replay" data-replay></figure>

### Why websites publish a door

<div class="benefits">
<div><strong>Own your answers</strong><p>Agents get your catalog, docs, and policies, not a guess from your pages.</p></div>
<div><strong>Link buyers to the right page</strong><p>Replies link to the product, plan, or booking page on your site.</p></div>
<div><strong>See what they ask</strong><p>Every question comes to your agent, so you know what people want.</p></div>
</div>

### Get started

You publish one text file, `agent.txt`. A visiting agent reads it, sends a message, and gets a reply. Your tools, keys, and data stay on your servers.

<div class="paths">
<a href="https://conciergeprotocol.org/publish"><span>For websites</span><strong>Publish a door</strong><p>Give agents your answer, from your content, with a link to the next step.</p></a>
<a href="https://conciergeprotocol.org/callers"><span>For AI agents</span><strong>Call a door</strong><p>Ask a company's agent directly, with the client library or the MCP server.</p></a>
</div>

[![Play the CAP explainer: the front door to your website, for every AI agent](site/public/cap-explainer.jpg)](https://media.conciergeprotocol.org/cap-explainer.mp4?v=20261027a)

**Status: Draft. Version 1.0.** Read it at [conciergeprotocol.org](https://conciergeprotocol.org). Feedback is welcome in [issues](https://github.com/conciergeprotocol/cap/issues).

- [Introducing the Concierge Agent Protocol](article/introducing-the-concierge-agent-protocol.md)
- [White paper](article/white-paper.md)
- [Concepts](concepts/README.md)
- [Publish a door](publish.md)
- [Specification](spec.md)
- [Usage](usage.md)
- [Call a door](callers.md)
- [Add login to your agent](login.md)
- [Reference server](reference/README.md)
- [Store example](examples/store)
- [Next.js example](examples/next)
- [Check a door](https://conciergeprotocol.org/check)
- [Governance](GOVERNANCE.md), [Security](SECURITY.md), and [Changelog](CHANGELOG.md)

## Try it from your assistant

Assistants do not read `agent.txt` on their own yet. The CAP MCP server lets Claude, Cursor, VS Code, or any MCP host ask a front door today:

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

Then ask your assistant about any site that publishes `agent.txt`. The [checker](https://conciergeprotocol.org/check) tells you whether a site has one. Code that calls doors directly uses `@conciergeprotocol/client`. Both are in [Call a door](callers.md).

## Two examples

**Public.** "Find me running shoes in size 12, black sweatpants, and a black hoodie in my style." The person's agent finds `agent.txt`, sends the request with a short style brief, and the store's agent searches its own catalog. The reply is products, sizes in stock, prices, and links. Checkout stays on the store's site. A person on the store's chat page gets the same agent.

**Logged in.** "Where's my order?" The reply is `login_required`. The person logs in at the store's OAuth server, and their agent gets a token for that one account. It sends the same message with the token. The store's agent finds the order with its own tools and replies with the status.

## Why companies publish one

A person's agent is already on its way to your site. [Cloudflare reports](https://blog.cloudflare.com/agentic-web/) that daily requests from AI agents on its network grew more than 1,700% over the past year. [Meta said](https://s21.q4cdn.com/399680738/files/content_files/META-Q3-2026-Earnings-Call-Transcript.pdf) on October 21, 2026 that more than 10 million people had set up its Muse agent in about six weeks, and that shopping is the most common use. Those figures are requests and signups, not a count of agents on any one site. Without a door, the agent pieces an answer together from pages built for people, and the person still has to find the right page themselves. You never see the question. With a door, the answer, the link, and the question are yours. And:

- No contact form to wait on for a question your records can answer now.
- A door you publish on purpose, instead of a scrape of your pages. `CAP-From` names the caller, as a label rather than verified identity, and your own rate limits apply.
- Your tools and keys stay behind the door. A reply carries only what that request is allowed to see.

Each answer is a model call on your side, and a reply is only as good as your record. [Publish a door](publish.md) is the guide.

## Why visiting agents use it

Browsing a site means rendering pages, getting past banners and bot blocks, and spending tokens on markup to find one fact. With CAP the visiting agent asks once:

- One URL from `agent.txt`, instead of guessing which pages matter.
- The company's own answer from its record, instead of an inference from a page.
- The company does the search and pays for it. The caller gets a short reply. In the [CAP benchmark](benchmark/README.md), the same answers cost about a fifth of fetching the site and a seventh of browsing it, counting both sides.
- Follow-ups send only the new question.
- A door the company published for agents, instead of a scrape that can be blocked. `CAP-From` names the caller for logs and rate limits.
- A token the person grants for account questions, never a password.

The reply is the company's own claim, not a neutral review. The visiting agent still decides what to tell the person. A reply is only as good as the company's agent, which has to say "not available" when its records find nothing.

## How CAP fits

| Protocol | For                                                                          |
| -------- | ---------------------------------------------------------------------------- |
| MCP      | An agent reaching its own tools                                              |
| A2A      | Agents that integrate deeply with each other: agent cards, tasks, streaming  |
| CAP      | Any agent asking a company's agent from its domain: one file, two endpoints  |

CAP works alongside these. A company can serve CAP and A2A from the same agent, since a CAP message maps onto an A2A task. See [Relationship to other protocols](spec.md#relationship-to-other-protocols).

## When to publish an agent

Publish one when it knows something a visitor's agent cannot read for itself:

- An account. The person logs in. The visiting agent never receives the company's keys.
- A record too large for one prompt. The company searches its own catalog or CMS.
- A record the pages do not reliably show. The page is stale, or the help page offers something the policy refuses.

When every answer is already printed on a few accurate pages, reading those pages is faster.

## agent.txt

A company publishes one file at `https://{domain}/agent.txt`. An agent fetches it. A person uses the chat page. The file lists no tools, keys, or prompts.

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
Spec: https://conciergeprotocol.org/cap.txt
```

`Protocol` comes first and names the format. `Name` is the public agent. `Chat` is the page a person opens. `CAP` is the base URL for `/cap/v1`. `OAuth` is the login server for account questions. Leave it off when the agent answers only public questions. `Spec` points at the hosted caller card. Use it as written rather than hosting your own copy.

The chat page and the CAP URL can live on another host. The company's domain is what a caller trusts. Only the `CAP` line changes when the server moves.

Point at the door from the homepage, including when `/agent.txt` is already a valid file. Agents that are reading the page follow the link.

```html
<link rel="agent" href="https://harborgoods.example/agent.txt">
```

A `Link` header on the homepage means the same thing: `Link: <https://harborgoods.example/agent.txt>; rel="agent"`. Add one line to `llms.txt` that points at `/agent.txt`. A site may list that file in `/.well-known/ai-catalog.json` with `type` `text/plain`.

CAP callers still request `/agent.txt` first and skip the homepage when that file is a valid door. Some hosts will not serve a file at the site root. Redirect `/agent.txt` to the file, on any https URL. When that request is not a door, a caller follows the homepage link. The spec has the exact order.

## The wire

```
POST /cap/v1/messages        { "message": "...", "context": { ... }, "previous_message_id": "..." }
GET  /cap/v1/messages/{id}

CAP-Version: 1.0
CAP-From: agent:your-agent-id
```

Every request carries `CAP-Version` and `CAP-From`. Without them the reply is `400`. `200` with the reply when it is ready. `202` with `Location` and `Retry-After` when it is not. Statuses are `working`, `done`, and `failed`. Details are in [Usage](usage.md).

## Run a server

[`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) is one process that speaks `/cap/v1`. You pass an `answer` function. [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds that function from a model, an `llms.txt` file, and MCP tools. Node.js 22 or newer. It needs no account on any vendor. SQLite is built in.

```bash
npm install @conciergeprotocol/server
```

```js
import { createCapServer } from '@conciergeprotocol/server'

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer: async ({ message }) => `You asked: ${message}`,
})
await cap.listen(8088)
```

A company that already has a bot uses that bot as `answer`. The agent package is for a site that has no bot yet:

```js
import { createAnswer } from '@conciergeprotocol/agent'

const answer = await createAnswer({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You answer for Harbor Goods. Link to the page.',
  sources: [{ type: 'llms', url: 'https://harborgoods.example/llms.txt' }],
})
```

The [reference server](reference) in this repository is the same process, and the one the spec is checked against. Node.js is the only local install. Messages are stored in `reference/data/cap.sqlite` and survive a restart.

```bash
cd reference
node start.mjs
```

The server listens on port 8088.

```bash
curl http://127.0.0.1:8088/agent.txt
```

`GET /health` is the probe. Edit `reference/cap.json` to set the agent name, the chat URL, and how it answers: a fixed reply, an echo, or a POST to a URL you run. The secret for that URL stays in the environment and never appears in a reply.

`node check.mjs` runs the conformance checks against a temporary database.

To answer account questions, or make changes for a logged-in person, follow [Add login to your agent](login.md).

To have a coding assistant do it, give it the prompt at [conciergeprotocol.org/implement.txt](https://conciergeprotocol.org/implement.txt).

To deploy, build the image and keep the SQLite file on a volume:

```bash
docker build -t cap-reference reference
docker run -p 8088:8088 -v cap-data:/app/data cap-reference
```

Set `PORT` when the host assigns one. Set `DATABASE_URL` to a Postgres connection string to use Postgres instead of the file. From `reference/`, run `bun install` first so the Postgres driver is present. Set `PUBLIC_URL` to the public origin so `agent.txt` from this process advertises an https CAP URL.

Point the company's file at that origin:

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://cap.harborgoods.example/cap/v1
Spec: https://conciergeprotocol.org/cap.txt
```

## Contributing

The spec is the contract. A behavior change belongs in `spec.md` and in the reference server together. From `reference/`, run `node check.mjs` before opening a pull request.

The spec does not require a database or a vendor. A product's own notes stay with that product. Examples stay free of real credentials. Use an obvious demo token when a login is required.

How changes are proposed and decided is in [GOVERNANCE.md](GOVERNANCE.md). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

The specification and documentation are licensed under [CC BY 4.0](LICENSE-SPEC). The reference server, examples, and other code are licensed under [Apache 2.0](LICENSE).

Copyright 2026 Tony Spiro. "Concierge Agent Protocol" and "CAP" are trademarks of Tony Spiro. See [TRADEMARKS.md](TRADEMARKS.md).