# 0004 — Every JWT carries an audience

Status: Accepted · 2026-09-23

## Context

Adding the SSE stream ticket meant a third kind of JWT, all three signed with the same
`JWT_SECRET`. Looking at how the existing two were verified surfaced a live bug:

`JwtAuthGuard` called `jwt.verifyAsync(token)` with no constraint beyond the signature.
The refresh token is `{ sub, jti }`, signed with that same secret. So **a stolen refresh
cookie worked as an access token** — it verified, `request.user.sub` was set, and every
board endpoint accepted it. Its seven-day lifetime made that considerably worse than
the fifteen minutes an access token is meant to be worth.

Adding a stream ticket to a URL would have made a third token with the same problem,
this time one that appears in proxy logs by design.

## Decision

Every token is minted with an explicit `aud`, and every verifier demands the one it
expects:

| Token | Audience | Verified by |
|---|---|---|
| Access | `sprintio:access` | `JwtAuthGuard` |
| Refresh | `sprintio:refresh` | `AuthService.refresh()` |
| Stream ticket | `sprintio:stream` | `EventsController.stream()` |

A token minted with no audience at all is rejected everywhere.

`src/auth/token-audience.spec.ts` asserts each cross-use is refused, because the whole
point is that these are valid signatures over our own secret — nothing but the audience
claim tells them apart.

## Consequences

- A leaked stream ticket opens a stream and nothing else. A leaked refresh cookie can
  only be spent at `/auth/refresh`, where reuse detection is waiting for it.
- **Deploying this logs everyone out once.** Tokens issued before it have no `aud`, so
  the access token is rejected, the refresh is rejected too, and the client falls
  through to the login page. One-time cost, no migration.
- A fourth token kind must pick an audience and a verifier. There is no default that
  quietly works everywhere, which is the property worth keeping.
