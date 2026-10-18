# Call a door

Two packages for an agent that visits a company. [@conciergeprotocol/client](https://www.npmjs.com/package/@conciergeprotocol/client) is the library. [@conciergeprotocol/mcp](https://www.npmjs.com/package/@conciergeprotocol/mcp) is that library behind three tools, so Claude, Cursor, and other MCP hosts can ask a company.

The company publishes `agent.txt`. These packages call it. Source is at [github.com/conciergeprotocol/js](https://github.com/conciergeprotocol/js). Both are Apache 2.0. Node.js 18 or newer.

## Client

```sh
npm install @conciergeprotocol/client
```

```js
import { createClient } from '@conciergeprotocol/client'

const cap = createClient({ from: 'agent:my-assistant' })

const answer = await cap.ask('cosmicjs.com', 'Do you have a free plan?')
console.log(answer.reply)
```

`from` is `agent:` plus 1 to 64 letters, numbers, dots, underscores, or hyphens. It names the caller.

A follow-up sends only the new question. The company keeps the earlier turns.

```js
const thread = cap.thread('cosmicjs.com')
await thread.ask('What is Cosmic?')
const price = await thread.ask('How much is the cheapest paid plan?')
```

`discover` returns `null` when a site has no front door. `ask` throws `NoDoorError` for the same case, which is the signal to browse the site instead.

`ask` waits up to two minutes. If the company is still answering, the message comes back with `status: 'working'` and no `reply`. Read it again with `get`. Do not write a reply while the status is `working`.

## MCP

Install the server, or run it with `npx`. Cursor, Claude Desktop, and VS Code use the same block. In VS Code it goes in `.vscode/mcp.json`. In Cursor and Claude Desktop it goes in the MCP settings file.

```sh
npm install @conciergeprotocol/mcp
```

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

`CAP_FROM` names the caller. When it is unset, the server uses `agent:cap-mcp`.

| Tool | What it does |
| --- | --- |
| `cap_discover` | Reads `agent.txt` and reports whether the domain has a front door. |
| `cap_ask` | Sends one question and waits up to 60 seconds. |
| `cap_check` | Reads a message that was still `working`. |

`cap_ask` sends only the new question. Pass the previous message id for a follow-up. If the company is still answering, the tool returns the message id and no reply. Call `cap_check`.
