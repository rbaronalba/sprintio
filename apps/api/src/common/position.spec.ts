import { describe, expect, it } from 'vitest';
import { GAP, place } from './position.js';

const row = (id: string, position: number) => ({ id, position });

describe('place', () => {
  it('bisects, prepends and appends', () => {
    const s = [row('a', 1000), row('b', 2000)];
    expect(place(s, 'a')).toEqual({ position: 1500 });
    expect(place(s, null)).toEqual({ position: 0 });
    expect(place(s, 'b')).toEqual({ position: 3000 });
    expect(place([], null)).toEqual({ position: GAP });
  });

  it('rejects an afterId that is not a sibling', () => {
    expect(place([row('a', 1000)], 'zzz')).toBeNull();
  });

  it('renumbers once repeated drops between the same two items exhaust the gap', () => {
    let s = [row('a', 1000), row('b', 2000)];
    let renumbered = false;
    // Always drop right after 'a': the gap halves each time, which floats cannot do forever.
    for (let i = 0; i < 100 && !renumbered; i++) {
      const p = place(s, 'a')!;
      if (p.renumber) {
        renumbered = true;
        expect(p.renumber.map((r) => r.position)).toEqual([1000, 3000]);
        expect(p.position).toBe(2000);
      } else {
        expect(p.position).toBeGreaterThan(s[0].position);
        expect(p.position).toBeLessThan(s[1].position);
        s = [s[0], row('x' + i, p.position), ...s.slice(2)];
        s = [s[0], s[1]]; // keep the pair tight: the next drop lands between a and the newcomer
      }
    }
    expect(renumbered).toBe(true);
  });

  it('renumbers when two items share a position (concurrent drops)', () => {
    expect(place([row('a', 1500), row('b', 1500)], 'a')?.renumber).toBeDefined();
  });
});
