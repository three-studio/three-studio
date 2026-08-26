import { createEntity, createMeshEntity, instancedId, type EntityTemplate } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { Selection } from '../src/state/selection';

/*
 * The selection as a value: who is selected, which subset an action targets, and
 * what is possible at all. Six questions that used to be re-asked in eight files.
 */

/** Parent with one child, both in the scene, edges consistent. */
function family(): { parent: EntityTemplate; child: EntityTemplate } {
  const parent = createEntity('Parent');
  const child = createEntity('Child');
  child.entity.parent = parent.entity.id;
  parent.entity.children = [child.entity.id];
  return { parent, child };
}

describe('counting', () => {
  it('names the three cases nobody had named', () => {
    const a = createMeshEntity('box');
    const b = createMeshEntity('sphere');
    const scene = sceneWith([a, b]);

    expect(Selection.of([], scene).isEmpty).toBe(true);
    expect(Selection.of([a.entity.id], scene).isSingle).toBe(true);
    expect(Selection.of([a.entity.id, b.entity.id], scene).isMultiple).toBe(true);
    expect(Selection.of([a.entity.id, b.entity.id], scene).size).toBe(2);
  });

  it('takes the last picked as primary, which is what the gizmo drives', () => {
    const a = createMeshEntity('box');
    const b = createMeshEntity('sphere');
    const scene = sceneWith([a, b]);

    expect(Selection.of([a.entity.id, b.entity.id], scene).primary).toBe(b.entity.id);
    expect(Selection.empty().primary).toBeNull();
  });

  it('answers membership without scanning', () => {
    const a = createMeshEntity('box');
    const scene = sceneWith([a]);
    const selection = Selection.of([a.entity.id], scene);

    expect(selection.has(a.entity.id)).toBe(true);
    expect(selection.has('nobody')).toBe(false);
  });

  it('drops ids the scene no longer holds', () => {
    const a = createMeshEntity('box');
    const scene = sceneWith([a]);

    expect(Selection.of([a.entity.id, 'ghost'], scene).ids).toEqual([a.entity.id]);
  });
});

describe('the named filters', () => {
  it('keeps only the tops of the selection', () => {
    const { parent, child } = family();
    const loose = createMeshEntity('box');
    const scene = sceneWith([parent, child, loose]);

    // Grouping a node together with its own child would move the child twice.
    expect(Selection.of([parent.entity.id, child.entity.id, loose.entity.id], scene).roots()).toEqual([
      parent.entity.id,
      loose.entity.id,
    ]);
  });

  it('keeps a child whose parent is not selected', () => {
    const { parent, child } = family();
    const scene = sceneWith([parent, child]);

    expect(Selection.of([child.entity.id], scene).roots()).toEqual([child.entity.id]);
  });

  it('separates what the document holds from what a prefab produced', () => {
    const host = createEntity('Host');
    const produced = createEntity('Trunk');
    // As the expanded scene has it: a real entity under an instanced id.
    Object.defineProperty(produced.entity, 'id', {
      value: instancedId(host.entity.id, 'trunk'),
    });
    const scene = sceneWith([host, produced]);

    const selection = Selection.of([host.entity.id, produced.entity.id], scene);
    expect(selection.documentOnly()).toEqual([host.entity.id]);
    expect(selection.ids).toHaveLength(2);
  });

  it('excludes a locked entity from what can be transformed', () => {
    const a = createMeshEntity('box');
    const locked = createMeshEntity('sphere');
    locked.entity.locked = true;
    const scene = sceneWith([a, locked]);

    expect(Selection.of([a.entity.id, locked.entity.id], scene).transformable()).toEqual([a.entity.id]);
  });

  it('excludes a child of the selection from what can be transformed', () => {
    const { parent, child } = family();
    const scene = sceneWith([parent, child]);

    // Moving both would move the child twice: once itself, once under its parent.entity.
    expect(Selection.of([parent.entity.id, child.entity.id], scene).transformable()).toEqual([parent.entity.id]);
  });
});

describe('asking what is possible', () => {
  it('is false as soon as one member cannot', () => {
    const a = createMeshEntity('box');
    const locked = createMeshEntity('sphere');
    locked.entity.locked = true;
    const scene = sceneWith([a, locked]);

    // Intersection, not union: Unity does the same, and moving "all but one"
    // without saying so is worse than refusing.
    expect(Selection.of([a.entity.id], scene).can('translate')).toBe(true);
    expect(Selection.of([a.entity.id, locked.entity.id], scene).can('translate')).toBe(false);
    expect(Selection.of([a.entity.id, locked.entity.id], scene).can('rename')).toBe(true);
  });

  it('says no to everything when nothing is selected', () => {
    // An intersection over an empty set is vacuously true, which would light up
    // every menu entry with nothing selected.
    for (const capability of ['translate', 'delete', 'rename', 'duplicate'] as const) {
      expect(Selection.empty().can(capability), capability).toBe(false);
    }
  });
});

describe('memoisation', () => {
  it('hands back the same object while neither the ids nor the scene move', () => {
    const a = createMeshEntity('box');
    const scene = sceneWith([a]);
    const ids = [a.entity.id];

    // A hierarchy row asks `has()` once per render; a fresh Set and filter per
    // call would be the very O(n) per row this class removes.
    expect(Selection.of(ids, scene)).toBe(Selection.of(ids, scene));
  });

  it('rebuilds when the scene changes under the same ids', () => {
    const a = createMeshEntity('box');
    const ids = [a.entity.id];
    const first = Selection.of(ids, sceneWith([a]));

    // Immer hands back a new scene object for a real edit, and that is the
    // signal: the capabilities derived from it may differ now.
    expect(Selection.of(ids, sceneWith([a]))).not.toBe(first);
  });

  it('compares by content, not by identity', () => {
    const a = createMeshEntity('box');
    const b = createMeshEntity('sphere');
    const scene = sceneWith([a, b]);

    expect(Selection.of([a.entity.id, b.entity.id], scene).equals(Selection.of([b.entity.id, a.entity.id], scene))).toBe(true);
    expect(Selection.of([a.entity.id], scene).equals(Selection.of([a.entity.id, b.entity.id], scene))).toBe(false);
  });
});
