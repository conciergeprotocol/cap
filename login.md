# Add login to your agent

Your agent already answers public questions. This guide adds the rest: a person logs in, their agent asks about their own account, and, if you allow it, your agent makes changes for them. Actions that are hard to undo wait for the person's OK on your page.

If your company already has user accounts, plan on an afternoon with [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server), and a day or two to put your own sign-in in front of it. Most of the work is one function that checks a login and one that answers with an account. The [reference server](reference/README.md) in this repository is that same server.

The visiting agent never gets your keys, your tools, or the person's password. It gets a token for one account, bound to its own `CAP-From`, and the replies your agent writes.

<ol class="steps">
<li><span class="n">1</span><strong>Find the door</strong><p>The visiting agent reads <code>agent.txt</code></p></li>
<li><span class="n">2</span><strong>Ask</strong><p>It sends one message. Your agent answers from your own content.</p></li>
<li><span class="n">3</span><strong>Log in</strong><p>An account question comes back as <code>login_required</code>, and the person approves on your page.</p></li>
<li><span class="n">4</span><strong>Ask again</strong><p>The same agent sends its token. It can read that account, and change it only if the person allowed changes.</p></li>
</ol>

See it running: the [store example](examples/store) is a shop you click through, from a product question to a login to a cancel that waits for your OK. The [Next.js example](examples/next) is the same door as a route in an app, without the login pages. The [reference server](reference/README.md) is the login itself.

## What you build

| Piece | What it does | Required |
| --- | --- | --- |
| `OAuth` line in `agent.txt` | Tells visiting agents where to log in | Yes |
| OAuth metadata | Lists your login endpoints at `/.well-known/oauth-authorization-server/...` | Yes |
| Code login | The agent shows the person a short code. They enter it on your page and allow access | Yes |
| Token and revoke endpoints | Issue, renew, and end logins | Yes |
| Redirect login | For agents that can open a browser and take a callback | Optional |
| Write scope | Lets the person allow changes, not only reads | Optional |
| Confirmations | Holds a risky action until the person approves it on your page | With write |

The [reference server](reference/README.md) implements every row. The [store example](examples/store) uses all of them in about 150 lines.

## The fast path

[`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server) serves the login with the door. Node.js 22 or newer. `login` returns your account id, or `null`.

```js
import { createCapServer } from '@conciergeprotocol/server'

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer,
  login: async ({ username, password }) => {
    const user = await users.verify(username, password)
    return user ? user.id : null
  },
})
await cap.listen(8088)
```

The sections below run the same server from this repository, which is the one the spec is checked against. `accounts` in `cap.json` is for a first test only.

### 1. Turn on logins

Add an `oauth` block to `cap.json`. `accounts` is for a first test only.

```json
{
  "agent": { "name": "Harbor Goods", "status": "active", "chat": "https://harborgoods.example/chat" },
  "oauth": {
    "accounts": [{ "account": "maya", "password_env": "MAYA_PASSWORD" }]
  }
}
```

```bash
cd reference
MAYA_PASSWORD=demo node start.mjs
```

`agent.txt` now has an `OAuth` line, and the server answers the metadata, the code login, the redirect login, the token endpoint, and revocation.

### 2. Check logins against your users

Start the server from your own code with `boot`. `login` receives what the person typed on the login page and returns your account id, or `null`.

```js
import { boot } from './reference/start.mjs'

const app = await boot({
  config: {
    agent: { name: 'Harbor Goods', status: 'active', chat: 'https://harborgoods.example/chat' },
    oauth: {},
  },
  async login({ username, password }) {
    const user = await users.verify(username, password)
    return user ? user.id : null
  },
  answer,
})
app.server.listen(8088)
```

### 3. Answer with the account

`answer` runs for every message. `account` is the id `login` returned, or `null` without a token. Account questions without one return `login_required`, and the visiting agent asks the person to log in.

```js
async function answer({ message, context, history, account, scope }) {
  if (/\border\b/i.test(message)) {
    if (!account) return { error: { code: 'login_required', message: 'Log in to Harbor Goods to ask about your order.' } }
    return { reply: await orders.statusFor(account) }
  }
  return { reply: await catalog.search(message, context) }
}
```

Look the account up from `account` only. A name or an order number in `context` is not a login.

If your answers live in another service, use the `http` handler instead of code. The server posts `{ message, context, history, account, scope }` to your URL and expects `{ "reply": "..." }`. See the [reference server](reference/README.md#configure).

### 4. Deploy

Run it behind https, and set `PUBLIC_URL` to its public origin. Keep `allow_http_clients` off. Put the `OAuth` line in the `agent.txt` your company domain serves:

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://cap.harborgoods.example/cap/v1
OAuth: https://cap.harborgoods.example/oauth
```

From `reference/`, `node check.mjs` runs the conformance checks.

## Allow changes

Set `"write": true` in the `oauth` block. Your metadata then lists `scopes_supported: ["read", "write"]`.

