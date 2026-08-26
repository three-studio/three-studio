import {
  cloneSubtree,
  createEntity,
  createMeshEntity,
  cycles,
  collectDescendants,
  deserializeScene,
  insertEntity,
  isAncestorOf,
  linkEntity,
  removeSubtree,
  reparentEntity,
  serializeScene,
  unlinkEntity,
  validateHierarchy,
  type EntityTemplate,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';

/*
 * The hierarchy is stored three times over — `child.entity.parent`, `parent.entity.children[]`
 * and `scene.rootOrder` — which is what makes reparenting O(1) and immer patches
 * shallow. Until this module existed the only thing checking that the three
 * agreed was `repairHierarchy`, at load time, so an edit that broke an edge
 * stayed broken until the next open quietly healed it. That is B1.
 *
 * Every function refuses rather than corrupts, and returns rather than throws:
 * they run inside immer producers, where an exception leaves the draft
 * half-applied and the message reaches nobody.
 */

/** A parent with one child, the smallest shape that has an edge to break. */
function pair(): { parent: EntityTemplate; child: EntityTemplate } {
  const parent = createEntity('Parent');
  const child = createEntity('Child');
  child.entity.parent = parent.entity.id;
  parent.entity.children = [child.entity.id];
  return { parent, child };
}

describe('refusing an edit rather than corrupting the tree', () => {
  it('refuses a parent the document does not contain', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    // The hierarchy shows rows prefab expansion produced, and their ids
    // (`owner/local`) name nothing in the document. This is B1 exactly: the move
    // used to leave the cube with a parent that does not exist and in no
    // children list at all — gone from the tree, still drawn in the viewport.
    expect(reparentEntity(scene, cube.entity.id, 'someInstance/root')).toBe(false);
    expect(scene.entities[cube.entity.id]?.parent).toBeNull();
    expect(scene.rootOrder).toContain(cube.entity.id);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('refuses to move an entity a prefab produced', () => {
    const parent = createEntity('Parent');
    const scene = sceneWith([parent]);

    // What a prefab places is not the scene's to move: the next expansion would
    // put it straight back where the asset says.
    expect(reparentEntity(scene, 'someInstance/root', parent.entity.id)).toBe(false);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('refuses to reparent an entity under its own descendant', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    expect(reparentEntity(scene, parent.entity.id, child.entity.id)).toBe(false);
    expect(scene.entities[parent.entity.id]?.parent).toBeNull();
    expect(scene.entities[child.entity.id]?.parent).toBe(parent.entity.id);
  });

  it('refuses to make an entity its own parent', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    expect(reparentEntity(scene, cube.entity.id, cube.entity.id)).toBe(false);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('leaves the entity linked when the move is refused', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    // The point of checking before unlinking: a refusal found halfway through
    // would leave the entity in no list, which is the very state B1 produces.
    reparentEntity(scene, child.entity.id, 'gone');
    expect(scene.entities[parent.entity.id]?.children).toEqual([child.entity.id]);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('refuses to insert an id the document already holds', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    expect(insertEntity(scene, cube)).toBe(false);
    expect(scene.rootOrder).toEqual([cube.entity.id]);
  });

  it('refuses to insert under a parent that is not there, and adds nothing', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([]);

    expect(insertEntity(scene, cube, 'gone')).toBe(false);
    // Half-inserted is worse than not inserted: an entity in the table and in no
    // list is exactly what nothing can reach.
    expect(scene.entities[cube.entity.id]).toBeUndefined();
    expect(validateHierarchy(scene)).toEqual([]);
  });
});

describe('moving entities about', () => {
  it('links at an index, and at the end by default', () => {
    const a = createEntity('A');
    const b = createEntity('B');
    const c = createEntity('C');
    const scene = sceneWith([a, b, c]);

    unlinkEntity(scene, c.entity.id);
    linkEntity(scene, c.entity.id, null, 1);
    expect(scene.rootOrder).toEqual([a.entity.id, c.entity.id, b.entity.id]);

    unlinkEntity(scene, c.entity.id);
    linkEntity(scene, c.entity.id, null, 99);
    expect(scene.rootOrder).toEqual([a.entity.id, b.entity.id, c.entity.id]);
  });

  it('moves between parents, updating all three copies of the edge', () => {
    const { parent, child } = pair();
    const other = createEntity('Other');
    const scene = sceneWith([parent, child, other]);

    expect(reparentEntity(scene, child.entity.id, other.entity.id)).toBe(true);
    expect(scene.entities[child.entity.id]?.parent).toBe(other.entity.id);
    expect(scene.entities[other.entity.id]?.children).toEqual([child.entity.id]);
    expect(scene.entities[parent.entity.id]?.children).toEqual([]);
    expect(scene.rootOrder).not.toContain(child.entity.id);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('unparents to the root', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    expect(reparentEntity(scene, child.entity.id, null)).toBe(true);
    expect(scene.rootOrder).toEqual([parent.entity.id, child.entity.id]);
    expect(validateHierarchy(scene)).toEqual([]);
  });
});

describe('removing a subtree', () => {
  it('hands back every id it deleted, root first', () => {
    const { parent, child } = pair();
    const grandchild = createEntity('Grandchild');
    grandchild.entity.parent = child.entity.id;
    scenePush(child, grandchild);
    const scene = sceneWith([parent, child, grandchild]);

    const removed = removeSubtree(scene, parent.entity.id);

    // The caller needs the list: the selection is what holds onto ids of
    // entities that no longer exist, which is B2.
    expect(removed).toHaveLength(3);
    expect(removed[0]).toBe(parent.entity.id);
    expect(new Set(removed)).toEqual(new Set([parent.entity.id, child.entity.id, grandchild.entity.id]));
    expect(Object.keys(scene.entities)).toEqual([]);
    expect(scene.rootOrder).toEqual([]);
  });

  it('takes the entity out of its parent, not just out of the table', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    removeSubtree(scene, child.entity.id);
    expect(scene.entities[parent.entity.id]?.children).toEqual([]);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('refuses an id the document does not hold, and says so', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    expect(removeSubtree(scene, 'gone')).toEqual([]);
    expect(removeSubtree(scene, 'someInstance/root')).toEqual([]);
  });
});

describe('cloning a subtree', () => {
  it('copies the whole tree under fresh ids', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    const copyId = cloneSubtree(scene, parent.entity.id, null, 'Parent (1)');
    const copy = copyId === null ? undefined : scene.entities[copyId];

    expect(copy?.name).toBe('Parent (1)');
    expect(copy?.children).toHaveLength(1);
    expect(copy?.children[0]).not.toBe(child.entity.id);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('names only the root, leaving descendants as they were', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);

    const copyId = cloneSubtree(scene, parent.entity.id, null, 'Parent (1)');
    const childCopyId = copyId === null ? undefined : scene.entities[copyId]?.children[0];

    // What Unity and Blender do. Renaming every node was also how the copy paid
    // O(N) per cloned entity for a fresh name — one of phase 7's costs.
    expect(childCopyId === undefined ? undefined : scene.entities[childCopyId]?.name).toBe('Child');
  });

  it('copies deeply, so editing the copy does not reach the original', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    const copyId = cloneSubtree(scene, cube.entity.id, null, 'Copy');
    const copy = copyId === null ? undefined : scene.entities[copyId];
    if (copy) copy.transform.position[0] = 42;

    expect(scene.entities[cube.entity.id]?.transform.position[0]).toBe(0);
  });
});

/*
 * `validateHierarchy` is wired as a DEV assertion after every mutation, so these
 * are the messages a future regression will print. The documents are broken by
 * hand: writing them in the shape a bug produces is the only way to know the
 * check would have caught it.
 */
describe('validating a document broken by hand', () => {
  it('is silent on a sound one', () => {
    const { parent, child } = pair();
    expect(validateHierarchy(sceneWith([parent, child]))).toEqual([]);
  });

  it('names an entity that is in no list at all', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    scene.rootOrder = [];

    // The shape B1 produced, and the reason it was invisible: unreachable from
    // `rootOrder`, so the hierarchy does not draw it, while the binder still does.
    expect(validateHierarchy(scene)).toEqual([
      expect.stringContaining('in no children list and not in rootOrder'),
    ]);
  });

  it('names a parent that does not list its child back', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);
    scene.entities[parent.entity.id]!.children = [];

    expect(validateHierarchy(scene).join('\n')).toContain('which does not list it');
  });

  it('names a dangling child reference', () => {
    const parent = createEntity('Parent');
    parent.entity.children = ['ghost'];
    const scene = sceneWith([parent]);

    expect(validateHierarchy(scene).join('\n')).toContain('not in the table');
  });

  it('catches an entity held by two lists', () => {
    const { parent, child } = pair();
    const scene = sceneWith([parent, child]);
    scene.rootOrder.push(child.entity.id);

    expect(validateHierarchy(scene).join('\n')).toContain('appears in 2 lists');
  });

  it('catches a cycle, which dangling-reference checks cannot see', () => {
    const a = createEntity('A');
    const b = createEntity('B');
    a.entity.parent = b.entity.id;
    b.entity.children = [a.entity.id];
    b.entity.parent = a.entity.id;
    a.entity.children = [b.entity.id];
    const scene = sceneWith([a, b]);

    // Every edge points at an entity that exists, which is why `repairHierarchy`
    // never found one by filtering.
    expect(validateHierarchy(scene).join('\n')).toContain('cycle:');
    expect(cycles(scene)).toHaveLength(1);
  });
});

