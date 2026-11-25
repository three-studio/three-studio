import { assertDefined, createJointMotion, type EntityTemplate } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { physicsOf, physicsStats } from '../../src/physics/physicsOf';
import {
  block,
  colliderOf,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withJoint,
} from './rig';

/*
 * What the world's tick takes on trust from Rapier 0.21. It steps the physics
 * pipeline itself rather than through `World.step`, which after each step walks
 * every handle to map into Rapier's JS tables what WebAssembly made and unmap
 * what it removed. So whatever the world makes must be in those tables as it is
 * made, and out of them as it is removed: an upgrade that changes either fails
 * here first. Read through `physicsStats`, whose Rapier counts are those
 * tables' sizes; Rapier itself stays out of tests (`architecture.test.ts`).
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A box hinged under `hook`, a metre below it. */
function hanging(hook: EntityTemplate): EntityTemplate {
  return withJoint(withBody('box', [0, 2, 0]), {
    anchor: [0, 1, 0],
    connectedEntity: hook.entity.id,
    motion: { ...createJointMotion('hinge'), axis: [0, 0, 1] },
  });
}

describe('Rapier, stepped through its pipeline', () => {
  it('holds a body, its collider and its joint in its tables as they are made, before any step', async () => {
    const hook = block([0, 3, 0], [0.2, 0.2, 0.2]);
    const rig = await physicsRig([hook]);
    const before = assertDefined(physicsStats(rig.world), 'the world’s physics');

    rig.world.spawn(hanging(hook));
    rig.world.reconcile();

    expect(physicsStats(rig.world)).toEqual({
      bodies: before.bodies + 1,
      colliders: before.colliders + 1,
      joints: 1,
      rapierBodies: before.rapierBodies + 1,
      rapierColliders: before.rapierColliders + 1,
      rapierJoints: 1,
    });
  });

  it('finds by ray, after a step that maps nothing, a collider made since the last', async () => {
    const rig = await physicsRig([]);
    const step = block([4, 0.5, 0], [1, 1, 1]);

    rig.world.spawn(step);
    rig.world.reconcile();
    rig.run(rig.world.fixedStep);

    const hit = physicsOf(rig.world)?.raycast({ x: 4, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
    expect(hit?.entity).toBe(step.entity.id);
  });

  it('takes a body, a collider and a joint out of its tables as they are removed, before any step', async () => {
    const hook = block([0, 3, 0], [0.2, 0.2, 0.2]);
    const box = hanging(hook);
    const ball = withBody('sphere', [3, 2, 0]);
    const rig = await physicsRig([hook, box, ball]);
    const before = assertDefined(physicsStats(rig.world), 'the world’s physics');

    rig.world.destroy(box.entity.id);
    rig.world.deleteComponent(ball.entity.id, colliderOf(ball).id);
    rig.world.reconcile();

    expect(physicsStats(rig.world)).toMatchObject({
      rapierBodies: before.rapierBodies - 1,
      rapierColliders: before.rapierColliders - 2,
      rapierJoints: before.rapierJoints - 1,
    });
  });
});
