# Changelog

Breaking changes to the draft are listed here with what an owner or a caller has to change.

## 1.0 Draft, November 10, 2026, purchases

Nothing breaks. A purchase is a confirmed action, and callers that already handle confirmations handle it.

- A new `authorization_details` type, `purchase`, with `merchant`, `items`, `total`, and `currency`, and optional `subtotal`, `shipping`, and `tax`. Amounts are decimal strings. Callers can show one checkout card for every store.
- The person pays on the owner's page. A caller never receives a card or a payment token.
- An owner that sells through CAP stores the cart against the account. A cart that lives only in a browser session cannot be reached by the owner's agent.
- `result.reference` on a `done` confirmation is a short id the person can quote, such as an order number.
- The 10-minute limit is for deciding. Work that starts on approval, such as a payment, stays `working` until it ends.

## 1.0 Draft, November 8, 2026, Ask line and help

Nothing breaks. Callers that know CAP ignore both additions.

- Owners should add an `Ask` line to `agent.txt`, right after `Name`. It is one fixed sentence, copied exactly, with no URL in it, so it never drifts from the `CAP` line. In tests, general-purpose agents read `agent.txt` without it, skipped `Spec`, and went back to reading the site. With it, they posted to the door.
- `Protocol` and `CAP` are the only required lines. This was already true and is now stated once.
- Owners should answer a `GET` on the CAP URL and on `{CAP}/messages`, with no headers required, with `200` and a short plain-text help. Agents that browse open the CAP URL with a `GET` first, and an error page sent them back to reading the site.
- Owners should accept a public question as a `GET`: `{CAP}/messages?from=agent:{id}&message=...`, read back with `?from=` on the message URL. Many agents can only open URLs and could not reach a door at all. A `GET` never carries a login, and the same question from the same agent within a minute is asked once.
- A new caller rule: ask the door first when the question is one the company answers, say which answer came from the door, and check other sources for comparisons and reviews.
- The caller card opens with that rule. The reference server writes the `Ask` line and serves the help.

## 1.0 Draft, October 23, 2026, link the door from pages agents read

Nothing breaks. Callers still try `/agent.txt` first and ignore the homepage when that file is a valid door.

- Owners should add `<link rel="agent" href="https://{domain}/agent.txt">` on the homepage even when the root file is valid. The same `Link` header means the same thing. Agents that are reading the page find the door there.
- Owners should add one line to `llms.txt` that points at `/agent.txt` and says to ask there.
- Owners may list the file in `/.well-known/ai-catalog.json` with `type` `text/plain`. A site that publishes `/.well-known/ard.json` lists the same entry there.

## 1.0 Draft, October 23, 2026, finding the file

A host that cannot serve a file at the root can still publish a door. Nothing breaks for a site that already serves `/agent.txt`.

- A redirect from `/agent.txt` may go to any https URL. The company's domain is vouching for the target.
- When `/agent.txt` is missing, an HTML page, or has no `CAP` line, a caller reads the homepage. It follows `Link: <url>; rel="agent"` or `<link rel="agent" href="url">` in the head, then fetches that file once.
- The door belongs to the domain the caller asked. The host that served the file does not.
- A valid `/agent.txt` still wins. Callers do not look at the homepage.

## 1.0 Draft, October 19, 2026, hosted caller card

`Spec` now points at one hosted card. Nothing breaks: a door with its own card still works.

- Owners should set `Spec: https://conciergeprotocol.org/cap.txt` instead of copying the card to their domain. The hosted card covers every CAP 1.x door.
- A caller may skip fetching the card when it already knows CAP.
- The reference server writes the hosted `Spec` line by default. `agent.spec` still overrides it.

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
