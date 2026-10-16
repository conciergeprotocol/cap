# Access

A public question, such as a product search or store hours, needs no token. A question about a person's account needs that person to log in.

```mermaid
sequenceDiagram
    participant P as Person
    participant V as Visiting agent
    participant L as Company OAuth
    participant O as Company agent

    P->>V: Where's my order?
    V->>O: POST /cap/v1/messages
    O-->>V: failed, login_required
    V-->>P: Log in to the store
    P->>L: Log in and consent
    L-->>V: Token for this account and this agent
    V->>O: POST /cap/v1/messages, Authorization: Bearer
    Note over O: Looks up the order with its own tools
    O-->>V: done, the order status
    V-->>P: The order status
```

Two identities travel on an account question. `Authorization: Bearer` is the person and the account. `CAP-From` is the visiting agent. The token works only for the agent it was issued to. Another agent with the same token gets `403`.

An account name or number in the brief is not access. Only the token decides whose account the company reads.

The person's password goes to the company's login page, never to their agent. The company's keys never leave the company. Revoking the token stops that agent, and nothing else has to rotate.
