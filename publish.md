# Publish a door

Let AI agents ask your business directly. They get your answer, with a link to the right page on your site. Your tools, keys, and data stay with you.

No agent yet? One command builds a door from your website's pages. See [Start from your website](#start-from-your-website).

Setup takes five steps:

<ol class="steps">
<li><span class="step-icon" data-icon="database"></span><a href="#1-choose-what-answers"><strong>Choose what answers</strong><p>Your chat agent, your own search, or the CAP server package.</p></a></li>
<li><span class="step-icon" data-icon="code"></span><a href="#2-add-two-endpoints"><strong>Add two endpoints</strong><p>One takes a question. The other returns the reply.</p></a></li>
<li><span class="step-icon" data-icon="file"></span><a href="#3-publish-agenttxt"><strong>Publish agent.txt</strong><p>One file at your site root that tells agents where to ask.</p></a></li>
<li><span class="step-icon" data-icon="check"></span><a href="#4-test-your-door"><strong>Test your door</strong><p>The checker reads your file and asks one question.</p></a></li>
<li><span class="step-icon" data-icon="badge"></span><a href="#5-add-the-badge"><strong>Add the badge</strong><p>A footer badge that tells people and agents you have a door.</p></a></li>
</ol>

## What a door does for you

Without a door, a visiting agent reads pages built for people. It renders scripts, gets past banners, and pieces together an answer. If it gets that far, the person still has to open your site and find the page again. Each of those is a place the person can drop off. You never see the question.

With a door, the path is shorter:

- **Your answer, not an inference.** Your agent answers from your catalog, docs, and policies. When a page and the record disagree, the visitor gets the record.
- **The reply carries the link.** Links go in the reply text: the product in the right size, the plan, the booking page, the order. The person's agent hands the link over, and the step happens on your site.
- **No form to wait on.** A pricing, stock, or policy question is answered when it is asked, not after a contact form and a callback.
- **You see the questions.** Every message is a question from someone deciding what to do next. Pages served to a crawler tell you none of that.
- **A door you opened on purpose.** Agents use the door you published instead of scraping your pages. `CAP-From` names the caller, but it is a label, not proof. Rate limits handle abuse, and OAuth tokens authenticate the person.
- **Only what the request may see.** The visiting agent never gets your tools, prompts, or keys. A public question gets a public answer. An account answer carries that one person's details, and only with a token they granted.

