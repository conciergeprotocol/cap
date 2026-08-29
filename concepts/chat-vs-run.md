# Chat vs run

Two verbs. Do not mix them.

**Message** (`message_agent`) is a conversational hand-off. The target agent runs its own chat tool loop and writes a reply. It does not open a browser, does not start an autonomous job, and does not take screenshots.

**Run** (`execute_agent`, `execute_workflow`) starts a real execution. Computer use, a content or repository job, a team run. You pass `trigger_data`, you get a session or execution id, you poll status. Trigger data is rendered as a TRIGGER CONTEXT block in the target's prompt.

PAP keeps the split because the cost, the side effects, and the UX are different. A brief that silently becomes a twenty-minute browser session is a bug in the protocol, not a convenience.

Depth is bounded. Cosmic stops chained runs at three. Conversational briefs should be similarly capped so you cannot build an agent call stack.

Scope is the current project unless a later card-on-roster step says otherwise.
