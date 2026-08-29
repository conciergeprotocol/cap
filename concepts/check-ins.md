# Check-ins

A check-in is a self-wake inside the current conversation.

The agent schedules a future turn with a delay, a reason, and a follow-up prompt written as instructions to itself. The human does not see the tool call. The human sees "I'll check the deploy in two minutes."

Point `related_resource` at the run or deploy when you have one. The check-in fires immediately if that resource finishes early.

Bounds Cosmic already enforces, and that a PAP runtime should keep: short look-ahead (30 seconds to 24 hours), a small cap of pending check-ins per session, no check-ins on goal-loop runs or delegations.

Check-ins are not goals. A goal is the job. A check-in is the nudge so the agent can report progress without the human prompting again.