- A visiting agent that needs changes asks for `scope=write`. Your page tells the person, and offers **Allow changes**, **Allow read only**, or **Deny**.
- The token response says what the person granted: `read`, or `read write`. It is never more than the agent asked for, and a renewed token keeps it.
- Write tokens last 15 minutes. Set `write_access_token_seconds` to change that.

`answer` receives `scope`. Check it in code before any change. A rule in a prompt is not enough.

```js
if (/\bgift ?wrap\b/i.test(message)) {
  if (!account) return loginRequired
  if (scope !== 'write') return { error: { code: 'write_required', message: 'This login can read your order but not change it. Log in again and allow changes.' } }
  await orders.addGiftWrap(account)
  return { reply: 'Gift wrap added, at no charge.' }
}
```

Write access covers what the person could do themselves, and no more. Run each change as that person, with their own permissions.

## Confirm actions that are hard to undo

A cancel, a delete, a payment, or anything else that is hard to take back should not run on a token alone. Return `confirm` instead of doing it:

```js
if (/\bcancel\b/i.test(message)) {
  if (!account) return loginRequired
  const order = await orders.openOrderFor(account)
  return {
    confirm: {
      summary: `Cancel order ${order.id} (${order.item}, $${order.price}).`,
      authorization_details: [{ type: 'cancel_order', order: order.id }],
    },
  }
}
```

Then pass `act` to `boot`. It runs only after the person approves, once, with the account that approved:

```js
async act({ account, authorization_details }) {
  const [action] = authorization_details
  if (action.type !== 'cancel_order') return { error: { message: 'Unknown action.' } }
  await orders.cancel(account, action.order)
  return { message: `Order ${action.order} is cancelled. The refund goes back to your card in 3 to 5 days.` }
}
```

What happens:

1. The message is `done`. Its `reply` and `confirmation` give the person the summary and a link to your confirm page. The action has not run.
2. The person opens the link, logs in, and approves or denies. Only the account the request is for can approve it.
3. On approval, `act` runs once. The visiting agent reads `GET /cap/v1/confirmations/{id}` and tells the person the result.
4. A request no one decides expires after 10 minutes.

Write `summary` from your own records, not from the visiting agent's words, so the person approves what will actually happen. `authorization_details` is your own description of the action, in the style of [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396). It is stored as data, so an approval survives a restart.

A `read` login cannot ask for a confirmed action at all. The server answers `write_required`.

With the `http` handler, your hook returns `{ "reply": "...", "confirm": { ... } }`, and after approval it receives `{ "confirmed": { "account", "authorization_details", "caller" } }` and returns `{ "message": "..." }`.

## Use your own sign-in

The reference login pages ask for a username and password. If your users sign in with SSO, a social login, passkeys, or two-factor, put your own pages in front instead. Visiting agents never see the difference, as long as the endpoints behave the same.

**Keep exactly as the spec says:**

- The metadata, `device_authorization_endpoint`, `token_endpoint`, and `revocation_endpoint`, with OAuth's own errors (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`, `invalid_scope`).
- Each token bound to the `CAP-From` that started the login. Another agent using it gets `403`.
- Refresh tokens that rotate, and revocation that ends the whole login.
- The `scope` rules above, and the confirmation statuses.

**Replace with your own pages:**

- **The code page.** The person opens your `verification_uri`, signs in your usual way, sees the agent's name and what it asked for, and allows or denies. Record the decision against that code: the account, and the scope they granted.
- **The confirm page.** The person signs in your usual way, sees the summary, and approves or denies. Check that they are the account the request is for. Claim the request from `pending` in one atomic update, so it can only run once.
- **The redirect login's consent page**, if you offer it.

If your site already has a signed-in session, these pages can be ordinary pages in your app. The person is usually signed in already, so approving takes one click.

The [reference `oauth.mjs`](reference/oauth.mjs) is a working map of every state: pending and decided codes, one-time code exchange, token rotation, and the confirm claim. Copy its data model even if you replace its pages.

## Before you launch

- Serve every endpoint over https. Accept client documents only on https URLs at public hosts.
- Fetch client documents behind egress rules, so a client id URL cannot reach your private network.
- Store tokens as hashes. The reference server does.
- Check scope and account in code, on every change.
- Confirm every action that is hard to undo. Show a summary from your own records.
- Keep write logins short. Consider ending them days after approval, not weeks.
- Let people see the agents they have logged in, and end any of them.
- Rate limit the login, token, and confirm endpoints.
- Run one process for the redirect login, or pin each login to one process. Its pending requests live in memory.

## Try it

The [store example](examples/store) runs every step on your machine: a public product search, an order lookup after login, gift wrap with a write login, and a cancel that waits for your OK.

```bash
cd examples/store
node start.mjs
```

Open `http://127.0.0.1:8810`, click **Log in to make changes**, and try **Cancel my order**.
