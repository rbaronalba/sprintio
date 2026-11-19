import { describe, expect, it } from 'vitest';
import { GAP, place } from './position.js';
import { dropsUntilRenumber } from '../../test/support/position.js';

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

  it('keeps bisecting for about 30 drops in the same slot before it renumbers', () => {
    expect(dropsUntilRenumber()).toBeGreaterThanOrEqual(29);
  });

  it('still bisects a gap just above the threshold', () => {
    expect(place([row('a', 1000), row('b', 1000.000002)], 'a')).toEqual({
      position: 1000.000001,
    });
  });

  it('renumbers once the gap between the two neighbours is too small to bisect', () => {
    const s = [row('a', 1000), row('b', 1000.0000005)];
    expect(place(s, 'a')).toEqual({
      position: 2000,
      renumber: [row('a', 1000), row('b', 3000)],
    });
  });

  it('renumbers when two items share a position (concurrent drops)', () => {
    expect(
      place([row('a', 1500), row('b', 1500)], 'a')?.renumber,
    ).toBeDefined();
  });
});
