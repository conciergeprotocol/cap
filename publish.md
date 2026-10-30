# Publish a door

This guide is for the company. People already send their agents to your website to compare, shop, book, and check on accounts. A door lets those agents ask your agent and get your answer, with a link to the product, plan, or booking page on your site. Your tools, keys, and records stay with you.

<ol class="steps">
<li><span class="n">1</span><strong>Pick what answers</strong><p>The agent on your chat page, your search, or the server package</p></li>
<li><span class="n">2</span><strong>Serve the endpoints</strong><p><code>POST /cap/v1/messages</code> and <code>GET /cap/v1/messages/{id}</code></p></li>
<li><span class="n">3</span><strong>Publish agent.txt</strong><p>One file at the site root, and a link from the homepage</p></li>
<li><span class="n">4</span><strong>Check it</strong><p>The checker reads the file and asks one public question</p></li>
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

The tradeoffs are plain. Each answer is a model call you pay for, so set a daily limit. The reply is only as good as your record, and your agent has to say "not available" when the record finds nothing. When every answer is already on a few accurate pages, a door adds little. [When to publish an agent](home.md#when-to-publish-an-agent) has the full test.

## 1. Pick what answers

The door is a way in. Behind it, use whatever already knows the answers:

- **The agent on your chat page.** A person on the chat page and an agent at the door reach the same agent. This is the usual case.
- **Your own search or API.** Answer from a function that searches your catalog or CMS.
- **The server package.** [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) speaks `/cap/v1`. You pass an `answer` function. [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) builds that function from a model, an `llms.txt` file, and MCP tools. See [Run a server](home.md#run-a-server).
- **The reference server.** The same process, in this repository, with a fixed reply, an echo, or a POST to a URL you run. The spec is checked against it.

A hosted agent works too. The chat page and the CAP URL can live on another host, because callers trust your domain, not the server.

## 2. Serve the endpoints

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
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
Spec: https://conciergeprotocol.org/cap.txt
```

Serve it at `https://{domain}/agent.txt`. Add the homepage link even when the root file is valid, because agents that are reading the page follow it:

```html
<link rel="agent" href="https://harborgoods.example/agent.txt">
```

Add one line to `llms.txt` that points at `/agent.txt`. If your host cannot serve a file at the root, redirect `/agent.txt` to the file. [agent.txt](home.md#agenttxt) explains each line.

## 4. Check it

The [checker](https://conciergeprotocol.org/check) reads your `agent.txt`, sends one public question, and reports what passed. Fix the failed rows and run it again.

Then ask your own door the questions your customers ask, from an assistant with the [CAP MCP server](callers.md#mcp). Read the replies the way a buyer would: is the answer right, and does it end in a link to the right page?

## Add account questions

When people have accounts and should ask about them, add an `OAuth` line and follow [Add login to your agent](login.md). Until then, account questions end in `login_required`, and the door answers public questions only.
