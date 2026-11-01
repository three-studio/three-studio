import type { EntityTemplate } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhysicsApi, RaycastHit, Vec3Like } from '../../src/physics/PhysicsApi';
import {
  block,
  ground,
  nest,
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

/** These entities in a running engine, one tick run: a world answers no query before its first. */
async function ticked(entities: readonly EntityTemplate[]): Promise<{ rig: PhysicsRig; physics: PhysicsApi }> {
  const rig = await physicsRig(entities);
  rig.run(1 / 60);
  const physics = rig.engine.physics;
  if (!physics) throw new Error('The rig runs with physics on.');
  return { rig, physics };
}

function apart(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

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
    const { physics } = await ticked([wall, far()]);

    // Of length 2: Rapier counts in lengths of the direction, and read 2.25.
    const hit = physics.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -2 }, 20);

    expectHit(hit, { entity: wall, distance: 4.5, point: { x: 0, y: 1, z: -4.5 }, normal: { x: 0, y: 0, z: 1 } });
  });

  it('stops at its length, and finds nothing out of its way', async () => {
    const { physics } = await ticked([near(), far()]);

    expect(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 4)).toBeNull();
    expect(physics.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 20)).toBeNull();
  });

  it('passes out of what it starts inside', async () => {
    const back = far();
    const { physics } = await ticked([ground(), near(), back]);

    // Rapier's own met the wall it starts in, and the ground it lies on, at 0, facing nowhere.
    expectHit(physics.raycast({ x: 0, y: 1, z: -5 }, ahead, 20), { entity: back, distance: 4.5 });
    expect(physics.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 20)).toBeNull();
  });

  it("leaves out the body it is told to, every collider of it, and names the collider's own entity", async () => {
    const wall = near();
    const { cart: box, wheel } = cart();
    const { physics } = await ticked([box, wheel, wall]);
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
    const { physics } = await ticked([sensor([0, 1, -2.5], [2, 2, 1]), wall]);

    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
  });

  it('sees the world as the last tick left it', async () => {
    const wall = near();
    const ball = withBody('sphere', [0, 1, -3], { gravityScale: 0 });
    const { rig, physics } = await ticked([wall, ball]);

    rig.body(ball.entity.id).teleport({ x: 5, y: 1, z: -3 });
    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: ball, distance: 2.5 });

    rig.run(1 / 60);
    expectHit(physics.raycast({ x: 0, y: 1, z: 0 }, ahead, 20), { entity: wall, distance: 4.5 });
    expectHit(physics.raycast({ x: 5, y: 1, z: 0 }, ahead, 20), { entity: ball, distance: 2.5 });
  });

  it('finds nothing when it is not a number or has no direction', async () => {
    const { physics } = await ticked([near()]);
    const from = { x: 0, y: 1, z: 0 };

    expect(physics.raycast({ x: Number.NaN, y: 1, z: 0 }, ahead, 20)).toBeNull();
    expect(physics.raycast(from, { x: 0, y: 0, z: 0 }, 20)).toBeNull();
    expect(physics.raycast(from, ahead, Number.NaN)).toBeNull();
    expect(physics.raycast(from, ahead, -1)).toBeNull();
  });
});
