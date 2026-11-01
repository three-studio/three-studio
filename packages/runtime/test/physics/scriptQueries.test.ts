import { createDefaultLayer, createEntity, type CollisionLayer } from '@three-studio/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import type { RaycastHit } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { scriptPhysicsFor } from '../../src/scripting/scriptPhysics';
import {
  block,
  nest,
  onLayer,
  physicsRig,
  sensor,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withScript,
} from './rig';

/*
 * A script asks the world through `this.physics`, which leaves out the body its
 * entity moves with and names layers by id.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** What the scripts found, in order. */
const found: unknown[] = [];

beforeEach(() => {
  found.length = 0;
});

const layers: CollisionLayer[] = [createDefaultLayer(), { id: 'p1', name: 'Pickups', ignores: [] }];

describe("a script's queries", () => {
  it('leave out the body its entity moves with, every collider of it, from onStart', async () => {
    const seen: { ray?: RaycastHit | null; overlap?: readonly string[] } = {};
    class Aim extends Behaviour {
      override onStart() {
        seen.ray = this.physics.raycast({ x: 0, y: 1, z: -2 }, { x: 0, y: 0, z: -1 }, 20);
        seen.overlap = this.physics.overlapSphere({ x: 0, y: 1, z: -2.5 }, 0.9);
      }
    }
    // A kinematic box at z = −2 carrying a ball 1 m ahead, the gun at its centre.
    const cart = withBody('box', [0, 1, -2], { bodyType: 'kinematicPosition' });
    const wheel = withCollider('sphere', [0, 0, -1]);
    const gun = withScript(createEntity('Gun'), Aim);
    nest(cart, wheel, gun);
    const wall = block([0, 1, -5], [2, 2, 1]);
    await physicsRig([cart, wheel, gun, wall]);

    // Not the wheel, 0.5 m on.
    expect(seen.ray?.entity).toBe(wall.entity.id);
    expect(seen.ray?.distance).toBeCloseTo(2.5, 6);
    expect(seen.overlap).toEqual([]);
  });

  it("find a layer's id by its name, and a magnet sees the sensors on it", async () => {
    class Magnet extends Behaviour {
      override onStart() {
        const pickups = this.physics.layers.find((layer) => layer.name === 'Pickups')?.id;
        found.push(pickups);
        if (!pickups) return;
        found.push(this.physics.overlapSphere({ x: 0, y: 1, z: 0 }, 4, { layers: [pickups], sensors: true }));
        found.push(this.physics.overlapSphere({ x: 0, y: 1, z: 0 }, 4, { layers: [pickups] }));
      }
    }
    const pickup = onLayer(sensor([3, 1, 0], [1, 1, 1]), 'p1');
    const crate = block([-3, 1, 0], [1, 1, 1]);
    await physicsRig([pickup, crate, withScript(createEntity('Magnet'), Magnet)], { layers });

    expect(found).toEqual(['p1', [pickup.entity.id], []]);
  });

  it('that ask for a layer by its name are told so, once', async () => {
    class Seeker extends Behaviour {
      override onFixedUpdate() {
        found.push(this.physics.overlapSphere({ x: 0, y: 1, z: 0 }, 4, { layers: ['Pickups'], sensors: true }));
      }
    }
    const pickup = onLayer(sensor([3, 1, 0], [1, 1, 1]), 'p1');
    const rig = await physicsRig([pickup, withScript(createEntity('Seeker'), Seeker)], { layers });

    rig.run(0.5);

    expect(found.length).toBeGreaterThan(1);
    expect(found.every((result) => Array.isArray(result) && result.length === 0)).toBe(true);
    const told = rig.engine.warnings.filter((line) => line.includes('"Seeker"'));
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('this.physics.layers');
  });

  it('find nothing with no physics, quietly', () => {
    const said: string[] = [];
    const physics = scriptPhysicsFor(null, sceneWith([]), createEntity('Lone').entity, (line) => said.push(line));
    const at = { x: 0, y: 0, z: 0 };
    const along = { x: 0, y: 0, z: -1 };
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const unknown = { layers: ['Pickups'] };

    expect(physics.layers).toEqual([]);
    expect(physics.raycast(at, along, 10, unknown)).toBeNull();
    expect(physics.sphereCast(at, 1, along, 10, unknown)).toBeNull();
    expect(physics.boxCast(at, { x: 1, y: 1, z: 1 }, turn, along, 10, unknown)).toBeNull();
    expect(physics.capsuleCast(at, 0.5, 2, turn, along, 10, unknown)).toBeNull();
    expect(physics.overlapSphere(at, 1, unknown)).toEqual([]);
    expect(physics.overlapBox(at, { x: 1, y: 1, z: 1 }, turn, unknown)).toEqual([]);
    expect(said).toEqual([]);
  });
});
