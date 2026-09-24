# 0006 — Ordering uses sparse float positions

Status: Accepted · 2026-09-21, recorded 2026-09-23

## Context

Lists, cards and checklist items are user-ordered by drag and drop. Storing a dense
integer `index` means every reorder rewrites every sibling after the insertion point:
one drag, N updates, and a race if two people drag at once.

## Decision

`position` is a `Float`. New items go at `last + 1000`. An item dropped between two
neighbours takes the midpoint of their positions. A single drag is one `UPDATE` of one
row, and two people dragging different cards do not write to each other's rows.

`parseUpsertCard` clamps `position` to ±1e9 and rejects non-finite values, because a
float that grows without bound or is bisected without bound eventually loses the
precision that makes the ordering meaningful.

## Consequences

- Repeatedly dropping into the same gap halves the interval each time. IEEE-754 doubles
  survive ~50 consecutive bisections of an initial 1000-wide gap, which no human
  reaches by dragging. If it ever matters, renormalise a list's positions to
  `1000, 2000, 3000…` in one pass.
- Two people dropping into the *same* gap simultaneously can land on equal positions.
  The order between those two is then whatever the database returns, which is a cosmetic
  tie, not corruption, and the next drag fixes it.
- The client computes the new position (`positionAt()` in `apps/web`), so the server
  trusts a number from the client. That is fine — position carries no authority, and
  it is range-checked on the way in.
