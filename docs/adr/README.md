# Architecture decision records

One file per decision that was expensive to make and would be expensive to reverse.
Each records the state of the world when it was taken; a superseded record is marked,
not deleted.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-board-membership-authorization.md) | Board membership is the authorization model | Accepted |
| [0002](0002-sse-over-websockets.md) | Live updates ride on SSE, not WebSockets | Accepted |
| [0003](0003-single-event-log.md) | One event log feeds realtime, activity and notifications | Accepted |
| [0004](0004-token-audiences.md) | Every JWT carries an audience | Accepted |
| [0005](0005-refresh-token-handling.md) | Refresh token in an httpOnly cookie, access token in memory | Accepted |
| [0006](0006-float-positions.md) | Ordering uses sparse float positions | Accepted |
