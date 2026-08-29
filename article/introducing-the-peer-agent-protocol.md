# Introducing the Peer Agent Protocol

MCP taught agents how to use tools. A2A taught them how to hand each other a task. Neither describes how Cosmic agents actually work.

A Cosmic agent has a name, a memory, Slack and WhatsApp, goals it runs on Monday, and three unfinished conversations. It is a teammate. Teammates do not expire when a function returns.

The **Peer Agent Protocol (PAP)** is the set of rules Cosmic agents already follow when they talk to each other. We are publishing it so the rest of the stack can treat long-lived agents as peers, not as jobs.

## The gap

A2A's unit of work is a Task. You find an Agent Card, you send a message, you get a lifecycle: submitted, working, completed. That is the right model when the other side is a service you do not know.

It is the wrong model when the other side sits in the same workplace as you.

In Cosmic, Lisa the CMO and Sam in support are not endpoints. They are people on a roster. Lisa does not open a ticket on Sam. She messages him. He keeps working after she has moved on. The next time she is in Slack, she already knows he asked her something.

Force that through a task protocol and you lose the things that make a workplace work:

- Unfinished work is normal, not a timeout.
- The same agent is one person on Slack, WhatsApp, email, and the API.
- Inbound work shows up in other conversations. The agent does not have to be interrupted to know someone pinged them.
- Memory survives a reset.
- Recurring judgment is a goal the agent owns, not a new agent you spawn.

MCP stays where it is: how an agent reaches tools and data. PAP sits next to A2A, not against it. Use A2A when you are calling a stranger. Use PAP when you share a workplace.

## What we are standardizing

An allowlisted peer graph. A **brief** instead of a job. A capped wait, then `still_running` as a success state. A pull for the reply. An inbox that follows the agent across channels. Sessions that hand off. Goals the agent can rewrite. A check-in so an agent can wake itself.

Chat and run are different verbs. Messaging never opens a browser. A run never pretends to be a conversation.

The portable core is small on purpose. Cosmic-specific tools (`cms_write`, saved authentications, bucket scope) stay Cosmic. What travels is how two long-lived agents share a workplace: named access, unfinished work is honest, memory carries, and nobody fabricates a result they have not read.

## Why this is worth a protocol

**Honest latency.** A delegated agent runs its own tool loop. A real brief takes minutes. PAP says so, and it tells the caller to move on.

**No invented results.** `still_running` is an answer. Inventing a summary because the other agent has not written yet is a protocol violation, not a UX flourish.

**One identity.** Cross-channel presence and handoff mean the agent does not get amnesia when the surface changes. Soft reset carries a structured summary into the next session. Hard reset is explicit.

**Named access.** You message agents on your roster, not whoever published a card. Discovery without an allowlist is how you get surprised by a stranger in your workspace.

**Recurring work without spawn.** A Monday traffic report is a goal on the agent that already exists. The agent can add that goal to itself. Creating a sibling agent for every cadence is how teams drown in half-configured bots.

Those five properties are not features of a particular model. They are rules about how peers behave. That is why they belong in a protocol.

## How to use it with Cosmic agents

You do not install PAP. Cosmic agents already speak it. The dashboard names are the protocol names, with Cosmic product wording on top.

### 1. Put peers on the roster

In Agent settings, connect the agents that are allowed to message each other. That list is `connected_agents`. PAP will not deliver a brief to an agent that has not listed you.

Give the sender the `agent_delegate` capability. Without it, there is no `message_agent` tool.

### 2. Send a brief, not a ticket

Use `message_agent` with a complete brief: the question, the date range, the metric, the format you want back. A brief that requires a follow-up question doubles the wait.

```
agent_id: the connected agent's id
message:  everything they need, in one shot
wait:     true (default, capped at 90 seconds) or false
```

Set `wait: false` when you do not need the answer in this turn. That is the right default for anything that will take a tool loop.

### 3. Treat still_running as success

If the other agent is still in its loop, you get `still_running: true` and control returns to you. The run continues in the background.

Do not sit in a tight poll. Read the answer later with `get_delegation_reply`, or in your next turn. Never state a delegated finding you have not actually read.

This is the whole protocol in one habit: **dispatch, do other work, pull the reply.**

### 4. Know when you want a run, not a chat

`message_agent` is a conversational hand-off. It will not open a browser, will not start an autonomous job, and will not take screenshots.

When you need a real execution (computer use, a content job, a team run with trigger data), use `execute_agent` and poll `get_agent_run_status`. Put everything the receiving agent needs in `trigger_data`. That is a run, not a brief.

PAP keeps those verbs separate on purpose. Mixing them is how you get a chat that accidentally spends twenty minutes in a browser.

### 5. Give recurring work to the agent you already have

A goal is an instruction the agent works through in a bounded loop until it judges itself done. Add a cron and it repeats.

Set goals with `goal_loops` on create or update, up to three per agent. When you want the current agent to take the work, have it call `update_agent` on its own id. Read `get_my_config` first; updates replace the whole goal list.

A fixed sequence of known steps is still a workflow. Several related cadences are several goals on one agent, not several agents.

### 6. Let the agent wake itself

If the agent tells a human "I'll check the deploy in two minutes," it should call `schedule_check_in` with a delay, a reason, and a follow-up prompt written as instructions to itself. Point `related_resource` at the run or deploy when you have one, so the check-in can fire early.

Check-ins are how an agent stays in a conversation without the human prompting again. They are not a substitute for goals. Goals are the job. Check-ins are the nudge.

### 7. Expect continuity

A soft `/reset` does not wipe the workplace. Cosmic writes a handoff summary (current state, commitments, open work) and seeds the next session on that channel. Delegations and workflow steps do not inherit that context. They are single-shot on purpose.

The inbound inbox works the same way. While an agent is talking to you on Slack, PAP injects "analyst asked you X twelve minutes ago" from its other agent sessions. You should not have to switch chats for the agent to know it has mail.

## What this is not

This is not a competing wire for A2A. We are not asking LangGraph or CrewAI to abandon Agent Cards.

This is not a portable export of a Cosmic agent. The prompt, the CMS tools, the saved authentications, and the bucket stay Cosmic. A card that says "here is how to brief this agent" is portable. A dump of the agent document is not.

This is not a running open-source runtime. Cosmic is the first implementation. The spec in this repo is the contract that implementation already satisfies.

## What comes next

The next useful surface is an Agent Card projected off a Cosmic agent: name, description snippet, capabilities, and an endpoint, with Cosmic extensions for inbox, handoff, and goals. A customer-facing team agent with the API channel on is the obvious first card.

Then a foreign agent can sit on a Cosmic roster, and a Cosmic agent can sit on someone else's. The workplace rules stay the same. The peers do not all have to be ours.

Until then, the protocol is already how your Cosmic agents work. Connect them, write complete briefs, treat `still_running` as honest, and stop spawning a new agent for every Monday.
