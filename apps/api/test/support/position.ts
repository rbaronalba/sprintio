import { place } from '../../src/common/position.js';

/** Drops an item right after the first one, again and again, until place() renumbers. Returns how many drops that took. */
export function dropsUntilRenumber(): number {
  let siblings = [
    { id: 'a', position: 1000 },
    { id: 'b', position: 2000 },
  ];
  let drops = 0;
  for (;;) {
    const placed = place(siblings, 'a')!;
    if (placed.renumber) return drops;
    drops++;
    siblings = [siblings[0], { id: `n${drops}`, position: placed.position }, ...siblings.slice(1)];
  }
}
