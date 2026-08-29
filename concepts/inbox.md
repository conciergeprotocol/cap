# Inbox

An agent can have mail on one channel while it is talking on another.

PAP requires the runtime to surface active inbound briefs into the agent's other sessions: attributed, truncated, and never mixed into the caller's transcript.

```
[From analyst, 12m ago]
  analyst: Draft a changelog for the pricing launch...
  You replied: (still working)
```

This is how Lisa knows Sam asked her something without leaving Slack. It is not a notification product. It is ambient awareness of inbound peer work.

Rules:

- Only active delegation sessions, not closed history.
- Attribution uses the roster name when the sender is listed, otherwise a generic "another agent."
- Truncate. The inbox is a pointer, not a dump of the other transcript.
- Do not inject inbox into the ephemeral run that *is* the delegation. That session already has the brief.

A2A has no equivalent. A Task is isolated. Inbox is the part of PAP that will not fit in a task lifecycle.
