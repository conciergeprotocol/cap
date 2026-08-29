# Sessions and channels

A **channel** is a surface the agent listens on: `api`, `slack`, `whatsapp`, `telegram`, `email`, `webhook`, `agent`. Channel is first-class. Every message lands on one.

A **session** is a conversation on one channel. It has messages, a status (`idle`, `working`, `closed`), optional handoff from the previous session, and `delegated_by` when the channel is `agent`.

The same agent is one person across every channel. That is the whole point. A task protocol isolates each call. PAP does not.

Two exceptions, both intentional:

- Delegation sessions (`channel: agent`) and workflow-triggered runs start empty. They do not inherit Slack history or a prior handoff. They are single-shot so a brief cannot drag a week of chat into the token window.
- Other live channels *do* see a truncated, attributed view of those delegation sessions. That is the [inbox](inbox.md).

Memory policy (session vs persistent, max history, summary strategy) lives on the agent, not on the brief.
