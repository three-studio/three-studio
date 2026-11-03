import {
  createColliderShape,
  createComponent,
  createEntity,
  createDefaultLayer,
  type ColliderComponent,
  type CollisionLayer,
  type EntityTemplate,
  type PhysicsSettings,
} from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhysicsApi, RaycastHit, Vec3Like } from '../../src/physics/PhysicsApi';
import {
  block,
  ground,
  nest,
  onLayer,
  physicsRig,
  sensor,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  type PhysicsRig,
} from './rig';

/*
 * A query asks the world what is where, as a behaviour asks it: through
 * `engine.physics`.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A wall across the way, its face at z = −4.5. */
const near = () => block([0, 1, -5], [2, 2, 1]);
/** One behind it, its face at z = −9.5. */
const far = () => block([0, 1, -10], [2, 2, 1]);

/** A kinematic box at z = −2, its faces at −1.5 and −2.5, carrying a ball of its own 1 m ahead, at z = −3. */
function cart(): { cart: EntityTemplate; wheel: EntityTemplate } {
  const cart = withBody('box', [0, 1, -2], { bodyType: 'kinematicPosition' });
  const wheel = withCollider('sphere', [0, 0, -1]);
  nest(cart, wheel);
  return { cart, wheel };
}

const ahead = { x: 0, y: 0, z: -1 };
const down = { x: 0, y: -1, z: 0 };
const identity = { x: 0, y: 0, z: 0, w: 1 };
/** A quarter turn about an axis. */
const quarter = (x: number, y: number, z: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(x, y, z), Math.PI / 2);

/** These entities in a running engine, and the world as a behaviour asks it. */
async function running(
  entities: readonly EntityTemplate[],
  settings?: Partial<PhysicsSettings>,
): Promise<{ rig: PhysicsRig; physics: PhysicsApi }> {
  const rig = await physicsRig(entities, settings);
  const physics = rig.engine.physics;
  if (!physics) throw new Error('The rig runs with physics on.');
  return { rig, physics };
}

