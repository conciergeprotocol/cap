# Publish a door

This guide is for the company. People already send their agents to your website to compare, shop, book, and check on accounts. A door lets those agents ask your agent and get your answer, with a link to the next step on your site. Your tools, keys, and records stay with you.

<ol class="steps">
<li><span class="n">1</span><strong>Pick what answers</strong><p>The agent on your chat page, your search, or the reference server</p></li>
<li><span class="n">2</span><strong>Serve the endpoints</strong><p><code>POST /cap/v1/messages</code> and <code>GET /cap/v1/messages/{id}</code></p></li>
<li><span class="n">3</span><strong>Publish agent.txt</strong><p>One file at the site root, and a link from the homepage</p></li>
<li><span class="n">4</span><strong>Check it</strong><p>The checker reads the file and asks one public question</p></li>
</ol>

## What a door does for you

Without a door, a visiting agent reads pages built for people. It renders scripts, gets past banners, and pieces together an answer. If it gets that far, the person still has to open your site, find the page again, and take the next step. Each of those is a place the person can drop off. You never see the question.

With a door, the path is shorter:

- **Your answer, not an inference.** Your agent answers from your catalog, docs, and policies. When a page and the record disagree, the visitor gets the record.
- **The reply carries the next step.** Links go in the reply text: the product in the right size, the plan, the booking page, the order. The person's agent hands the link over, and the step happens on your site.
- **No form to wait on.** A pricing, stock, or policy question is answered when it is asked, not after a contact form and a callback.
- **You see the questions.** Every message is a question from someone deciding what to do next. Pages served to a crawler tell you none of that.
- **The caller is invited.** `CAP-From` names the agent. You set limits on a caller you can see, instead of blocking a scraper you can't.
- **Only the answer leaves.** The visiting agent never gets your tools, prompts, keys, or another customer's data. Account questions need a token the person grants.

The tradeoffs are plain. Each answer is a model call you pay for, so set a daily limit. The reply is only as good as your record, and your agent has to say "not available" when the record finds nothing. When every answer is already on a few accurate pages, a door adds little. [When to publish an agent](README.md#when-to-publish-an-agent) has the full test.

## 1. Pick what answers

The door is a way in. Behind it, use whatever already knows the answers:

- **The agent on your chat page.** A person on the chat page and an agent at the door reach the same agent. This is the usual case.
- **Your own search or API.** Answer from a function that searches your catalog or CMS.
- **The reference server.** One process that speaks `/cap/v1`, with a fixed reply, an echo, or a POST to a URL you run. See [Run a server](README.md#run-a-server).

A hosted agent works too. The chat page and the CAP URL can live on another host, because callers trust your domain, not the server.

## 2. Serve the endpoints

```
POST /cap/v1/messages        { "message": "...", "context": { ... }, "previous_message_id": "..." }
GET  /cap/v1/messages/{id}
```

Return `200` with the reply when it is ready, and `202` with `Location` and `Retry-After` when it is not. Keep the thread on your side, so a follow-up sends only the new question. [Usage](usage.md) has request and response examples. The [spec](spec.md) is the contract.

Write replies a person can act on:

- End with the link to the next step, as a plain URL in the text.
- Say "not available" when your records find nothing. Never fill the gap with a guess.
- Keep keys, tool names, prompts, and internal ids out of the reply.

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

Add one line to `llms.txt` that points at `/agent.txt`. If your host cannot serve a file at the root, redirect `/agent.txt` to the file. [agent.txt](README.md#agenttxt) explains each line.

## 4. Check it

The [checker](https://conciergeprotocol.org/check) reads your `agent.txt`, sends one public question, and reports what passed. Fix the failed rows and run it again.

Then ask your own door the questions your customers ask, from an assistant with the [CAP MCP server](callers.md#mcp). Read the replies the way a buyer would: is the answer right, and does it end in a link to the next step?

## Add account questions

When people have accounts and should ask about them, add an `OAuth` line and follow [Add login to your agent](login.md). Until then, account questions end in `login_required`, and the door answers public questions only.
