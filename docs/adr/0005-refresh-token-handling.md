# 0005 — Refresh token in an httpOnly cookie, access token in memory

Status: Accepted · 2026-09-09, recorded 2026-09-23

## Context

The browser needs to survive a page reload without asking for the password again, and
it needs to attach credentials to API calls. The default answer — put a JWT in
`localStorage` — hands the token to any XSS that ever lands on the page, and the token
stays valid until it expires no matter what you do afterwards.

## Decision

Two tokens with different storage and different jobs.

**Access token**, 15 minutes, held in an Angular signal in memory only. Never written
to `localStorage` or `sessionStorage`. XSS can still read it out of a running page, but
it cannot be exfiltrated after the fact from storage, and it dies in 15 minutes.

**Refresh token**, 7 days, in an `httpOnly` `sameSite=strict` cookie (`secure` in
production). JavaScript cannot read it at all. It is only ever spent at `/auth/refresh`.

Server-side, each signed-in device is a `Session` row holding a SHA-256 hash of its
current refresh token and a sliding 7-day expiry; the token carries the row's id as
`sid`. A stolen database gives an attacker hashes, not sessions. (Until 2026-09-24 there
was one hash per user, so signing in on a phone signed the laptop out.)

**Reuse detection.** A refresh token is rotated on every use. If one arrives that
verifies but does not match the stored hash, that means the token was used twice —
either replayed by an attacker or by the legitimate client after a theft. The response
is to delete that device's session, killing it for everyone holding it. Better a
spurious logout than a silently shared session.

**Grace window.** Tabs in one browser share one cookie jar, and each tab's JS refreshes
on its own, so two tabs can spend the same cookie at once. Rotation is a conditional
update (`WHERE tokenHash = presented`), so exactly one wins; the loser presents the hash
that was just rotated out. Within 10 seconds of a rotation that is treated as this race,
not a replay: it gets an access token and no new cookie, because the winner's Set-Cookie
is already landing in the same jar.

The refresh payload carries a `jti` (`randomUUID()`) because `iat` only has second
resolution, so two tokens minted in the same second would otherwise be byte-identical
and rotation would be invisible.

Client-side, concurrent 401s share one in-flight refresh via `shareReplay(1)`, so a
burst of parallel requests triggers a single rotation rather than a stampede that would
trip reuse detection against itself.

## Consequences

- A hard reload has a visible round trip before the app is usable: `restoreSession()`
  has to spend the cookie before anything renders. That is the cost of not keeping the
  token in storage.
- `sameSite=strict` means an invite link followed from another site lands unauthenticated
  on the first hop. Acceptable: the user signs in and the link still resolves.
- Logout is real — it deletes the server-side session — for the device that logs out.
  Other devices stay signed in. There is no "sign out everywhere" yet.
- The grace window means a thief who replays a token within 10 seconds of the victim's
  own refresh gets a 15-minute access token instead of tripping reuse detection.
- `/auth/refresh` gets a looser rate limit than login and register (60/min vs 10/min).
  It is not a guessing surface (the cookie is an unforgeable signed token we issued) and
  every page load spends one, so at the credential limit a user with a handful of tabs
  locks themselves out.