function apart(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * How near a cast is read. Rapier's casts are iterative: their distances came
 * within 3e-6 m of the exact ones, but a point on the surface up to 0.8 mm off.
 */
const CAST = 1e-3;

/** The hit met `entity`, and each number given is within `tolerance` of the one read. */
function expectHit(
  hit: RaycastHit | null,
  expected: { entity: EntityTemplate; distance: number; point?: Vec3Like; normal?: Vec3Like },
  tolerance = 1e-6,
): void {
  expect(hit?.entity).toBe(expected.entity.entity.id);
  if (!hit) return;
  expect(Math.abs(hit.distance - expected.distance)).toBeLessThan(tolerance);
  if (expected.point) expect(apart(hit.point, expected.point)).toBeLessThan(tolerance);
  if (expected.normal) expect(apart(hit.normal, expected.normal)).toBeLessThan(tolerance);
}

describe('a ray', () => {
  it('finds the nearest collider in its way: which entity, where, which way it faces, how far', async () => {
    const wall = near();
    const { physics } = await running([wall, far()]);

    // Of length 2: Rapier counts in lengths of the direction, and read 2.25.
    const hit = physics.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -2 }, 20);

    expectHit(hit, { entity: wall, distance: 4.5, point: { x: 0, y: 1, z: -4.5 }, normal: { x: 0, y: 0, z: 1 } });
  });

  it('sees the scene as it was built, before the first tick', async () => {
    const wall = near();
    const { physics } = await running([wall, far()]);

    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
  });

  it('stops at its length, and finds nothing out of its way', async () => {
    const { physics } = await running([near(), far()]);

    expect(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 4)).toBeNull();
    expect(physics.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 20)).toBeNull();
  });

  it('passes out of what it starts inside', async () => {
    const back = far();
    const { physics } = await running([ground(), near(), back]);

    // Rapier's own met the wall it starts in, and the ground it lies on, at 0, facing nowhere.
    expectHit(physics.raycast({ x: 0, y: 1, z: -5 }, ahead, 20), { entity: back, distance: 4.5 });
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 20)).toBeNull();
  });

  it("leaves out the body it is told to, every collider of it, and names the collider's own entity", async () => {
    const wall = near();
    const { cart: box, wheel } = cart();
    const { physics } = await running([box, wheel, wall]);
    const from = { x: 0, y: 1, z: 0 };

    expectHit(physics.raycast(from, ahead, 20), { entity: box, distance: 1.5 });
    expectHit(physics.raycast(from, ahead, 20, { exclude: box.entity.id }), { entity: wall, distance: 4.5 });
    // The body on that entity exactly, and the wheel has none of its own.
    expectHit(physics.raycast(from, ahead, 20, { exclude: wheel.entity.id }), { entity: box, distance: 1.5 });
    // The wheel rides the cart's body, and is named for itself.
    expectHit(physics.raycast({ x: 3, y: 1, z: -3 }, { x: -1, y: 0, z: 0 }, 20), { entity: wheel, distance: 2.5 });
  });

  it('passes through a trigger zone', async () => {
    const wall = near();
    const { physics } = await running([sensor([0, 1, -2.5], [2, 2, 1]), wall]);

    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
  });

  it('sees the world as the last tick left it', async () => {
    const wall = near();
    const ball = withBody('sphere', [0, 1, -3], { gravityScale: 0 });
    const { rig, physics } = await running([wall, ball]);

    rig.body(ball.entity.id).teleport({ x: 5, y: 1, z: -3 });
    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: ball, distance: 2.5 });

    rig.run(1 / 60);
    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
    expectHit(physics.raycast({ x: 5, y: 1, z: 0 }, ahead, 20), { entity: ball, distance: 2.5 });
  });

  it("meets a capsule whatever the line it passes through near its axis: a guard's ray at the player", async () => {
    // Rapier 0.20 let a ray through a capsule close to its axis pass on: 18 of
    // 120 ticks for a guard watching the player walk straight away, and 27 of
    // 400 rays here, a still capsule missed by Rapier alone. 0.21 misses none.
    const target = createEntity('Target', [
      { ...createComponent('collider'), shape: { ...createColliderShape('capsule'), radius: 0.3, height: 1.7 } },
    ]);
    target.entity.transform.position = [0, 0.87, 0];
    const { physics } = await running([target]);

    let missed = 0;
    for (const offset of [0, 1e-5, 7e-5, 1e-3, 1e-2]) {
      for (const aim of [0.87, 1.37]) {
        for (let i = 0; i < 400; i++) {
          const eye = { x: offset, y: 1.6, z: -(2 + i * 0.0157) };
          const hit = physics.raycast(eye, { x: -offset, y: aim - eye.y, z: -eye.z }, 50);
          if (hit?.entity !== target.entity.id) missed++;
        }
      }
    }
    expect(missed).toBe(0);
  });

  it('finds nothing when it is not a number or has no direction', async () => {
    const { physics } = await running([near()]);
    const from = { x: 0, y: 1, z: 0 };

    expect(physics.raycast({ x: Number.NaN, y: 1, z: 0 }, ahead, 20)).toBeNull();
    expect(physics.raycast(from, { x: 0, y: 0, z: 0 }, 20)).toBeNull();
    expect(physics.raycast(from, ahead, Number.NaN)).toBeNull();
    expect(physics.raycast(from, ahead, -1)).toBeNull();
  });
});

