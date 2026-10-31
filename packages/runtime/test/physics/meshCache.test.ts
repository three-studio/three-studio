import { describe, expect, it } from 'vitest';
import { MeshCache } from '../../src/physics/MeshCache';

/*
 * The values computed from a vertex soup, kept by its content: what lets a
 * second Play start at once where the first decomposed every mesh it built.
 * No Rapier here — the cache holds whatever it is handed.
 */

const soup = (seed: number, size = 9) => ({
  positions: Float32Array.from({ length: size }, (_, i) => seed + i * 0.5),
  indices: Uint32Array.from({ length: size }, (_, i) => i),
});

/** A cache and a `compute` that says how often it ran. */
function counted() {
  const cache = new MeshCache<{ seed: number } | null>();
  let computed = 0;
  const get = (positions: Float32Array, indices: Uint32Array, value: { seed: number } | null = { seed: 0 }) =>
    cache.get(positions, indices, () => {
      computed += 1;
      return value;
    });
  return { get, computed: () => computed };
}

describe('MeshCache', () => {
  it('computes equal soups once, and hands back the same value', () => {
    const { get, computed } = counted();
    const a = soup(1);
    const b = soup(1);

    const first = get(a.positions, a.indices);
    const second = get(b.positions, b.indices);

    expect(computed()).toBe(1);
    expect(second).toBe(first);
  });

  it('computes again for soups that differ in one element, their lengths the same', () => {
    const { get, computed } = counted();
    const a = soup(1);
    const b = soup(1);
    b.positions[4] = 99;
    const c = soup(1);
    c.indices[8] = 0;

    get(a.positions, a.indices);
    get(b.positions, b.indices);
    get(c.positions, c.indices);

    expect(computed()).toBe(3);
  });

  it('computes the oldest again once 32 soups have come after it', () => {
    const { get, computed } = counted();
    for (let seed = 0; seed <= 32; seed++) get(soup(seed).positions, soup(seed).indices);
    expect(computed()).toBe(33);

    get(soup(0).positions, soup(0).indices);
    expect(computed()).toBe(34);
  });

  it('keeps a soup that is asked for, however many come after it', () => {
    const { get, computed } = counted();
    for (let seed = 0; seed < 40; seed++) {
      get(soup(seed).positions, soup(seed).indices);
      // Asked for again after every new one, so it is never the oldest.
      get(soup(-1).positions, soup(-1).indices);
    }
    expect(computed()).toBe(41);
  });

  it('keeps a null like any other value, so a degenerate mesh is not decomposed again', () => {
    const { get, computed } = counted();
    const flat = soup(0, 3);

    expect(get(flat.positions, flat.indices, null)).toBeNull();
    expect(get(flat.positions, flat.indices, null)).toBeNull();
    expect(computed()).toBe(1);
  });
});