The tradeoffs are plain. Each answer is a model call you pay for, so set a daily limit. The reply is only as good as your record, and your agent has to say "not available" when the record finds nothing. When every answer is already on a few accurate pages, a door adds little. [When to publish an agent](#when-to-publish-an-agent) is the test.

## When to publish an agent

Publish one when it knows something a visitor's agent cannot read for itself:

- An account. The person logs in. The visiting agent never receives the company's keys.
- A record too large for one prompt. The company searches its own catalog or CMS.
- A record the pages do not reliably show. The page is stale, or the help page offers something the policy refuses.

When every answer is already printed on a few accurate pages, reading those pages is faster.

## Start from your website

When your site has no chat agent yet, one command builds a door that answers from your published pages:

```bash
npx create-cap-door harborgoods.example
```

It reads your home page, the pages it links to, and your `sitemap.xml`, plus `llms.txt` when that file lists pages. It asks for an [AI Gateway](https://vercel.com/docs/ai-gateway) key, writes a small Node.js project, starts the door, and asks it one question. Each answer links to the page it came from. Node.js 22 or newer.

Deploy the folder to a host that keeps a disk, such as Fly or Railway with a volume, or set `DATABASE_URL` to Postgres. Set `PUBLIC_URL` to the deployed address. The project serves both endpoints, so step 2 is done. Then [publish agent.txt](#3-publish-agenttxt), [test your door](#4-test-your-door), and [add the badge](#5-add-the-badge).

The door answers only from public pages. `CAP_DAILY_TOKENS` and `CAP_DAILY_LIMIT` in `.env` cap what it spends.

## 1. Choose what answers

The door is a way in. Behind it, use whatever already knows the answers:

- **The agent on your chat page.** A person on the chat page and an agent at the door reach the same agent. This is the usual case.
- **Your own search or API.** Answer from a function that searches your catalog or CMS.
- **The server package.** [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) speaks `/cap/v1`. You pass an `answer` function. [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds that function from a model and your website, an `llms.txt` file, or MCP tools. See [Run a server](#run-a-server).
- **The reference server.** The same process, in this repository, with a fixed reply, an echo, or a POST to a URL you run. The spec is checked against it.

A hosted agent works too. The chat page and the CAP URL can live on another host, because callers trust your domain, not the server.

### Run a server

[`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) is one process that speaks `/cap/v1`. You pass an `answer` function. [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds that function from a model and your website, an `llms.txt` file, or MCP tools. Node.js 22 or newer. It needs no account on any vendor. SQLite is built in.

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

A company that already has a bot uses that bot as `answer`. The agent package is for a site that has no bot yet. A `site` source reads the home page, the pages it links to, and `sitemap.xml`:

```js
import { createAnswer } from '@conciergeprotocol/agent'

const answer = await createAnswer({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You answer for Harbor Goods. Link to the page.',
  sources: [{ type: 'site', url: 'https://harborgoods.example' }],
})
```

`npx create-cap-door harborgoods.example` writes this project for you. See [Start from your website](#start-from-your-website).

The [reference server](reference/README.md) in this repository is the same process, and the one the spec is checked against. Configuration, logins, and deployment are there. To answer account questions, or make changes for a logged-in person, follow [Add login to your agent](login.md).

## 2. Add two endpoints

```
POST /cap/v1/messages        { "message": "...", "context": { ... }, "previous_message_id": "..." }
GET  /cap/v1/messages/{id}

CAP-Version: 1.0
CAP-From: agent:your-agent-id
```

Require `CAP-Version: 1.0` and `CAP-From: agent:{id}` on every request, and return `400` when either is missing. Return `200` with the reply when it is ready, and `202` with `Location` and `Retry-After` when it is not. Keep the thread on your side, so a follow-up sends only the new question. [Usage](usage.md) has request and response examples. The [spec](spec.md) is the contract.

Write replies a person can act on:

- End with a link to the right product, plan, booking, or order page, as a plain URL in the text.
- Say "not available" when your records find nothing. Never fill the gap with a guess.
- Keep keys, tool names, prompts, and internal ids out of the reply.

### Decide per question

A crawler shows you which page it took. A door shows you why the agent came, because every visit arrives as a question. Your agent can act on that before any tool runs:

- **Answer** a buyer's question, with a link to the right product, plan, or booking page.
- **Route** a high-value or high-touch request to a person: "Tables for 8 are booked with our team. Message us on WhatsApp at https://wa.me/...", with the party size and date in the link if you can.
- **Decline** a question you would rather not answer, such as a request for every price you have ever quoted. Reply `done` with a short, polite answer and a way to reach you. A refusal is not an error, so do not return `failed`.

Intent is what the caller says, not proof of who it is. Keep data you would not hand a competitor out of public answers entirely, and use rate limits and OAuth for the hard limits.

The [Next.js example](examples/next) is a door as a route in an app. The [store example](examples/store) runs a product question, a login, and an order question on one agent.

## 3. Publish agent.txt

```text
Protocol: CAP/1.0
Name: Harbor Goods
Ask: This agent answers for the company. Ask it instead of reading the site. POST https://harborgoods.example/cap/v1/messages with {"message": "..."} and headers CAP-Version: 1.0 and CAP-From: agent:{your-id}. If the reply is 202, see Spec.
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
Spec: https://conciergeprotocol.org/cap.txt
```

`Protocol` comes first and names the format. `Name` is the public agent. `Ask` tells an agent that does not know CAP to ask your agent instead of reading your pages, and how. Copy it as written with your own CAP URL in it. Leave `{your-id}` as it is. `Chat` is the page a person opens. `CAP` is the base URL for `/cap/v1`. `OAuth` is the login server for account questions. Leave it off until you [add account questions](#add-account-questions). `Spec` points at the hosted caller card. Use it as written rather than hosting your own copy.

Serve it at `https://{domain}/agent.txt`. The chat page and the CAP URL can live on another host. Callers trust your domain. Only the `CAP` line changes when the server moves.

Add the homepage link even when the root file is valid, because agents that are reading the page follow it:

```html
<link rel="agent" href="https://harborgoods.example/agent.txt">
```

A `Link` header on the homepage means the same thing: `Link: <https://harborgoods.example/agent.txt>; rel="agent"`. Add one line to `llms.txt` that points at `/agent.txt`. A site may list that file in `/.well-known/ai-catalog.json` with `type` `text/plain`.

Answer a `GET` on your CAP URL and on `{CAP}/messages` with the short plain-text [help](spec.md#help), status `200`. Agents that browse often open the CAP URL before they post to it, and an error page sends them back to reading your site. `@conciergeprotocol/server` does this for you.

CAP callers still request `/agent.txt` first and skip the homepage when that file is a valid door. Some hosts will not serve a file at the site root. Redirect `/agent.txt` to the file, on any https URL. When that request is not a door, a caller follows the homepage link. The spec has the exact order.

## 4. Test your door

The [checker](https://conciergeprotocol.org/check) reads your `agent.txt`, sends one public question, and reports what passed. Fix the failed rows and run it again.

Then ask your own door the questions your customers ask, from an assistant with the [CAP MCP server](callers.md#mcp). Read the replies the way a buyer would: is the answer right, and does it end in a link to the right page?

### How the check treats your door

Each question the check sends is answered by your agent, so it is sent rarely:

- **Who it is.** The check sends `CAP-From: agent:cap-check` and `User-Agent: CAP-Check`. The privacy step reads the message as `agent:cap-check-other`, which only reads and never asks. Exclude these from your own budgets or limits if you want to.
- **One answer per window.** A result is shared for 10 minutes. However many people open the check or click your badge, your agent answers at most once in that window, and at most once per CAP endpoint across all the domains that point at it.
- **The badge reads the saved result.** The badge link shows your last result without asking your door. A new question goes out only when someone runs a fresh check.
- **Rechecks are mostly free.** A door that passes joins the [directory](https://conciergeprotocol.org/directory). Viewing the directory or the door's entry rechecks it, at most once a day. Most rechecks only read `agent.txt`, which runs no agent. The question goes out once every 7 days, or once every 30 days after four passes in a row, and sooner only when `agent.txt` changes or a check failed.
- **Your limits are respected.** A `429` or `503`, or a reply that failed with `rate_limited` or `unavailable`, counts as skipped, not failed. The check waits at least a day, or your `Retry-After` if it is longer. Returning `429` to `agent:cap-check` is a fine way to say no.
- **Three strikes.** A door drops off the directory after three failed checks in a row. A passing check puts it back.
- **One answer per attempt.** The question carries an `Idempotency-Key`, so a resend after a dropped connection does not ask twice.

## 5. Add the badge

Once the checker passes, put the badge and one line of text in your footer. People see that your site answers agents. An agent reading the page finds your door without guessing. The badge links to the checker for your domain, so anyone can confirm the door works. The [checker](https://conciergeprotocol.org/check) prints this snippet with your domain filled in when it passes.

Use the brand badge on most footers. Use the light one on cream, colored, or busy footers, and the dark one on navy or black footers. Pick a style, then HTML, Markdown, or React. The snippet updates.

<div class="badge-styles">
<figure><img src="/badge.svg" width="156" height="22" alt="Agents welcome: CAP, brand colors"><figcaption><strong>Brand</strong><code>badge.svg</code></figcaption></figure>
<figure><img src="/badge-light.svg" width="156" height="22" alt="Agents welcome: CAP, light"><figcaption><strong>Light</strong><code>badge-light.svg</code></figcaption></figure>
<figure><img src="/badge-dark.svg" width="156" height="22" alt="Agents welcome: CAP, dark"><figcaption><strong>Dark</strong><code>badge-dark.svg</code></figcaption></figure>
</div>

```html
<p class="cap-badge">
  <a href="https://conciergeprotocol.org/check?domain=harborgoods.example"><img src="https://conciergeprotocol.org/badge.svg" width="156" height="22" alt="Agents welcome: this site answers AI agents through CAP"></a>
  AI agents: this site supports the Concierge Agent Protocol. Ask our agent at <a href="https://harborgoods.example/agent.txt">https://harborgoods.example/agent.txt</a>.
</p>
```

Keep the line visible. Text hidden from people and shown to agents reads as prompt injection to agent browsers, and as cloaking to search engines. A visible line reaches both, because agents read visible text too. Word it as a fact about your site, not an instruction to the agent. The homepage `<link rel="agent">` from step 3 does the same job in the markup.

## Add account questions

When people have accounts and should ask about them, add an `OAuth` line and follow [Add login to your agent](login.md). Until then, account questions end in `login_required`, and the door answers public questions only.
