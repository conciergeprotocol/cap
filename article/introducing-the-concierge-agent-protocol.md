# Introducing the Concierge Agent Protocol

People send their own agents to company websites. "Find me running shoes in size 12, black sweatpants, and a black hoodie in my style." "Where's my order?" Today that agent has two options. It can read the pages, or it can be handed the company's tools.

Reading pages works when the site is small and the answer is printed on it. It stops working when the catalog is too large to read, when the page is stale, and every time the question is about the person's own account. Order status is not on a public page.

Handing over tools is worse. An MCP server or an API key gives the visiting agent the company's schema, its credentials, and every customer's data behind them. No company should give that to a stranger's agent, and no person should need it to ask where a package is.

Companies already have an agent that knows the answer: the one on their chat page, with access to their catalog, their CMS, and their order system. What is missing is a way for another agent to ask it.

The **Concierge Agent Protocol (CAP)** is that way: a front door to the website, for every AI agent. The company publishes one text file. A visiting agent knocks with a message, and the company's agent greets it like a hotel concierge: it works for the company, not the visitor. It does the work with its own tools, and hands back the answer. **Share results, not credentials.**

## How it works

The company serves `https://{domain}/agent.txt`:

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
```

A host that cannot put a file at the root can redirect `/agent.txt`, or add `<link rel="agent" href="...">` to the homepage. Callers try the root file first.

The visiting agent sends the question, with a short brief of what it knows about the person:

```
POST /cap/v1/messages
CAP-Version: 1.0
CAP-From: agent:shopper

{ "message": "Running shoes in size 12, black sweatpants, and a black hoodie",
  "context": { "style": "minimal, no logos", "sizes": { "bottoms": "L", "tops": "L" } } }
```

The company's agent searches its own catalog however it likes and replies with the products, sizes in stock, prices, and links. Checkout stays on the company's site.

For "Where's my order?", the reply is `login_required`. The person logs in at the `OAuth` server, the visiting agent gets a token for that one account, and sends the same message with `Authorization: Bearer`. The company's agent uses its own tools to find the order. Only the answer comes back.

When an answer takes a while, the reply is `202` with the message id and `Retry-After`. The agent tells the person the store is checking, waits, and reads the message again. That is the whole protocol: one message, two endpoints.

## Why the visiting agent prefers it

Websites were built for people. An agent that browses one renders JavaScript, clicks past cookie banners, runs into bot blocks, and reads pages of markup to find one fact. With CAP it asks once and gets the company's own answer.

- **It knows where to go.** One file at the domain root gives one URL. No guessing which pages matter.
- **It gets the record, not the page.** The company's agent answers from the catalog, the current price, the right store's hours. The visiting agent does not have to find the page that holds them.
- **It saves its tokens.** The company's agent does the search and pays for it. The visiting agent gets back a short reply instead of a context window full of HTML. In the [CAP benchmark](../benchmark/README.md), the same answers cost about a fifth of fetching the site and a seventh of browsing it. The gap is widest on catalog searches and smallest on one fact from one clean page.
- **A smaller model is enough.** The search happens on the company's side. In the benchmark, Claude Haiku 4.5 answered every question through CAP for under 2 cents each.
- **The answer is attributable.** The agent can tell its person "the store says." While a message is `working` there is no reply, so the agent waits instead of filling the gap. The answer is only as good as the company's agent, which has to say "not available" when its records find nothing.
- **Follow-ups are cheap.** It sends only the new question. The company keeps the earlier turns.
- **It is invited.** `CAP-From` names the caller, and the company published the door for it. A scraper can be blocked. A CAP call is welcome.
- **It never holds a password.** For the account, the person logs in and the agent sends a token. It does not drive a logged-in browser.

## What stays with the company

The prompt, the tools, the MCP servers, the vendor keys, the catalog index, and the limits. The visiting agent never learns how the answer was found, and it never sees another customer's data. Revoking the login token stops that agent. Nothing else has to rotate.

## What stays with the person

Their agent decides what to share. A size and a style are a brief, not a profile. Their password goes to the company's login page, never to their agent.

## Why familiar matters

Everything on the wire is ordinary HTTP: `202 Accepted` with `Location`, `Retry-After`, `429`, OAuth bearer tokens, `Idempotency-Key`, and a `{ error: { code, message } }` body. The only new pieces are `agent.txt` and the `CAP-From` header. Anyone who has called a REST API can implement it in an afternoon.

## When to use it

Publish an agent when it knows something a visitor's agent cannot read for itself: an account, a catalog too large for one prompt, or a record the pages do not show reliably. If every answer is already printed on a few accurate pages, reading those pages is faster.

The visiting agent should know the limits too. The answer is the company's framing, so for comparisons and reviews it should still check other sources. The answer is only as good as the company's record. Most domains have no `agent.txt` yet, so a caller keeps browsing as its fallback.

## What this is not

This is not a replacement for MCP. MCP is how the company's agent reaches its own tools. It is not a replacement for A2A either, which suits agents that integrate deeply with each other. The Personal Agent Protocol covers similar ground with more machinery: sessions, scopes, browser sessions, and APIs. CAP does the same job with one file, two endpoints, and a standard OAuth token for account questions. It is the small door any agent can find from a domain, and an owner can serve it next to any of these from the same agent. How they fit together is in the [spec](../spec.md#relationship-to-other-protocols).

## Try it

The [README](../README.md) has the reference server and the [store example](../examples/store), which runs both questions above on one agent.
