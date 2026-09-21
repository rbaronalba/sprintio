/** Position for an item moved to `index` within `siblings` (siblings excludes the moved item). */
export function positionAt(siblings: { position: number }[], index: number): number {
  const before = siblings[index - 1]?.position;
  const after = siblings[index]?.position;
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}
