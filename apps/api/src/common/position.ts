/** Spacing between neighbours after a fresh insert or a renumber. */
export const GAP = 1000;
/** Below this, (a + b) / 2 is about to stop landing strictly between a and b. */
const MIN_GAP = 1e-6;
/** Floats lose precision far from zero; renumber long before that matters. */
const MAX_ABS = 1e9;

export interface Placement {
  position: number;
  /** Set when the gaps ran out: new positions for every sibling, to write with the move. */
  renumber?: { id: string; position: number }[];
}

/**
 * Where an item goes when dropped right after `afterId` (null = first) among `siblings`,
 * which must be sorted and must not include the item itself. Positions are computed here,
 * on the server, from current rows: a client's copy may be stale by the time it moves.
 * Returns null when afterId is not one of the siblings.
 */
export function place(siblings: { id: string; position: number }[], afterId: string | null): Placement | null {
  const index = afterId === null ? 0 : siblings.findIndex((s) => s.id === afterId) + 1;
  if (afterId !== null && index === 0) return null;

  const prev = siblings[index - 1]?.position;
  const next = siblings[index]?.position;
  const position =
    prev === undefined && next === undefined ? GAP
    : prev === undefined ? next! - GAP
    : next === undefined ? prev + GAP
    : next - prev > MIN_GAP ? (prev + next) / 2
    : NaN;
  if (Number.isFinite(position) && Math.abs(position) <= MAX_ABS) return { position };

  // Gap exhausted (or drifted too far): spread everyone out again, the item in its slot.
  const renumber = siblings.map((s, i) => ({ id: s.id, position: (i < index ? i + 1 : i + 2) * GAP }));
  return { position: (index + 1) * GAP, renumber };
}
