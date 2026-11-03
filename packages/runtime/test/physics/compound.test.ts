import {
  createColliderShape,
  createComponent,
  createEntity,
  createMeshEntity,
  type ColliderComponent,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  block,
  colliderOf,
  ground,
  nest,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
} from './rig';

/*
 * A body is every collider that rides it: its entity's own, and those of its
 * descendants with no body of their own, each built where it is drawn.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A collider of this shape, solid unless it is a sensor. */
function collider(shape: ColliderComponent['shape'], isSensor = false): ColliderComponent {
  return { ...createComponent('collider'), shape, isSensor };
}

describe('a compound body', () => {
  it('carries a child’s collider down with its parent, and leaves nothing in mid-air', async () => {
    // Audit E: the child was a fixed body of its own, and held up what fell on
    // it where nothing was drawn.
    const parent = withBody('box', [0, 3, 0], { lockRotation: [true, true, true] });
    const child = withCollider('sphere', [0.8, 0, 0]);
    nest(parent, child);
    const probe = withBody('sphere', [0.8, 6, 0]);
    const rig = await physicsRig([ground(), parent, child, probe]);

    rig.run(3);

    expect(rig.engine.physics?.body(child.entity.id)).toBeNull();
    expect(Math.abs(rig.solved(parent.entity.id).position.y - 0.5)).toBeLessThan(0.02);
    // It lands on the child, and rolls off it to the ground.
    expect(rig.solved(probe.entity.id).position.y).toBeLessThan(2.5);
  });

  it('holds what lands on either of two colliders on one entity', async () => {
    const steps = createEntity('Steps', [
      collider({ ...createColliderShape('box'), size: [2, 1, 2], center: [-2, 0.5, 0] }),
      collider({ ...createColliderShape('box'), size: [2, 2, 2], center: [2, 1, 0] }),
    ]);
    const low = withBody('sphere', [-2, 4, 0]);
    const high = withBody('sphere', [2, 4, 0]);
    const rig = await physicsRig([steps, low, high]);

    rig.run(2);

    expect(Math.abs(rig.solved(low.entity.id).position.y - 1.5)).toBeLessThan(0.02);
    expect(Math.abs(rig.solved(high.entity.id).position.y - 2.5)).toBeLessThan(0.02);
  });

  it('builds a child’s collider where it is drawn, under its parent’s turn and scale', async () => {
    const parent = createEntity('Parent', [
      { ...createComponent('rigidbody'), lockRotation: [true, true, true] },
    ]);
    parent.entity.transform.position = [0, 3, 0];
    parent.entity.transform.rotation = [0, 0, Math.PI / 2];
    parent.entity.transform.scale = [2, 2, 2];
    const child = createEntity('Child', [
      collider({ ...createColliderShape('box'), center: [0.5, 0, 0] }),
    ]);
    child.entity.transform.position = [-1, 0, 0];
    nest(parent, child);
    const rig = await physicsRig([ground(), parent, child]);

    rig.run(2);

    // Turned and scaled with its parent, the child sits 2 m below it, and its
    // box, 2 m across, 1 m above the child: the box's bottom is the child's
    // origin. Without the parent's turn the parent rested at 1.
    expect(Math.abs(rig.solved(parent.entity.id).position.y - 2)).toBeLessThan(0.02);
    expect(Math.abs(rig.drawn(child.entity.id).position.y)).toBeLessThan(0.02);
  });

  it('is under a shear the shape of its entity’s decomposed pose', async () => {
    // Turned inside a parent scaled unevenly, the entity's world matrix is
    // sheared, and three decomposes it into a rotation 0.933 long: Rapier
    // stretched the centre it turned by its square, and held the ball at 2.82.
    const stretched = createEntity('Stretched');
    stretched.entity.transform.scale = [10, 1, 1];
    const turned = createEntity('Turned', [
      collider({ ...createColliderShape('box'), center: [0, 2, 0] }),
    ]);
    turned.entity.transform.rotation = [0, Math.PI / 4, 0];
    nest(stretched, turned);
    const probe = withBody('sphere', [0, 6, 0]);
    const rig = await physicsRig([stretched, turned, probe]);

    rig.run(2);

    expect(Math.abs(rig.solved(probe.entity.id).position.y - 3)).toBeLessThan(0.01);
  });

  it('weighs no sensor: a ball carrying a large one to its side stays where it is', async () => {
    const ball = withBody('sphere', [0, 0.5, 0]);
    ball.components.push(
      collider({ ...createColliderShape('sphere'), radius: 1, center: [3, 0, 0] }, true),
    );
    const rig = await physicsRig([ground(), ball]);

    rig.run(2);

    // Weighed, the sensor rolled the ball 1.25 m.
    expect(Math.abs(rig.solved(ball.entity.id).position.x)).toBeLessThan(0.01);
  });

  it('weighs its Rigid Body’s mass however many colliders share it', async () => {
    const body = createEntity('Body', [{ ...createComponent('rigidbody'), mass: 12 }]);
    const sensor = withCollider('sphere', [0, 2, 0]);
    colliderOf(sensor).isSensor = true;
    const parts = [
      withCollider('box', [-2, 0, 0]),
      withCollider('sphere', [0, 0, 0]),
      withCollider('icosahedron', [2, 0, 0]),
      sensor,
    ];
    nest(body, ...parts);
    const rig = await physicsRig([body, ...parts]);

    expect(rig.engine.physics?.body(body.entity.id)?.mass).toBeCloseTo(12, 4);
  });

  it('lets a player walk with a collider riding its body', async () => {
    const walker = player([0, 1, 0]);
    // 0.1 m in front of the capsule.
    const held = block([0, 0, -0.6], [0.4, 0.4, 0.4]);
    nest(walker, held);
    const rig = await physicsRig([ground(), walker, held]);

    rig.run(0.5);
    const start = rig.solved(walker.entity.id).position.z;
    rig.press('KeyW');
    rig.run(1);

    expect(start - rig.solved(walker.entity.id).position.z).toBeGreaterThan(4);
  });

  it('builds a Triangles mesh on a child of a dynamic body as its hull, and names the body', async () => {
    const cart = createEntity('Cart', [createComponent('rigidbody')]);
    cart.entity.transform.position = [0, 0.15, 0];
    const torus = withCollider('torus', [0, 0, 0]);
    torus.entity.transform.rotation = [-Math.PI / 2, 0, 0];
    colliderOf(torus).shape = { kind: 'mesh', build: 'triangles' };
    nest(cart, torus);
    const ball = withBody('sphere', [0, 1, 0]);
    ball.entity.transform.scale = [0.2, 0.2, 0.2];
    const rig = await physicsRig([ground(), cart, torus, ball]);

    rig.run(2);

    // The hull's top is at 0.3, so the ball rests about 0.4 up.
    expect(rig.solved(ball.entity.id).position.y).toBeGreaterThan(0.3);
    const said = rig.engine.warnings.filter((line) => line.includes('"Torus"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('"Cart"');
  });
});

describe('a mesh collider', () => {
  it('is built from its own entity’s meshes, not its children’s', async () => {
    const base = withCollider('box', [0, 0.5, 0]);
    colliderOf(base).shape = { kind: 'mesh', build: 'hull' };
    // Drawn 3 m above the base, with no collider of its own.
    const above = createMeshEntity('box');
    above.entity.transform.position = [0, 3, 0];
    nest(base, above);
    const probe = withBody('sphere', [0, 6, 0]);
    const rig = await physicsRig([base, above, probe]);

    rig.run(2);

    // The base's hull took the cube above in, rose to 4, and held the probe at 4.5.
    expect(Math.abs(rig.solved(probe.entity.id).position.y - 1.5)).toBeLessThan(0.02);
  });

  it('is warned about on an entity that draws nothing of its own, with the fix', async () => {
    const shelf = createEntity('Shelf', [collider(createColliderShape('mesh'))]);
    const cube = createMeshEntity('box');
    nest(shelf, cube);
    const rig = await physicsRig([shelf, cube]);

    const said = rig.engine.warnings.filter((line) => line.includes('"Shelf"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("its children's");
  });
});
