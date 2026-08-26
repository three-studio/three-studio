import { Group, Mesh, BoxGeometry, MeshBasicNodeMaterial, SkinnedMesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { describeNodes, resolveNode } from '../../src/assets/modelNodes';

/*
 * Reading the shape of a loaded model, and finding one node of it again.
 *
 * The half of `unpackModel` that touches three.js. What it hands back is plain
 * data, which is what lets `entitiesFromNodes` — and its tests — live in
 * `packages/core`, a package that may not import three at all.
 */

/** A dressed model as `ModelCache` caches one: wrapper, scene, two meshes. */
function chair(): Group {
  const wrapper = new Group();
  wrapper.name = 'Chair';
  wrapper.scale.setScalar(0.01);

  const scene = new Group();
  scene.name = 'Scene';
  wrapper.add(scene);

  const seat = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  seat.name = 'Seat';
  seat.position.set(0, 0.45, 0);
  const leg = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  leg.name = 'Leg';
  scene.add(seat, leg);

  return wrapper;
}

describe('describeNodes', () => {
  it('numbers the root 0 and its children after it', () => {
    const { nodes } = describeNodes(chair());

    // `''` already means "the whole file" on the component, so the root cannot
    // also be the empty path — a file whose loaded root happens to draw would
    // otherwise have no way to say "just that".
    expect(nodes.map((node) => node.path)).toEqual(['0', '0.0', '0.0.0', '0.0.1']);
    expect(nodes.map((node) => node.parentPath)).toEqual([null, '0', '0.0', '0.0']);
  });

  it('reports the local transform, not the world one', () => {
    const { nodes } = describeNodes(chair());

    // The entity that replaces the node carries it, and the entity above
    // carries its parent's — so a world matrix here would be applied twice.
    expect(nodes[0]?.transform.scale).toEqual([0.01, 0.01, 0.01]);
    expect(nodes[2]?.transform.position).toEqual([0, 0.45, 0]);
  });

  it('says which nodes draw for themselves, not which contain something that does', () => {
    const { nodes } = describeNodes(chair());

    // Itself, not its subtree: a drawing node with children becomes an entity
    // that draws and has child entities, each drawing its own node. Asking
    // about the subtree would draw every child twice.
    expect(nodes.map((node) => node.draws)).toEqual([false, false, true, true]);
  });

  it('reports a skinned tree, which cannot be taken apart', () => {
    const plain = describeNodes(chair());
    expect(plain.skinned).toBe(false);

    const wrapper = chair();
    wrapper.add(new SkinnedMesh(new BoxGeometry(), new MeshBasicNodeMaterial()));
    // A skin reads its pose from bones elsewhere in the same tree, by object
    // reference. Split across containers it collapses into a heap at the origin.
    expect(describeNodes(wrapper).skinned).toBe(true);
  });
});

describe('resolveNode', () => {
  it('finds a node by its path', () => {
    const wrapper = chair();
    expect(resolveNode(wrapper, '0.0.1')?.name).toBe('Leg');
    expect(resolveNode(wrapper, '0')).toBe(wrapper);
  });

  it('falls back to the name when the tree has moved under the path', () => {
    const wrapper = chair();
    const scene = wrapper.children[0]!;
    // What turning glTF lights back on after the scene was written does: a node
    // is inserted and every index after it slides along.
    scene.add(scene.children.shift()!);

    // The index now lands on `Leg`, so the stored path alone would silently
    // draw the wrong piece. The name is checked, not trusted.
    expect(resolveNode(wrapper, '0.0.0', 'Seat')?.name).toBe('Seat');
  });

  it('answers null rather than guessing when neither finds anything', () => {
    const wrapper = chair();
    expect(resolveNode(wrapper, '0.9.9', 'Armrest')).toBeNull();
    expect(resolveNode(wrapper, 'nonsense')).toBeNull();
  });
});
