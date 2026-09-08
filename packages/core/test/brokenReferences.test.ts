import {
  createComponent,
  createEntity,
  createMeshEntity,
  findBrokenReferences,
  type MeshComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';

/*
 * A reference to an asset that is gone is an **ordinary state**, not a fault.
 * Deleting an asset something uses is allowed, and the dialog says so — "N
 * things in this project use it. They will keep the reference and show
 * nothing." A scene saved before the delete keeps it too.
 *
 * What is not allowed is for the author to have no way of seeing it. An entity
 * that draws nothing looks exactly like an entity that is not there, and the
 * only clue was a stack trace in the console.
 */

const KNOWN = new Set(['model-1', 'tex-1']);

describe('what a scene names and the project does not have', () => {
  it('names the entity and the id, so both ends of the break are reachable', () => {
    const tree = createEntity('Tree', [{ ...createComponent('model'), assetId: 'gone' }]);

    expect(findBrokenReferences(sceneWith([tree]), KNOWN)).toEqual([
      { entityId: tree.entity.id, assetId: 'gone' },
    ]);
  });

  it('says nothing about an id the project holds', () => {
    const tree = createEntity('Tree', [{ ...createComponent('model'), assetId: 'model-1' }]);

    expect(findBrokenReferences(sceneWith([tree]), KNOWN)).toEqual([]);
  });

  it('leaves an empty slot alone, which is a field nobody filled', () => {
    // `''` is how a material says it has no normal map. Reporting it would put
    // every unfilled slot in the project on the list.
    const box = createMeshEntity('box');
    (box.components[0] as MeshComponent).material.normalMap = '';

    expect(findBrokenReferences(sceneWith([box]), KNOWN)).toEqual([]);
  });

  it('reads texture slots inside a mesh material, not only whole-asset ids', () => {
    const box = createMeshEntity('box');
    (box.components[0] as MeshComponent).material.colorMap = 'tex-1';
    (box.components[0] as MeshComponent).material.aoMap = 'burnt';

    expect(findBrokenReferences(sceneWith([box]), KNOWN)).toEqual([
      { entityId: box.entity.id, assetId: 'burnt' },
    ]);
  });

  it('counts one entity naming one missing id once, however many slots name it', () => {
    // A material reusing a single image as its colour and its ambient occlusion
    // map is one broken reference to fix, not two to read past.
    const box = createMeshEntity('box');
    (box.components[0] as MeshComponent).material.colorMap = 'burnt';
    (box.components[0] as MeshComponent).material.aoMap = 'burnt';

    expect(findBrokenReferences(sceneWith([box]), KNOWN)).toHaveLength(1);
  });

  it('finds the environment, which is not an entity and carries no component', () => {
    // The blind spot that once shipped a build with no sky: the component walk
    // cannot reach the environment, so it is asked separately.
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment = { ...scene.environment, backgroundTexture: 'sky-gone' };

    expect(findBrokenReferences(scene, KNOWN)).toEqual([
      { entityId: null, assetId: 'sky-gone' },
    ]);
  });

  it('reports every entity separately when several name the same missing asset', () => {
    const one = createEntity('A', [{ ...createComponent('model'), assetId: 'gone' }]);
    const two = createEntity('B', [{ ...createComponent('model'), assetId: 'gone' }]);

    const broken = findBrokenReferences(sceneWith([one, two]), KNOWN);
    expect(broken.map((entry) => entry.entityId).sort()).toEqual(
      [one.entity.id, two.entity.id].sort(),
    );
  });

  it('finds nothing in a scene that names nothing', () => {
    expect(findBrokenReferences(sceneWith([createEntity('Empty')]), new Set())).toEqual([]);
  });
});
