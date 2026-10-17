# Changelog

Breaking changes to the draft are listed here with what an owner or a caller has to change.

## 1.0 Draft, October 16, 2026

Account login is now fully defined. Owners that answered account questions with tokens issued some other way need to adopt this flow. Callers need a client document.

- The `OAuth` line is the authorization server's issuer. Callers read its metadata (RFC 8414).
- Login is OAuth 2.1 with PKCE (`S256`). The visiting agent's `client_id` is a URL to its own client document, with `client_name`, `redirect_uris`, and `cap_from`. There is no registration step.
- The owner binds each token to the document's `cap_from`. Another `CAP-From` with that token is `403`.
- Refresh tokens rotate. Revocation follows RFC 7009. DPoP is optional.
- A redirect from `example.com` to `www.example.com` is followed when finding `agent.txt`.
- The reference server replaces its `demo_oauth` routes with a real authorization server, configured with an `oauth` block.

## 1.0 Draft

First public draft.

- One file, `agent.txt` at the root of the company's domain. The first line is `Protocol: CAP/1.0`.
- One object, the message, with the statuses `working`, `done`, and `failed`.
- Two endpoints: `POST /cap/v1/messages` and `GET /cap/v1/messages/{id}`.
- Follow-ups with `previous_message_id`. The owner rebuilds the thread from its own records.
- Account questions with an OAuth bearer token. `login_required` when no grant was sent.
