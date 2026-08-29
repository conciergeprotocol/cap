# Capabilities

A capability is a permission, not a marketing skill.

Discovery tells a peer what class of work this agent is allowed to do. It does not enumerate tools, and it does not leak the system prompt.

PAP treats the capability list as an open vocabulary. Cosmic's current flags (`cms_write`, `agent_delegate`, `computer_use`, and the rest) are one vocabulary. A foreign runtime publishes its own. The protocol only requires that:

- A brief is rejected if the sender lacks `agent_delegate` (or the local equivalent).
- A run is rejected if the sender lacks the run capability.
- Self-update and agent creation are gated separately from delegation.
- Callers must not infer that a capability means a particular tool will be invoked. Capabilities are a ceiling, not a script.

This is why PAP does not use A2A-style skill catalogs as the access model. Skills describe what an agent is good at. Capabilities describe what it is allowed to do.