describe('a cast', () => {
  it('of a sphere finds the nearest collider it would meet: how far it went, where, which way it faces', async () => {
    const wall = near();
    const { physics } = await running([wall, far()]);

    const hit = physics.sphereCast({ x: 0, y: 1, z: 0 }, 0.25, ahead, 20);

    const face = { x: 0, y: 1, z: -4.5 };
    expectHit(hit, { entity: wall, distance: 4.25, point: face, normal: { x: 0, y: 0, z: 1 } }, CAST);
  });

  it('of a box reads its full size, and turns as it is told', async () => {
    const wall = near();
    const { physics } = await running([wall]);
    const from = { x: 0, y: 1, z: 0 };
    const size = { x: 2, y: 0.2, z: 0.2 };

    // Read as half extents, it would stop at 4.3, and at 2.5 turned.
    expectHit(physics.boxCast(from, size, identity, ahead, 20), { entity: wall, distance: 4.4 }, CAST);
    expectHit(physics.boxCast(from, size, quarter(0, 1, 0), ahead, 20), { entity: wall, distance: 3.5 }, CAST);
  });

  it('of a capsule reads its height from end to end', async () => {
    const floor = ground();
    const { physics } = await running([floor]);
    const from = { x: 10, y: 3, z: 0 };

    // Taken as its straight part alone, it would stop at 1.75.
    const upright = physics.capsuleCast(from, 0.25, 2, identity, down, 10);
    const under = { x: 10, y: 0, z: 0 };
    expectHit(upright, { entity: floor, distance: 2, point: under, normal: { x: 0, y: 1, z: 0 } }, CAST);
    const lying = physics.capsuleCast(from, 0.25, 2, quarter(0, 0, 1), down, 10);
    expectHit(lying, { entity: floor, distance: 2.75 }, CAST);
  });

  it('passes out of what it starts touching: a ball resting on the ground, cast along it, meets the wall', async () => {
    const wall = block([0, 1, -5], [4, 2, 0.2]);
    const { physics } = await running([ground(), wall]);

    // Rapier's own met the ground 4 mm on, facing 45° off.
    const hit = physics.sphereCast({ x: 0, y: 0.25, z: 0 }, 0.25, ahead, 20);

    expectHit(hit, { entity: wall, distance: 4.65, normal: { x: 0, y: 0, z: 1 } }, CAST);
  });
});

describe('an overlap', () => {
  it('finds each entity whose collider is in the sphere or touches it, once', async () => {
    const a = withCollider('sphere', [1, 3, 0]);
    const cube = (x: number): ColliderComponent => ({
      ...createComponent('collider'),
      shape: { ...createColliderShape('box'), size: [0.4, 0.4, 0.4], center: [x, 0, 0] },
    });
    const twin = createEntity('Twin', [cube(-0.3), cube(0.3)]);
    twin.entity.transform.position = [-1, 3, 0];
    const out = withCollider('sphere', [4, 3, 0]);
    const { physics } = await running([ground(), a, twin, out]);

    const found = physics.overlapSphere({ x: 0, y: 3, z: 0 }, 2);

    expect([...found].sort()).toEqual([a.entity.id, twin.entity.id].sort());
  });

  it('of a box reads its full size, and turns as it is told', async () => {
    const east = withCollider('sphere', [2.2, 3, 0]);
    const farEast = withCollider('sphere', [3.2, 3, 0]);
    const north = withCollider('sphere', [0, 3, -2.2]);
    const { physics } = await running([east, farEast, north]);
    const size = { x: 4, y: 0.2, z: 0.2 };

    // Read as half extents, it would reach `farEast` too.
    expect(physics.overlapBox({ x: 0, y: 3, z: 0 }, size)).toEqual([east.entity.id]);
    expect(physics.overlapBox({ x: 0, y: 3, z: 0 }, size, quarter(0, 1, 0))).toEqual([north.entity.id]);
  });
});

