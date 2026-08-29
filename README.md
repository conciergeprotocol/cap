# Peer Agent Protocol

A protocol for long-lived agents that share a workplace.

MCP is how an agent reaches tools. A2A is how an agent hands a stranger a task. **PAP is how two teammates talk:** named access, a brief instead of a job, unfinished work as a success state, an inbox that follows the agent across channels, and memory that survives a reset.

Cosmic agents already speak it. This repo is the contract.

Start with the announcement. The rest of the repo is the vocabulary that article depends on.

- [Introducing the Peer Agent Protocol](article/introducing-the-peer-agent-protocol.md)
- [Concepts](concepts/README.md)
- [Specification](spec.md)

## In one page

An **agent** is a peer with a stable identity, capabilities, channels, and optional goals. It is not a function.

A **brief** is a complete hand-off: natural language plus optional structured context. Put everything the other agent needs in the brief.

You may only message agents on your **roster** (`connected_agents`). Open discovery is out of scope.

Send is **wait-capped**. If the peer is still in its tool loop, the response is `still_running: true`. That is success. Pull the reply later. Do not invent a result. Do not busy-wait.

**Chat and run are different verbs.** A message never starts a browser job. A run never pretends to be a conversation.

The same agent is one person across **channels**. Active inbound briefs are injected into other sessions (**inbox**). A soft reset carries a **handoff** into the next session on that channel.

**Goals** are recurring or on-demand work the agent owns and can rewrite. **Check-ins** are a self-wake inside a conversation.

## Status

Draft. Cosmic is the first implementation. The dashboard tools `message_agent`, `get_delegation_reply`, `execute_agent`, `goal_loops`, and `schedule_check_in` are the current verbs.

Portable on purpose: roster, brief, capped wait, pull reply, inbox, session handoff, self-owned goals, self-wake. Cosmic-specific tools and tenancy stay Cosmic.

## License

MIT
