# Specification (draft)

This is the contract Cosmic agents already satisfy. It is not a published wire with SDKs. Field names use the protocol vocabulary; Cosmic product names are noted in parentheses.

## Objects

### Agent

Public face of a peer. Internals (full prompt, secrets, tool implementations) are not part of the object.

| Field | Notes |
| --- | --- |
| `id` | Stable |
| `name` | Display name |
| `description` | Snippet, not the system prompt |
| `capabilities` | Permission flags. Open vocabulary |
| `channels` | Surfaces the agent listens on |
| `goals` | Current goal list |
| `roster` | Peers this agent will accept mail from (`connected_agents`) |

### Capability

A string permission. Cosmic's current vocabulary includes `cms_read`, `cms_write`, `agent_delegate`, `agent_manage`, `workflow_execute`, `computer_use`, `api_request`, `notify_send`, `web_browse`, `code_read`, `code_write`, `insights_read`. Foreign runtimes publish their own.

### RosterEntry

`agent_id`, `name`, `description`, optional `capabilities`. Enough to brief, not enough to reconstruct.

### Channel

`api` | `slack` | `whatsapp` | `telegram` | `email` | `webhook` | `agent`

### Session

A conversation on one channel.

| Field | Notes |
| --- | --- |
| `id` | Stable |
| `agent_id` | Owner |
| `channel` | Required |
| `status` | `idle` \| `working` \| `closed` |
| `messages` | Visible turns. Internal tool traces are not protocol |
| `delegated_by` | Set when `channel` is `agent` |
| `handoff` | Summary carried from the previous session on this channel |

### Brief

| Field | Notes |
| --- | --- |
| `from` | Sending agent id |
| `to` | Target agent id |
| `text` | Complete natural-language hand-off |
| `context` | Optional structured payload (`trigger_data` on runs) |
| `wait` | Default true. Runtime caps the wait |

### Goal

`id`, `name`, `prompt`, `max_steps`, optional `max_runs_per_day`, optional `schedule.cron` + `timezone`, `enabled`. Without a cron it is on-demand. The agent judges done.

### CheckIn

`delay_seconds`, `reason`, `follow_up_prompt`, optional `related_resource`. Lives on a session, not on the agent.

### Run

A real execution, not a chat. Returns a run id. Polled separately. May carry `context` as trigger data.

## Operations

```
POST   /agents/{id}/messages          # send a Brief
GET    /agents/{id}/messages/latest   # pull the reply
GET    /agents/{id}/inbox             # inbound briefs on this agent
GET    /agents/{id}/presence          # working | idle, across channels

POST   /agents/{id}/runs              # execute, not chat
GET    /runs/{id}

GET    /agents/{id}                   # public face
PATCH  /agents/{id}                   # self-update, including goals
GET    /agents/{id}/goals
PUT    /agents/{id}/goals

POST   /sessions/{id}/check-ins
DELETE /sessions/{id}/check-ins/{id}
POST   /sessions/{id}/handoff         # soft reset
```

Cosmic today: `POST /agents/{id}/messages` is `message_agent`, the pull is `get_delegation_reply`, runs are `execute_agent` / `get_agent_run_status`.

## Send semantics

Default wait is capped (90 seconds in Cosmic). After the cap, or when `wait` is false:

```json
{
  "status": "accepted",
  "still_running": true,
  "session_id": "sess_01",
  "note": "Working. Pull later. Do not invent a result."
}
```

`still_running` is a success state. A conforming caller MUST NOT treat it as a result, MUST NOT busy-wait, and MUST NOT invent a summary.

When the peer has written:

```json
{
  "status": "ok",
  "still_running": false,
  "session_id": "sess_01",
  "reply": "Draft changelog in markdown..."
}
```

A later pull may still return `still_running: true` with a partial `reply`. Partial replies may be superseded.

## Invariants

1. **Allowlist.** A brief to an agent that has not listed the sender on its roster MUST fail. No project-wide fallback.
2. **Async by default.** Tight re-poll loops are a protocol violation. Recommend `max_outstanding_briefs` of 2 per turn.
3. **Ambient inbox.** A conforming runtime MUST surface active inbound briefs into the agent's other non-ephemeral sessions, attributed and truncated. It MUST NOT inject that inbox into the delegation session itself.
4. **Chat is not a run.** `messages` MUST NOT start computer use, an autonomous job, or a workflow. `runs` MUST NOT be presented as a conversational reply.
5. **Continuity survives soft reset.** Soft reset produces a handoff and seeds the next session on that channel. Hard reset carries nothing. Ephemeral sessions (delegations, workflow steps) inherit neither handoff nor cross-channel history.
6. **Depth is bounded.** Chained runs stop at a small cap (3 in Cosmic). Briefs should be similarly capped.
7. **The agent is a principal.** Self-`PATCH` is allowed for an agent acting on its own id. Creating other agents is a separate, capability-gated operation, scoped to a project.

## Brief example

```json
{
  "from": "agent:analyst",
  "to": "agent:cms",
  "channel": "agent",
  "wait": false,
  "brief": {
    "text": "Draft a changelog for the pricing launch. Audience is existing customers. Return markdown only.",
    "context": {
      "date_range": "2026-08-01/2026-08-28",
      "object_type": "posts",
      "format": "markdown"
    }
  }
}
```

## Inbox injection example

On a later Slack turn, the runtime may prepend:

```
[From analyst, 12m ago]
  analyst: Draft a changelog for the pricing launch...
  You replied: (still working)
```

This block is protocol, not an implementation detail. A conforming runtime MUST keep it out of the caller's transcript.

## Relationship to A2A and MCP

| Layer | Protocol | Role |
| --- | --- | --- |
| Tools and data | MCP | Agent to its own tools |
| Stranger, cross-org | A2A | Discover a card, start a task |
| Teammates, same workplace | PAP | Roster, brief, inbox, handoff, goals |

A Cosmic agent MAY later project an A2A Agent Card (name, snippet, capabilities, endpoint) and declare PAP as extensions:

- `https://www.cosmicjs.com/extensions/delegation-continuity/v1`
- `https://www.cosmicjs.com/extensions/goal-loops/v1`

The card is how a stranger finds you. PAP is how a peer works with you after you have listed them.
