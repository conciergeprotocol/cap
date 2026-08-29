# Handoff

A soft reset does not wipe the workplace.

The runtime writes a structured summary of the current session (current state, commitments, open work) and seeds the next session on that same channel. The new session treats the summary as established context until real messages replace it.

Hard reset is explicit and carries nothing.

Handoff is per channel, not global. Slack does not inherit WhatsApp. Delegation and workflow runs do not inherit any handoff. Those sessions start empty on purpose.

The summary is for the same agent, starting again. It is not a document you hand to a foreign caller. Foreign callers get the agent's continued identity, not the transcript.
