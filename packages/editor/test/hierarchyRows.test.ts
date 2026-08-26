import {
  createEntity,
  createMeshEntity,
    createPrefabInstance,
  expandPrefabs,
  instancedId,
  type EntityTemplate,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { buildRows } from '../src/panels/hierarchyRows';

/*
 * The row model, testable now that it is not shut inside a component module.
 *
 * Worth its own tests regardless of the extraction's other reason: `bee3e28`
 * measured 422ms per gizmo nudge at 4009 rows, of which 404ms was this walk and
 * 0.5ms was the mutation that triggered it.
 */

const NONE: ReadonlySet<string> = new Set();

/** An expansion of a scene holding no prefabs, which is most scenes. */
const plain = (templates: EntityTemplate[]) =>
  expandPrefabs(sceneWith(templates), { get: () => undefined });

describe('flattening the tree', () => {
  it('indents a child under its parent', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];

    const rows = buildRows(plain([parent, child]), NONE, '');
    expect(rows.map((row) => [row.entity.name, row.depth])).toEqual([
      ['Parent', 0],
      ['Child', 1],
    ]);
  });

  it('keeps a collapsed node but not its children', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];

    const rows = buildRows(plain([parent, child]), new Set([parent.entity.id]), '');
    expect(rows.map((row) => row.entity.name)).toEqual(['Parent']);
    // Still marked as having children, or there would be nothing to expand.
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it('flattens to matches when filtering, wherever they are', () => {
    const parent = createEntity('Ground');
    const child = createEntity('Lamp post');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];

    // Hiding a match behind a collapsed ancestor would make the filter useless,
    // so a filtered list is flat.
    const rows = buildRows(plain([parent, child]), new Set([parent.entity.id]), 'lamp');
    expect(rows.map((row) => [row.entity.name, row.depth])).toEqual([['Lamp post', 0]]);
  });

  it('matches case-insensitively and ignores surrounding space', () => {
    const rows = buildRows(plain([createEntity('Barrel')]), NONE, '  bAr ');
    expect(rows).toHaveLength(1);
  });
});

describe('rows a prefab produced', () => {
  it("shows an instance's contents under the entity that placed it", () => {
    const trunk = createMeshEntity('cylinder');
    trunk.entity.name = 'Trunk';
    const prefab = prefabWith('Tree', [trunk], trunk.entity.id);
    const host = createEntity('Tree', [createPrefabInstance('tree')]);

    const expanded = expandPrefabs(sceneWith([host]), {
      get: (id) => (id === 'tree' ? prefab : undefined),
    });
    const rows = buildRows(expanded, NONE, '');

    // A prefab you cannot open is a black box, and there is then no way to reach
    // a child to override anything on it.
    expect(rows.map((row) => row.entity.name)).toEqual(['Tree', 'Trunk']);
    expect(rows[0]?.hasChildren).toBe(true);
    expect(rows[1]?.instance).toMatchObject({ owner: host.entity.id });
    expect(rows[1]?.entity.id).toBe(instancedId(host.entity.id, trunk.entity.id));
  });

  it("marks the scene's own entities as not produced", () => {
    const rows = buildRows(plain([createMeshEntity('box')]), NONE, '');
    expect(rows[0]?.instance).toBeNull();
  });
});
