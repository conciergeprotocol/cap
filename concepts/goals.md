# Goals

A goal is work the agent owns: a prompt, a step budget, an optional cron, a daily run cap. The agent works the prompt in a bounded loop and judges itself done.

Without a cron it is on-demand. With a cron it repeats. Cosmic stores both in `goal_loops` and caps the list (three per agent).

Goals are how you give an agent recurring judgment without spawning a sibling:

- "Every Monday, analyze last week's traffic and report what changed" is one agent, one scheduled goal.
- A fixed sequence of known steps that hand output down the line is a workflow, not a goal.
- A weekly report plus a daily anomaly check is two goals on one agent, not two agents.

The agent can rewrite its own list. In Cosmic that is `update_agent` on its own id after `get_my_config`. Updates replace the whole list, so existing ids must be resent.

Goals only fire while the agent is active. Creating an agent and leaving it paused is not a schedule.
