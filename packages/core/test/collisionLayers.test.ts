import {
  conformPhysicsSettings,
  createDefaultLayer,
  createPhysicsSettings,
  layerNamesProblem,
  layersTouch,
  setLayersTouch,
  type CollisionLayer,
} from '../src/index';
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

describe("the matrix's checkboxes", () => {
  it('ticking a pair clears it on both sides; unticking writes it once, on the earlier layer', () => {
    const both: CollisionLayer[] = [
      createDefaultLayer(),
      { id: 'a', name: 'A', ignores: ['b'] },
      { id: 'b', name: 'B', ignores: ['a'] },
    ];

    const ticked = setLayersTouch(both, 'b', 'a', true);
    expect(ticked).toEqual([
      createDefaultLayer(),
      { id: 'a', name: 'A', ignores: [] },
      { id: 'b', name: 'B', ignores: [] },
    ]);
    expect(both[1]?.ignores).toEqual(['b']);

    // One line in `project.json` per checkbox, on the same side whichever way it is asked.
    const unticked = setLayersTouch(ticked, 'b', 'a', false);
    expect(unticked).toEqual([
      createDefaultLayer(),
      { id: 'a', name: 'A', ignores: ['b'] },
      { id: 'b', name: 'B', ignores: [] },
    ]);
    expect(setLayersTouch(unticked, 'a', 'b', false)).toEqual(unticked);
    expect(layersTouch(unticked, 'a', 'b')).toBe(false);
  });

  it('a layer can be made to pass through itself, and back', () => {
    const table: CollisionLayer[] = [createDefaultLayer(), { id: 'debris', name: 'Debris', ignores: [] }];

    const apart = setLayersTouch(table, 'debris', 'debris', false);
    expect(apart[1]).toEqual({ id: 'debris', name: 'Debris', ignores: ['debris'] });
    expect(layersTouch(apart, 'debris', 'debris')).toBe(false);

    expect(setLayersTouch(apart, 'debris', 'debris', true)).toEqual(table);
  });
});

describe('a table that can be saved', () => {
  it('says why a table cannot be saved', () => {
    expect(layerNamesProblem(createPhysicsSettings().layers)).toBeNull();
    expect(layerNamesProblem([createDefaultLayer(), { id: 'a', name: '  ', ignores: [] }])).toMatch(/name/i);
    // As the Layer row would list them: two alike would read as one.
    expect(
      layerNamesProblem([
        createDefaultLayer(),
        { id: 'a', name: 'Ghost', ignores: [] },
        { id: 'b', name: 'Ghost ', ignores: [] },
      ]),
    ).toMatch(/"Ghost"/);
    expect(layerNamesProblem([createDefaultLayer(), { id: 'a', name: 'Default', ignores: [] }])).toMatch(
      /"Default"/,
    );
  });
});

/*
 * A table read where it arrives — the project file, a settings patch, a launch
 * — entry by entry: `conform` takes an array as a tuple, and gave back the
 * model's table whenever the lengths differed.
 */
describe('a layer table, where it arrives', () => {
  const read = (layers: unknown) => conformPhysicsSettings({ ...createPhysicsSettings(), layers }).layers;

  it('reads a table entry by entry', () => {
    expect(
      read([
        { id: 'x', name: 'X', ignores: [3, 'default', 'nobody'] },
        { id: 'x', name: 'Again' },
        'oops',
        { name: 'no id' },
        { id: '', name: 'Empty' },
      ]),
    ).toEqual([createDefaultLayer(), { id: 'x', name: 'X', ignores: ['default'] }]);
    expect(read([{ id: 'y', name: 7, ignores: 'all' }])).toEqual([
      createDefaultLayer(),
      { id: 'y', name: 'y', ignores: [] },
    ]);
  });

  it('puts Default first, keeps sixteen, and calls Default Default', () => {
    const twenty = Array.from({ length: 20 }, (_, i): CollisionLayer => ({ id: `l${i}`, name: `L${i}`, ignores: [] }));
    expect(read(twenty)).toEqual([createDefaultLayer(), ...twenty.slice(0, 15)]);

    expect(read([{ id: 'x', name: 'X', ignores: [] }, { id: 'default', name: 'World', ignores: ['x'] }])).toEqual([
      { ...createDefaultLayer(), ignores: ['x'] },
      { id: 'x', name: 'X', ignores: [] },
    ]);
  });

  it('a table that is not an array is Default alone', () => {
    expect(read('oops')).toEqual([createDefaultLayer()]);
    expect(read({ default: createDefaultLayer() })).toEqual([createDefaultLayer()]);
  });

  it('keeps the gravity and step it reads beside the table', () => {
    const settings = conformPhysicsSettings({ gravity: [0, -3, 0], fixedTimestep: 'fast', layers: [] });
    expect(settings).toEqual({ ...createPhysicsSettings(), gravity: [0, -3, 0] });
  });
});