describe('walking a document that contains a cycle', () => {
  it('does not hang', () => {
    const a = createEntity('A');
    const b = createEntity('B');
    a.entity.parent = b.entity.id;
    b.entity.children = [a.entity.id];
    b.entity.parent = a.entity.id;
    a.entity.children = [b.entity.id];
    const scene = sceneWith([a, b]);

    // Reachable by hand-editing a file. An editor that freezes on open is worse
    // than one that shows the file repaired.
    expect(collectDescendants(scene, a.entity.id)).toEqual([b.entity.id]);
    expect(isAncestorOf(scene, 'nobody', a.entity.id)).toBe(false);
  });

  it('is repaired on load rather than refused', () => {
    const a = createEntity('A');
    const b = createEntity('B');
    a.entity.parent = b.entity.id;
    b.entity.children = [a.entity.id];
    b.entity.parent = a.entity.id;
    a.entity.children = [b.entity.id];

    // At load the document is already this shape on disk, so healing is right
    // here and refusing is not: the alternative is a project that will not open.
    const loaded = deserializeScene(serializeScene(sceneWith([a, b])));

    expect(validateHierarchy(loaded)).toEqual([]);
    expect(loaded.rootOrder.length).toBeGreaterThan(0);
  });
});

/** Parents `child` under `parent`, both ways, so the fixture stays consistent. */
function scenePush(parent: EntityTemplate, child: EntityTemplate): void {
  child.entity.parent = parent.entity.id;
  parent.entity.children = [...parent.entity.children, child.entity.id];
}
