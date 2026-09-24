# 0002 — Live updates ride on SSE, not WebSockets

Status: Accepted · 2026-09-23

## Context

Two people on the same board did not see each other's changes without a reload, which
is the largest single gap against Trello. The reflex answer is a WebSocket gateway
(`@nestjs/websockets` + `socket.io`).

But every write in this application already goes through REST and works. The only
missing direction is server → client. A WebSocket buys a bidirectional channel and
then uses half of it.

## Decision

Server-Sent Events. `GET /events/stream` is a Nest `@Sse()` route; the browser consumes
it with the native `EventSource`.

What this gets for free:

- **Reconnection.** `EventSource` reconnects on its own. With socket.io we would be
  depending on its reconnect logic anyway; with a raw `ws` we would be writing it.
- **No client dependency.** `socket.io-client` is ~40 kB for a feature the platform
  already has.
- **Plain HTTP.** It goes through the existing nginx proxy with `proxy_buffering off`,
  rather than needing `Upgrade`/`Connection` header plumbing.

Writes stay on REST. When the client needs to tell the server something, it makes a
request, exactly as before.

## Authentication

`EventSource` cannot send an `Authorization` header, which is the one real cost of
this choice. Putting the access token in the query string would drop a 15-minute
credential into nginx and browser history logs.

So the stream is opened with a separate ticket: `POST /events/ticket` returns a JWT
that expires in 60 seconds and carries its own audience (see [0004](0004-token-audiences.md)),
which makes it useless against any other endpoint. It is a capability to open a stream
and nothing else. A leaked ticket is stale before it is useful.

## Consequences

- One stream per session, not per board. It carries every board the user belongs to,
  so the notification bell works from any page.
- Membership is read once when the stream opens. A board joined mid-stream is picked
  up from its own `MEMBER_JOINED` event. A membership *revoked* mid-stream would not
  be — there is no remove-member feature yet, and when there is, that path must close
  the affected stream so the client reconnects and re-reads membership.
- SSE over HTTP/1.1 costs a connection per tab against the browser's 6-per-origin
  limit. `MAX_STREAMS_PER_USER` caps it server-side at 6. Under HTTP/2 the browser
  limit disappears.
- If bidirectional, low-latency traffic is ever needed — live cursors, presence,
  typing indicators — this decision should be revisited. Those are the cases SSE
  genuinely cannot serve.