describe('a query of a shape', () => {
  it('leaves out the body it is told to', async () => {
    const wall = near();
    const { cart: box, wheel } = cart();
    const { physics } = await running([box, wheel, wall]);
    const between = { x: 0, y: 1, z: -2.5 };

    expect([...physics.overlapSphere(between, 0.9)].sort()).toEqual([box.entity.id, wheel.entity.id].sort());
    expect(physics.overlapSphere(between, 0.9, { exclude: box.entity.id })).toEqual([]);
    const hit = physics.sphereCast({ x: 0, y: 1, z: 0 }, 0.25, ahead, 20, { exclude: box.entity.id });
    expectHit(hit, { entity: wall, distance: 4.25 }, CAST);
  });

  it('finds nothing when it is not a number', async () => {
    const { physics } = await running([near()]);
    const from = { x: 0, y: 1, z: 0 };
    const nowhere = { x: 0, y: 0, z: 0, w: 0 };

    expect(physics.sphereCast(from, Number.NaN, ahead, 20)).toBeNull();
    expect(physics.boxCast(from, { x: 1, y: Number.NaN, z: 1 }, identity, ahead, 20)).toBeNull();
    expect(physics.capsuleCast(from, 0.25, 2, nowhere, ahead, 20)).toBeNull();
    expect(physics.overlapSphere({ x: 0, y: 1, z: -5 }, Number.NaN)).toEqual([]);
    expect(physics.overlapBox({ x: 0, y: 1, z: -5 }, { x: 1, y: 1, z: 1 }, nowhere)).toEqual([]);
  });
});

describe('what a query sees', () => {
  /** Lonely touches nothing, itself included. */
  const layers: CollisionLayer[] = [
    createDefaultLayer(),
    { id: 'a', name: 'A', ignores: [] },
    { id: 'lonely', name: 'Lonely', ignores: ['default', 'a', 'lonely'] },
  ];

  it('is the layers it asks for, each collider by its own layer, one that touches nothing included', async () => {
    const lonely = onLayer(block([0, 1, -3], [2, 2, 1]), 'lonely');
    const onA = onLayer(near(), 'a');
    const { physics } = await running([ground(), lonely, onA], { layers });
    const from = { x: 0, y: 1, z: 0 };

    // Given collision groups, Rapier hid the Lonely block from every query.
    expectHit(physics.raycast(from, ahead, 20), { entity: lonely, distance: 2.5 });
    expectHit(physics.raycast(from, ahead, 20, { layers: ['a'] }), { entity: onA, distance: 4.5 });
    expectHit(physics.raycast(from, ahead, 20, { layers: ['lonely'] }), { entity: lonely, distance: 2.5 });
    expect(physics.raycast(from, ahead, 20, { layers: [] })).toBeNull();
    expect(physics.raycast(from, ahead, 20, { layers: ['gone'] })).toBeNull();
    expect(physics.overlapSphere({ x: 0, y: 1, z: -4 }, 1.4, { layers: ['a'] })).toEqual([onA.entity.id]);
  });

  it('is sensors too, when it asks', async () => {
    const zone = sensor([0, 1, -2.5], [2, 2, 1]);
    const wall = near();
    const { physics } = await running([zone, wall]);
    const inside = { x: 0, y: 1, z: -2.5 };

    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20, { sensors: true }), { entity: zone, distance: 2 });
    expect(physics.overlapSphere(inside, 0.5)).toEqual([]);
    expect(physics.overlapSphere(inside, 0.5, { sensors: true })).toEqual([zone.entity.id]);
  });

  it("is named from the project's table, Default first, which cannot be changed", async () => {
    const { physics } = await running([], { layers });

    expect(physics.layers).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'a', name: 'A' },
      { id: 'lonely', name: 'Lonely' },
    ]);
    expect(Object.isFrozen(physics.layers)).toBe(true);
    expect(physics.layers.every((layer) => Object.isFrozen(layer))).toBe(true);
  });
});

describe('the world, as it is built', () => {
  it('moves nothing', async () => {
    // 0.4 m into each other, which a tick would push apart.
    const left = withBody('box', [0, 3, 0], { gravityScale: 0 });
    const right = withBody('box', [0.6, 3, 0], { gravityScale: 0 });
    const { rig } = await running([left, right]);

    expect(apart(rig.solved(left.entity.id).position, { x: 0, y: 3, z: 0 })).toBeLessThan(1e-6);
    expect(apart(rig.solved(right.entity.id).position, { x: 0.6, y: 3, z: 0 })).toBeLessThan(1e-6);
  });
});
