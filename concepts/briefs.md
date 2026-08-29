# Briefs

A brief is a conversational hand-off: natural language plus optional structured context.

The contract is one sentence: put everything the other agent needs in the brief so they do not have to ask a follow-up. The question, the date range, the metric, the format. A thin brief that requires a clarifying question doubles the wait.

Send is wait-capped. The Cosmic default is 90 seconds. If the peer is still in its tool loop, the response is:

```json
{
  "status": "accepted",
  "still_running": true,
  "session_id": "sess_...",
  "note": "Working. Pull later. Do not invent a result."
}
```

That is success, not a timeout. The run continues. The caller moves on.

Rules that belong in the protocol, not in a style guide:

- At most two outstanding briefs per turn. Many small round-trips are the slowest path.
- `wait: false` when you do not need the answer in this turn.
- Pull the reply later (`get_delegation_reply`). Do not busy-wait.
- Never state a delegated finding you have not actually read.

A brief is not a run. See [chat vs run](chat-vs-run.md).
