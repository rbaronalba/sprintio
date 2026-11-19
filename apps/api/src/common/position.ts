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
export function place(
  siblings: { id: string; position: number }[],
  afterId: string | null,
): Placement | null {
  const index = slotIndex(siblings, afterId);
  if (index === null) return null;

  const position = slotPosition(
    siblings[index - 1]?.position,
    siblings[index]?.position,
  );
  if (Number.isFinite(position) && Math.abs(position) <= MAX_ABS)
    return { position };

  // Gap exhausted (or drifted too far): spread everyone out again, the item in its slot.
  const renumber = siblings.map((s, i) => ({
    id: s.id,
    position: (i < index ? i + 1 : i + 2) * GAP,
  }));
  return { position: (index + 1) * GAP, renumber };
}

/** Index the item will occupy, or null when `afterId` is not among the siblings. */
function slotIndex(
  siblings: { id: string }[],
  afterId: string | null,
): number | null {
  if (afterId === null) return 0;
  const found = siblings.findIndex((s) => s.id === afterId);
  return found === -1 ? null : found + 1;
}

/** Midpoint between neighbours; NaN when they are too close to split. */
function slotPosition(
  prev: number | undefined,
  next: number | undefined,
): number {
  if (prev === undefined && next === undefined) return GAP;
  if (prev === undefined) return (next as number) - GAP;
  if (next === undefined) return prev + GAP;
  return next - prev > MIN_GAP ? (prev + next) / 2 : NaN;
}
