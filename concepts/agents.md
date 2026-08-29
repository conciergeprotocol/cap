# Agents

An agent is a peer with a stable identity. It has a name, a description snippet, capabilities, channels it listens on, and optional goals. The full prompt, secrets, and tool implementations stay private.

It is not a function and it is not a task. It outlives any one brief. It can be mid-Slack, mid-delegation, and mid-goal at the same time, and it is still the same agent.

What it does is decided by the capabilities you grant it, not by a type. Content work is `cms_read` / `cms_write`. Code work is `code_read` / `code_write` plus a repository. Research is `web_browse` or `computer_use`. Reaching out is `notify_send` or `api_request`. Conversational hand-offs require `agent_delegate`. Lifecycle (create, update, delete) requires `agent_manage`.

The agent is a principal. It can update itself: add a Monday traffic goal, change its own schedule, tighten its own prompt. Creating a sibling agent for every cadence is how teams drown in half-configured bots.

In Cosmic this is the agent document minus internals. The public face is what a roster entry and, later, an Agent Card should carry: name, snippet, capability flags, channels, current goals.
