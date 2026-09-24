# 0001 — Board membership is the authorization model

Status: Accepted · 2026-09-23

## Context

`User.role` is an enum of `ADMIN | MANAGER | DEVELOPER`, and there is a `RolesGuard`
plus a `@Roles()` decorator. Neither is applied to a single endpoint. The obvious next
step looked like "decide what each role can do and enforce it".

That instinct is wrong for this product. Sprintio is a Trello clone, and Trello has no
global role ladder. Permission in Trello is a property of the relationship between a
person and a board, not a rank the person carries everywhere. A global `MANAGER` that
outranks a `DEVELOPER` on a board the manager was never invited to is a Jira concept.

The codebase had in fact already answered this question without writing it down:
`memberOf()` in `boards/access.ts` is the only predicate any query uses, and the
owner-only operations go through `findOwned()`.

## Decision

Authorization is board-scoped and has exactly two levels:

- **Owner** — rename, delete, and share the board (create and revoke the invite link).
- **Member** — everything else: lists, cards, labels, comments, time, attachments,
  checklists. The owner is stored as a member too, so member checks cover them.

Per-author restrictions layer on top for things that are personal rather than shared:
only the author deletes their own comment, only the logger deletes their own time
entry, only the uploader deletes their own attachment.

`User.role` stays in the schema but grants nothing. It is displayed on the dashboard
and nothing reads it for an access decision.

## Consequences

- No permission matrix to maintain, and no way to grant board access by editing a user
  row — access is a `BoardMember` row and nothing else.
- Any member can delete any card. That is Trello's behaviour; it is a trust model, not
  an oversight.
- There is no board-admin tier and no "observer" (read-only) tier. If either is needed,
  it belongs as a column on `BoardMember`, not as a global role.
- Leaving a vestigial `role` column is a real cost: the next reader will assume it does
  something. That is what this record is for. Delete it if it is still unused when
  someone next touches auth.
