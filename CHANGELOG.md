# Changelog

Breaking changes to the draft are listed here with what an owner or a caller has to change.

## 1.0 Draft

First public draft.

- One file, `agent.txt` at the root of the company's domain. The first line is `Protocol: CAP/1.0`.
- One object, the message, with the statuses `working`, `done`, and `failed`.
- Two endpoints: `POST /cap/v1/messages` and `GET /cap/v1/messages/{id}`.
- Follow-ups with `previous_message_id`. The owner rebuilds the thread from its own records.
- Account questions with an OAuth bearer token. `login_required` when no grant was sent.
