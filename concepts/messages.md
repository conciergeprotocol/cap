# Messages

A message is one question and its answer. The visiting agent sends text and an optional brief. The company's agent answers with its own tools and returns text.

```mermaid
sequenceDiagram
    participant P as Person
    participant V as Visiting agent
    participant O as Company agent
    participant T as Search, MCP, API, or a person

    P->>V: Find black running shoes in size 12
    V->>O: POST /cap/v1/messages, with a short brief
    O->>T: Look it up
    Note over O,T: Tools and keys stay here
    alt Ready within the owner's wait
        O-->>V: 200 done, reply
    else Still working
        O-->>V: 202 working, Retry-After
        V-->>P: The store is still checking
        V->>O: GET /cap/v1/messages/{id}
        O-->>V: 200 done, reply
    end
    V-->>P: The reply
```

A message is `working`, `done`, or `failed`. Only `done` has a `reply`. Only `failed` has an `error`. While it is `working`, the visiting agent does not guess. It tells the person and waits for `Retry-After`.

The brief is what the visiting agent knows that the company does not: a size, a style, a date. It is short. It is not the person's profile, and it is not the company's API payload.

A follow-up such as "something cheaper?" sets `previous_message_id` to the last message. The company's agent answers with the whole thread in mind, rebuilt from its own records. The visiting agent sends only the new text, so it cannot rewrite what the company said earlier. A thread can gain a login partway through. It never switches accounts.

The reply is text, with links inline. Checkout, booking, and payment stay on the company's site.
