import { createEntity, expandPrefabs, type EntityTemplate } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { BETWEEN_ROWS_BAND, insertionAt, isBetweenRows, rangeSelection } from '../src/panels/hierarchyGestures';
import { buildRows } from '../src/panels/hierarchyRows';

/*
 * The last two rules that were written inside `HierarchyPanel.tsx`.
 *
 * Neither needed a DOM — one is a comparison against a fraction of a height,
 * the other two indices into a flat array — and being inside a component was
 * the whole of why nothing ran them. `environment: 'node'` means a rule in a
 * `.tsx` is a rule that is only ever executed by a person with a mouse.
 */

const NONE: ReadonlySet<string> = new Set();

/** A chain of entities, each the child of the one before it. */
function chain(names: string[]): EntityTemplate[] {
  const made = names.map((name) => createEntity(name));
  for (let index = 1; index < made.length; index += 1) {
    made[index]!.entity.parent = made[index - 1]!.entity.id;
    made[index - 1]!.entity.children = [made[index]!.entity.id];
  }
  return made;
}

/** Entities side by side under the root, which is what reordering acts on. */
function siblings(names: string[]): EntityTemplate[] {
  return names.map((name) => createEntity(name));
}

const rowsOf = (templates: EntityTemplate[]) =>
  buildRows(expandPrefabs(sceneWith(templates), { get: () => undefined }), NONE, '');

describe('the top band of a row', () => {
  it('means "between rows" above the band and "onto the row" below it', () => {
    // 24 is `ROW_HEIGHT`, and the band is a quarter of it.
    expect(isBetweenRows(0, 24)).toBe(true);
    expect(isBetweenRows(5, 24)).toBe(true);
    expect(isBetweenRows(6, 24)).toBe(false);
    expect(isBetweenRows(23, 24)).toBe(false);
  });

  it('leaves three quarters of every row for dropping onto it', () => {
    // The trade the fraction is: too wide and a child cannot be dropped onto a
    // parent, too narrow and rows cannot be reordered. Named so that changing
    // it is a decision rather than an edit to a literal inside a handler.
    expect(BETWEEN_ROWS_BAND).toBeLessThan(0.5);
  });

  it('reads a row of no height as "onto", rather than dividing by nothing', () => {
    // `getBoundingClientRect` answers zeroes for an element being torn down.
    // Either answer is harmless there; what matters is that there is one.
    expect(isBetweenRows(0, 0)).toBe(false);
  });
});

describe('where a between-rows drop lands', () => {
  it('keeps the parent the row already has, and takes the row own place', () => {
    const made = siblings(['One', 'Two', 'Three']);
    const scene = sceneWith(made);

    expect(insertionAt(scene, made[2]!.entity.id)).toEqual({ parent: null, index: 2 });
  });

  it('names the parent for a nested row, and the index among its children', () => {
    const made = chain(['Parent', 'Child']);
    const scene = sceneWith(made);

    expect(insertionAt(scene, made[1]!.entity.id)).toEqual({
      parent: made[0]!.entity.id,
      index: 0,
    });
  });

  it('refuses a row the scene does not hold, rather than inventing a place for it', () => {
    // An instanced row — `owner/local` — is not in `scene.entities`. The panel
    // already refuses to drop between them; this is the same answer, given
    // where the arithmetic is instead of where the pointer is.
    expect(insertionAt(sceneWith(siblings(['One'])), 'nobody')).toBeNull();
  });

  it('clamps to the start when a parent does not list the child it claims', () => {
    const made = chain(['Parent', 'Child']);
    const scene = sceneWith(made);
    // A tear: the child points up, the parent lists nothing. `indexOf` answers
    // -1 here, and -1 handed to an insert counts from the far end — the drop
    // would land at the bottom of a list the user was reordering the top of.
    scene.entities[made[0]!.entity.id]!.children = [];

    expect(insertionAt(scene, made[1]!.entity.id)?.index).toBe(0);
  });
});

describe('a shift-click', () => {
  it('takes every row between the anchor and the one clicked', () => {
    const made = siblings(['One', 'Two', 'Three', 'Four']);
    const rows = rowsOf(made);
    const ids = made.map((template) => template.entity.id);

    expect(rangeSelection(rows, ids[0]!, ids[2]!)).toEqual([ids[0]!, ids[1]!, ids[2]!]);
  });

  it('sweeps upwards as readily as downwards', () => {
    const made = siblings(['One', 'Two', 'Three', 'Four']);
    const rows = rowsOf(made);
    const ids = made.map((template) => template.entity.id);

    // The clicked row is last either way, so it is the one the gizmo follows.
    expect(rangeSelection(rows, ids[3]!, ids[1]!)).toEqual([ids[2]!, ids[3]!, ids[1]!]);
  });

  it('puts the clicked row last, so the gizmo stays under the pointer', () => {
    const made = siblings(['One', 'Two', 'Three']);
    const rows = rowsOf(made);
    const ids = made.map((template) => template.entity.id);

    // `Selection.primary` is the last id, and it is what the gizmo and the
    // Inspector follow. Ordered the other way, sweeping down a list moved the
    // gizmo to the row the sweep started from.
    expect(rangeSelection(rows, ids[0]!, ids[2]!)?.at(-1)).toBe(ids[2]!);
  });

  it('crosses depths, because the rows are what is on screen and not the tree', () => {
    const made = chain(['Parent', 'Child', 'Grandchild']);
    const rows = rowsOf(made);
    const ids = made.map((template) => template.entity.id);

    expect(rangeSelection(rows, ids[0]!, ids[2]!)).toHaveLength(3);
  });

  it('selects the one row when there is no anchor yet', () => {
    const made = siblings(['One', 'Two']);
    const rows = rowsOf(made);

    expect(rangeSelection(rows, null, made[1]!.entity.id)).toEqual([made[1]!.entity.id]);
  });

  it('gives back nothing when the anchor is not on screen', () => {
    // A filter flattens the list to its matches, so the row picked last may not
    // be in it. `null` is what turns the shift-click back into a plain one.
    const made = siblings(['One', 'Two']);
    const rows = rowsOf(made);

    expect(rangeSelection(rows, 'gone', made[0]!.entity.id)).toBeNull();
  });
});
