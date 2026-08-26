import { entitiesFromNodes, type ModelNode, type Transform } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * Turning one imported file into one entity per node.
 *
 * The half of `unpackModel` with no three.js in it, which is why it is testable
 * at all: the walk that reads an `Object3D` lives in `packages/runtime` and
 * hands back the plain description these tests write by hand.
 */

const identity = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const node = (partial: Partial<ModelNode> & Pick<ModelNode, 'path' | 'parentPath'>): ModelNode => ({
  name: '',
  transform: identity(),
  draws: false,
  ...partial,
});

/** The shape a dressed glTF actually arrives in: wrapper, scene, meshes. */
function chairNodes(): ModelNode[] {
  return [
    // The import wrapper, carrying the scale the author chose.
    node({
      path: '0',
      parentPath: null,
      name: 'Chair',
      transform: { ...identity(), scale: [0.01, 0.01, 0.01] },
    }),
    // The glTF scene node: draws nothing, sits at the origin, one child.
    node({ path: '0.0', parentPath: '0', name: 'Scene' }),
    node({
      path: '0.0.0',
      parentPath: '0.0',
      name: 'Seat',
      draws: true,
      transform: { ...identity(), position: [0, 0.45, 0] },
    }),
    node({ path: '0.0.1', parentPath: '0.0', name: 'Leg', draws: true }),
  ];
}

describe('entitiesFromNodes', () => {
  it('gives every drawing node a model naming its own path', () => {
    const unpacked = entitiesFromNodes(chairNodes(), 'chair-asset', 'Chair');

    const seat = unpacked.find((item) => item.template.entity.name === 'Seat');
    expect(seat?.template.components).toEqual([
      expect.objectContaining({
        type: 'model',
        assetId: 'chair-asset',
        nodePath: '0.0.0',
        nodeName: 'Seat',
        materialId: null,
      }),
    ]);
  });

  it('carries the node transform on the entity, not on the component', () => {
    const unpacked = entitiesFromNodes(chairNodes(), 'chair-asset', 'Chair');

    // Which is what makes the piece movable, and why `ModelCache.loadNode`
    // resets the clone's own transform: applied at both ends it would be
    // applied twice.
    const seat = unpacked.find((item) => item.template.entity.name === 'Seat');
    expect(seat?.template.entity.transform.position).toEqual([0, 0.45, 0]);
  });

  it('keeps the root, because it carries the import scale', () => {
    const unpacked = entitiesFromNodes(chairNodes(), 'chair-asset', 'Chair');

    const root = unpacked[0];
    expect(root?.parentId).toBeNull();
    expect(root?.template.entity.transform.scale).toEqual([0.01, 0.01, 0.01]);
    // A wrapper draws nothing, so it gets no component: a `model` naming a path
    // with no geometry would load the file to produce an empty object.
    expect(root?.template.components).toEqual([]);
  });

  it('folds a single-child pass-through so its child lands where it did', () => {
    const nodes = chairNodes();
    nodes.pop();
    // `Scene` now draws nothing, sits at the origin and holds one node, so it
    // exists only to hold it. Three nodes, two entities.
    const unpacked = entitiesFromNodes(nodes, 'chair-asset', 'Chair');

    expect(unpacked.map((item) => item.template.entity.name)).toEqual(['Chair', 'Seat']);
    expect(unpacked[1]?.parentId).toBe(unpacked[0]?.template.entity.id);
    // And it still names its own node, not the one that was folded away.
    expect(unpacked[1]?.template.components[0]).toMatchObject({ nodePath: '0.0.0' });
  });

  it('keeps an empty node that groups several, which is a structure', () => {
    // The same node, now with two children. Folding it is exact — it is at the
    // origin — and would flatten a grouping the author put there and recognises.
    const unpacked = entitiesFromNodes(chairNodes(), 'chair-asset', 'Chair');

    expect(unpacked.map((item) => item.template.entity.name)).toEqual([
      'Chair',
      'Scene',
      'Seat',
      'Leg',
    ]);
  });

  it('keeps a node that transforms its children, however empty', () => {
    const nodes = chairNodes();
    // The same pass-through, now moved. Folding it would need its matrix
    // composed into its child's, and this package has no maths in it.
    nodes[1] = node({
      path: '0.0',
      parentPath: '0',
      name: 'Pivot',
      transform: { ...identity(), position: [1, 0, 0] },
    });
    const unpacked = entitiesFromNodes(nodes, 'chair-asset', 'Chair');

    expect(unpacked.map((item) => item.template.entity.name)).toEqual([
      'Chair',
      'Pivot',
      'Seat',
      'Leg',
    ]);
  });

  it('hands them back parents before children', () => {
    // The contract the caller relies on: `insertEntity` refuses a parent the
    // document does not hold yet, so one pass in this order is the whole
    // insertion.
    const unpacked = entitiesFromNodes(chairNodes(), 'chair-asset', 'Chair');

    const seen = new Set<string>();
    for (const { template, parentId } of unpacked) {
      if (parentId !== null) expect(seen.has(parentId)).toBe(true);
      seen.add(template.entity.id);
    }
  });

  it('names an unnamed root after the entity it replaces', () => {
    const nodes = chairNodes();
    nodes[0] = node({ path: '0', parentPath: null });
    const unpacked = entitiesFromNodes(nodes, 'chair-asset', 'Old Chair');

    expect(unpacked[0]?.template.entity.name).toBe('Old Chair');
  });
});
