import { createDefaultLayer, layersTouch, type CollisionLayer } from '../src/index';
import { describe, expect, it } from 'vitest';

/*
 * The matrix is stored as what passes through: each layer lists the layers it
 * ignores, and two layers touch unless either lists the other. The runtime's
 * collision groups, the dialog's checkboxes and the engine's warnings all read
 * it through `layersTouch`, so its rule is pinned here once.
 */

const table: CollisionLayer[] = [
  createDefaultLayer(),
  { id: 'a', name: 'A', ignores: ['b'] },
  { id: 'b', name: 'B', ignores: [] },
  { id: 'c', name: 'C', ignores: [] },
  { id: 'debris', name: 'Debris', ignores: ['debris'] },
];

describe('layersTouch', () => {
  it('two layers touch unless either lists the other', () => {
    expect(layersTouch(table, 'a', 'b')).toBe(false);
    expect(layersTouch(table, 'b', 'a')).toBe(false);
    expect(layersTouch(table, 'a', 'c')).toBe(true);
    expect(layersTouch(table, 'a', 'a')).toBe(true);
    // Debris passes through debris, and still lands on everything else.
    expect(layersTouch(table, 'debris', 'debris')).toBe(false);
    expect(layersTouch(table, 'debris', 'default')).toBe(true);
  });

  it('a new layer touches every layer', () => {
    const grown = [...table, { id: 'new', name: 'New', ignores: [] }];
    for (const layer of grown) expect(layersTouch(grown, 'new', layer.id)).toBe(true);
  });

  it('an id the table does not hold reads as Default', () => {
    const parted: CollisionLayer[] = [
      { ...createDefaultLayer(), ignores: ['x'] },
      { id: 'x', name: 'X', ignores: [] },
    ];
    expect(layersTouch(parted, 'gone', 'x')).toBe(false);
    expect(layersTouch(parted, 'x', 'gone')).toBe(false);
    expect(layersTouch(parted, 'gone', 'default')).toBe(true);
  });
});
