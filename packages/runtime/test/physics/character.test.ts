import { createComponent } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CharacterSettings } from '../../src/physics/PhysicsApi';
import {
  block,
  ground,
  physicsRig,
  player,
  sensor,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * A character is a tool the world lends a behaviour: it moves its body by the
 * caller's numbers, and the world writes that body to its entity as it writes
 * every other.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** The Player Controller's. */
const SETTINGS: CharacterSettings = {
  offset: 0.02,
  maxSlope: (50 * Math.PI) / 180,
  stepHeight: 0.4,
  stepWidth: 0.2,
  snapToGround: 0.4,
};

describe('a character', () => {
  it('pushes a ball it walks into, and both are drawn where their bodies are', async () => {
    const ball = withBody('sphere', [0, 0.5, -2], { interpolate: false });
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), ball, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    const drawn = rig.drawn(ball.entity.id);
    expect(drawn.position.z).toBeLessThan(-3);
    expect(drawn.quaternion.angleTo(rig.solved(ball.entity.id).quaternion)).toBeLessThan(1e-4);
    // Stopped: a character is drawn between its last two ticks, up to one
    // behind its body while it walks. Not quite still even then: after a walk
    // it sits inside its skin, and Rapier's controller nudges it back out by a
    // tenth of a millimetre a tick.
    rig.release('KeyW');
    rig.run(0.5);
    const at = rig.drawn(walker.entity.id).position;
    expect(at.distanceTo(rig.solved(walker.entity.id).position)).toBeLessThan(1e-3);
  });

  it('walks on a dynamic body, and stays upright', async () => {
    // A Rigid Body added before the Player Controller kept its Dynamic type: the
    // solver drove the body, the character's targets moved nothing, and the
    // player stood still.
    const walker = player([0, 1, 0], { bodyType: 'dynamic' });
    const rig = await physicsRig([ground(), walker]);

    rig.run(0.5);
    const from = rig.drawn(walker.entity.id).position;
    rig.press('KeyW');
    rig.run(1);

    const { position, quaternion } = rig.drawn(walker.entity.id);
    expect(from.z - position.z).toBeGreaterThan(4);
    const up = new Vector3(0, 1, 0);
    expect(up.clone().applyQuaternion(quaternion).angleTo(up)).toBeLessThan((1 * Math.PI) / 180);
  });

  it('walks on a kinematic body as on a fixed one', async () => {
    // Rapier's controller stopped a move along a kinematic floor at once, again
    // and again, then gave up: a player walked 0.4 m of the 9 it walked on a
    // fixed floor, and sank into it.
    const floor = block([0, -0.25, 0], [40, 0.5, 40]);
    floor.components.push({ ...createComponent('rigidbody'), bodyType: 'kinematicPosition' });
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([floor, walker]);

    rig.run(0.5);
    const from = rig.solved(walker.entity.id).position;
    rig.press('KeyW');
    rig.run(1);

    const { position } = rig.solved(walker.entity.id);
    expect(from.z - position.z).toBeGreaterThan(4);
    expect(Math.abs(position.y - from.y)).toBeLessThan(0.005);
  });

  it('walks through a sensor as if it were not there', async () => {
    // Rapier's controller sweeps a sensor as it sweeps a wall: the player
    // stopped dead at a trigger zone's face, and could never set it off.
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), sensor([0, 1, -3], [2, 2, 2]), walker]);

    rig.run(0.5);
    const from = rig.drawn(walker.entity.id).position;
    rig.press('KeyW');
    rig.run(1);

    expect(from.z - rig.drawn(walker.entity.id).position.z).toBeGreaterThan(4);
  });

  it('climbs a step its step height clears, and no higher', async () => {
    // A 0.5 m step, its face a metre ahead of the player. The world used to
    // climb 0.4 m for every character, whatever its level was built around.
    async function walkAt(stepHeight: number) {
      const walker = player([0, 1, 0], { controller: { stepHeight } });
      const rig = await physicsRig([ground(), block([0, 0.25, -6], [4, 0.5, 10]), walker]);
      rig.run(0.5);
      const settled = rig.drawn(walker.entity.id).position;
      rig.press('KeyW');
      rig.run(1);
      return { settled, walked: rig.drawn(walker.entity.id).position };
    }

    const over = await walkAt(0.6);
    expect(over.walked.y - over.settled.y).toBeGreaterThan(0.4);

    const under = await walkAt(0.3);
    expect(under.walked.z).toBeGreaterThan(-1);
    expect(under.walked.y).toBeCloseTo(under.settled.y, 1);
  });

  it('leaves no body in the world while it flies', async () => {
    // A ball dropped on a flying player's spawn landed on a capsule nobody could
    // see: the body stayed there, while the player flew elsewhere.
    const ball = withBody('sphere', [0, 3, 0]);
    const rig = await physicsRig([player([0, 1, 0], { controller: { mode: 'fly' } }), ball, ground()]);

    rig.run(2);

    const { position } = rig.drawn(ball.entity.id);
    expect(position.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(position.x)).toBeLessThan(1e-3);
    expect(Math.abs(position.z)).toBeLessThan(1e-3);
  });

  it('is one to a body: asked again, the world gives none, and the player walks on', async () => {
    // Two would each set the body's target on every tick, the last one winning.
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), walker]);

    expect(rig.engine.physics?.createCharacterController(walker.entity.id, SETTINGS)).toBeNull();

    rig.press('KeyW');
    rig.run(1);
    expect(rig.solved(walker.entity.id).position.z).toBeLessThan(-4);
  });

  it('moves nothing for a move that is not a number, walks on after it, and keeps its turn for a rotation of zero', async () => {
    // An infinite move handed Rapier's controller a target that is not a
    // number: the character stood where it was, and never moved again.
    const capsule = withBody('capsule', [0, 1.1, 0]);
    const rig = await physicsRig([ground(), capsule]);
    const id = capsule.entity.id;
    const character = rig.engine.physics?.createCharacterController(id, SETTINGS);
    if (!character) throw new Error('The capsule was given no character.');

    // Settled as the Player Controller holds a player down: 1 m/s.
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    for (let tick = 0; tick < 30; tick++) {
      character.move({ x: 0, y: -1 / 60, z: 0 }, turn);
      rig.run(1 / 60);
    }
    const settled = rig.solved(id);

    for (const bad of [NaN, Infinity]) {
      expect(character.move({ x: bad, y: 0, z: 0 }, turn)).toEqual({ x: 0, y: 0, z: 0 });
      rig.run(1 / 60);
      expect(rig.solved(id).position.distanceTo(settled.position)).toBeLessThan(1e-6);
    }

    character.move({ x: 0.01, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 0 });
    rig.run(1 / 60);
    const { position, quaternion } = rig.solved(id);
    expect(quaternion.angleTo(settled.quaternion)).toBeLessThan(1e-6);
    expect(Math.abs(position.x - settled.position.x - 0.01)).toBeLessThan(1e-4);
  });
});
