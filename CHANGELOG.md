# Changelog

Breaking changes to the draft are listed here with what an owner or a caller has to change.

## 1.0 Draft, October 16, 2026, access scope

Logins can now ask to make changes. Nothing breaks: a login without `scope` reads, as before.

- A caller may send `scope=write` with either login. Owners that offer it list `scopes_supported: ["read", "write"]`.
- The person can allow changes, allow read only, or deny. The token response's `scope` says what was granted, and a renewed token keeps it.
- Owners may give write tokens a shorter lifetime and should have the person confirm actions that are hard to undo.
- A held action comes back as `confirmation` on a `done` message, with a `url` for the person and a `summary`. The caller polls `GET /cap/v1/confirmations/{id}` until it is `done`, `failed`, `denied`, or `expired`. The owner runs an approved action once.
- The reference server implements both: `oauth.write`, `oauth.write_access_token_seconds`, `scope` for the handler, `confirm` from the handler, `boot({ act })`, and a confirm page at `/oauth/confirm`. The store example adds gift wrap with a write login and a cancel that waits for the person's OK.
- New guide for owners: [Add login to your agent](login.md).

## 1.0 Draft, October 16, 2026, code login

A visiting agent can now log in with only HTTP. Owners with an `OAuth` line must support it. Callers no longer need a client document.

- The code login is the OAuth device authorization grant (RFC 8628). Metadata lists `device_authorization_endpoint`. The caller posts `client_id=agent:{id}`, tells the person the `verification_uri_complete` and `user_code`, and polls the token endpoint.
- The token is bound to that `CAP-From`. The owner shows the agent's name as not verified unless the `client_id` is a client document URL.
- The redirect login (PKCE with a client document) is now optional for owners.
- The reference server adds `/oauth/device` and an `oauth.device_interval` option.

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
