# 0003 — One event log feeds realtime, activity and notifications

Status: Accepted · 2026-09-23

## Context

Three features were on the roadmap as three features: live updates between members, a
per-card activity feed ("Rubén moved this card from X to Y"), and user notifications
("you were assigned", "you were mentioned").

Built separately they are three subsystems: a socket fan-out, an audit table with its
own writers, and a notification queue with its own producers. Each one would need its
own hook at every mutation site.

They are not three things. They are three readers of one fact: *something happened on
a board, and a person did it*.

## Decision

A single append-only `Event` table. Every mutation calls `EventsService.record()` once,
and that one row is read three ways:

- pushed to live subscribers on the SSE bus, filtered by board membership → realtime
- queried by `cardId` → the card's activity feed
- fanned out into `Notification` rows for the users the call names → the bell

Design details that matter:

- **`Event.type` is a `String`, not a Postgres enum.** Adding an event type should not
  cost a migration.
- **`Event.cardId` is deliberately not a foreign key.** "Rubén deleted card X" has to
  outlive card X. A cascade would erase the history of exactly the event most worth
  keeping, and `SET NULL` would lose which card it was.
- **`Event.data` is a display-only JSON snapshot** — card title, list names, label
  name. It is rendered, never read back as state. That is what lets the feed still say
  "deleted *Fit the wet tyres*" after the card is gone.
- **Notification targets are passed in by the caller**, not inferred by a rules engine
  inside `record()`. The card service knows who is affected; a central rules engine
  would have to re-derive it. `record()` only drops the actor, because you are never
  notified of your own doing.
- **`@@unique([userId, eventId])` on `Notification`** makes fan-out idempotent, so a
  retried `record()` cannot double-notify.

`record()` is best-effort: it catches and logs rather than throwing. The action it
describes has already been committed, so a failure to log it must not turn a successful
request into a 500.

## Consequences

- Adding an event type is one `record()` call plus one line in the client's
  `describeEvent()`. Nothing else.
- The table grows forever. There is no retention policy, and reads are capped by
  `take` with indexes on `(boardId, createdAt)` and `(cardId, createdAt)`. When it
  matters, delete rows older than N months — the feed is a feed, not an audit export.
- `record()` is a second round trip after the mutation, not part of its transaction. A
  crash between the two loses the log line but keeps the data correct. That is the
  right way round.
- Notifications are in-app only. No email, no push. The rows are there if that changes.
