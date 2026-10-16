# 🧢 Concierge Agent Protocol (CAP)

**The front door to your website, for every AI agent.**

Soon everyone will have an agent that visits websites for them. CAP gives your company a concierge to greet it. The concierge is your agent, working for you at your front door: the visiting agent asks, your agent answers with your own tools, and nothing else leaves the building. Share results, not credentials.

The company publishes one text file, `agent.txt`. The visiting agent reads it, sends a message, and gets a reply. No tools, MCP servers, or API keys change hands.

**Status: Draft. Version 1.0.** Read it at [conciergeprotocol.org](https://conciergeprotocol.org). Feedback is welcome in [issues](https://github.com/conciergeprotocol/cap/issues).

- [Introducing the Concierge Agent Protocol](article/introducing-the-concierge-agent-protocol.md)
- [White paper](article/white-paper.md)
- [Concepts](concepts/README.md)
- [Specification](spec.md)
- [Usage](usage.md)
- [Reference server](reference/README.md)
- [Store example](examples/store)
- [Governance](GOVERNANCE.md), [Security](SECURITY.md), and [Changelog](CHANGELOG.md)

## Two examples

**Public.** "Find me running shoes in size 12, black sweatpants, and a black hoodie in my style." The person's agent finds `agent.txt`, sends the request with a short style brief, and the store's agent searches its own catalog. The reply is products, sizes in stock, prices, and links. Checkout stays on the store's site. A person on the store's chat page gets the same agent.

**Logged in.** "Where's my order?" The reply is `login_required`. The person logs in at the store's OAuth server, and their agent gets a token for that one account. It sends the same message with the token. The store's agent finds the order with its own tools and replies with the status.

## Why visiting agents use it

Websites were built for people. Browsing one means rendering pages, getting past banners and bot blocks, and spending tokens on markup to find one fact. With CAP the visiting agent asks once:

- One URL from `agent.txt`, instead of guessing which pages matter.
- The company's own answer from its record, instead of an inference from a page.
- The company does the search and pays for it. The caller gets a short reply.
- Follow-ups send only the new question.
- An invited call, named by `CAP-From`, instead of a scrape that can be blocked.
- A token the person grants for account questions, never a password.

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
Spec: https://harborgoods.example/cap.txt
```

`Protocol` comes first and names the format. `Name` is the public agent. `Chat` is the page a person opens. `CAP` is the base URL for `/cap/v1`. `OAuth` is the login server for account questions. Leave it off when the agent answers only public questions. `Spec` points at a short caller card. Leave it off when you have no public URL for one.

The chat page and the CAP URL can live on another host. The company's domain still serves this file. Only the `CAP` line changes when the server moves.

## The wire

```
POST /cap/v1/messages        { "message": "...", "context": { ... }, "previous_message_id": "..." }
GET  /cap/v1/messages/{id}
```

`200` with the reply when it is ready. `202` with `Location` and `Retry-After` when it is not. Statuses are `working`, `done`, and `failed`. Details are in [Usage](usage.md).

## Run a server

The [reference server](reference) is one process that speaks `/cap/v1`. It needs no account on any vendor. Node.js is the only local install. SQLite is built in, so there is no database to set up. Messages are stored in `reference/data/cap.sqlite` and survive a restart.

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

To deploy, build the image and keep the SQLite file on a volume:

```bash
docker build -t cap-reference reference
docker run -p 8088:8088 -v cap-data:/app/data cap-reference
```

Set `PORT` when the host assigns one. Set `DATABASE_URL` to a Postgres connection string to use Postgres instead of the file. From `reference/`, run `bun install` first so the Postgres driver is present. Set `PUBLIC_URL` to the public origin so `agent.txt` from this process advertises an https CAP URL.

Point the company's file at that origin:

```text
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://cap.harborgoods.example/cap/v1
```

## Contributing

The spec is the contract. A behavior change belongs in `spec.md` and in the reference server together. From `reference/`, run `node check.mjs` before opening a pull request.

The spec does not require a database or a vendor. A product's own notes stay with that product. Examples stay free of real credentials. Use an obvious demo token when a login is required.

How changes are proposed and decided is in [GOVERNANCE.md](GOVERNANCE.md). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

The specification and documentation are licensed under [CC BY 4.0](LICENSE-SPEC). The reference server, examples, and other code are licensed under [Apache 2.0](LICENSE).
