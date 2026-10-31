import { createEntity } from '@three-studio/core';
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import type { BodyHandle, CharacterController, CharacterSettings } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { noBody, scriptPhysicsFor } from '../../src/scripting/scriptPhysics';
import {
  block,
  ground,
  nest,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withScript,
} from './rig';

/*
 * Scripts move bodies through `this.body`, the body their entity moves with,
 * and reach the rest of the world through `this.physics`.
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

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/** Kicks its body along x as the game starts. */
class Kick extends Behaviour {
  override onStart() {
    this.body.applyImpulse({ x: 4, y: 0, z: 0 });
  }
}

/** Kicks its body on every tick, counting them. */
class KickEveryTick extends Behaviour {
  static ticks = 0;

  override onFixedUpdate() {
    this.body.applyImpulse({ x: 4, y: 0, z: 0 });
    KickEveryTick.ticks += 1;
  }
}

/** Pushes its body backwards from where it stands, and keeps the body its id names. */
class Push extends Behaviour {
  static kept: BodyHandle | null = null;

  override onStart() {
    const at = this.transform.getWorldPosition(new Vector3());
    this.body.applyImpulse({ x: 0, y: 0, z: -2 }, at);
    Push.kept = this.physics.body(this.entity.id);
  }
}

/** Kicks the body of `target`, reads the gravity, and asks for an entity that is not there. */
class KickOther extends Behaviour {
  static target = '';
  static gravity = 0;
  static nobody: BodyHandle | null | undefined;

  override onStart() {
    KickOther.gravity = this.physics.gravity.y;
    this.physics.body(KickOther.target)?.applyImpulse({ x: 6, y: 0, z: 0 });
    KickOther.nobody = this.physics.body('nobody');
  }
}

/**
 * Walks 4 m/s along −z on a character of its own, falling as the world pulls it.
 *
 * 4 rather than a stroll: Rapier lifts a character onto a step only when one
 * tick's move carries it far enough onto the step's top, and at 2 m/s it stood
 * at the face of a step its step height cleared.
 */
class Walker extends Behaviour {
  static stepHeight = SETTINGS.stepHeight;
  static character: CharacterController | null = null;
  private fall = 0;

  override onStart() {
    Walker.character = this.physics.createCharacterController(this.entity.id, {
      ...SETTINGS,
      stepHeight: Walker.stepHeight,
    });
  }

  override onFixedUpdate(step: number) {
    const character = Walker.character;
    if (!character) return;
    // Held down at 1 m/s while it stands, as the Player Controller holds a player.
    this.fall = character.grounded ? -1 : this.fall + this.physics.gravity.y * step;
    character.move({ x: 0, y: this.fall * step, z: -4 * step }, IDENTITY);
  }
}

describe('a script moving bodies', () => {
  it('kicks its ball by J / mass', async () => {
    const ball = withScript(withBody('sphere', [0, 10, 0], { mass: 2, gravityScale: 0 }), Kick);
    const rig = await physicsRig([ball]);

    rig.run(1 / 60);

    expect(Math.abs(rig.body(ball.entity.id).linearVelocity.x - 2)).toBeLessThan(1e-6);
  });

  it('moves nothing on an entity with no body, throws nothing, and says so once', async () => {
    // It moved nothing and threw nothing, and its author was left to guess why.
    KickEveryTick.ticks = 0;
    const sign = withScript(createEntity('Sign'), KickEveryTick);
    const rig = await physicsRig([sign]);

    rig.run(0.5);

    expect(KickEveryTick.ticks).toBe(30);
    const said = rig.engine.warnings.filter((line) => line.includes('Sign'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Rigid Body');
  });

  it('on a child, pushes the body it rides, turning it from where it pushes', async () => {
    Push.kept = null;
    const ship = withBody('box', [0, 10, 0], { mass: 2, gravityScale: 0, angularDamping: 0 });
    const thruster = withScript(createEntity('Thruster'), Push);
    thruster.entity.transform.position = [1, 0, 0];
    nest(ship, thruster);
    const rig = await physicsRig([ship, thruster]);

    const body = rig.body(ship.entity.id);
    expect(Math.abs(body.linearVelocity.z + 1)).toBeLessThan(1e-6);
    expect(body.angularVelocity.y).toBeGreaterThan(0);
    // The behaviours' face stays exact: the thruster carries no body of its own.
    expect(rig.engine.physics?.body(thruster.entity.id)).toBeNull();
    expect(Push.kept).toBe(body);
  });

  it('reaches another entity’s body by id, and the world’s gravity', async () => {
    const ball = withBody('sphere', [0, 10, 0], { mass: 3, gravityScale: 0 });
    KickOther.target = ball.entity.id;
    KickOther.nobody = undefined;
    const kicker = withScript(createEntity('Kicker'), KickOther);
    const rig = await physicsRig([ball, kicker], { gravity: [0, -5, 0] });

    expect(KickOther.gravity).toBe(-5);
    expect(Math.abs(rig.body(ball.entity.id).linearVelocity.x - 2)).toBeLessThan(1e-6);
    expect(KickOther.nobody).toBeNull();
    // It never touched `this.body`, so nothing is said about the body it lacks.
    expect(rig.engine.warnings.filter((line) => line.includes('Kicker'))).toEqual([]);
  });

  it('walks a character of its own on its own settings, climbing the step they clear', async () => {
    // A 0.5 m step, its face four metres ahead of the capsule, which lands first.
    async function walkAt(stepHeight: number) {
      Walker.stepHeight = stepHeight;
      const capsule = withScript(withBody('capsule', [0, 1.1, 3]), Walker);
      const rig = await physicsRig([ground(), block([0, 0.25, -6], [4, 0.5, 10]), capsule]);
      rig.run(0.5);
      const settled = rig.solved(capsule.entity.id).position;
      rig.run(2);
      return { settled, walked: rig.solved(capsule.entity.id).position, grounded: Walker.character?.grounded };
    }

    const over = await walkAt(0.6);
    expect(over.walked.y - over.settled.y).toBeGreaterThan(0.4);
    expect(over.grounded).toBe(true);

    const under = await walkAt(0.3);
    expect(under.walked.z).toBeGreaterThan(-1);
  });
});

describe('a script with no physics', () => {
  it('finds nothing, moves nothing, and says nothing', () => {
    const physics = scriptPhysicsFor(null, sceneWith([]));
    const body = noBody(null);

    expect(physics.gravity).toEqual({ x: 0, y: 0, z: 0 });
    expect(physics.body('anything')).toBeNull();
    expect(physics.createCharacterController('anything', SETTINGS)).toBeNull();

    const push = { x: 1, y: 0, z: 0 };
    body.linearVelocity = push;
    body.angularVelocity = push;
    body.enabled = true;
    body.addForce(push, push);
    body.applyImpulse(push, push);
    body.addTorque(push);
    body.applyTorqueImpulse(push);
    body.teleport(push, IDENTITY);

    expect(body.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.rotation).toEqual(IDENTITY);
    expect(body.linearVelocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.angularVelocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.mass).toBe(0);
    expect(body.enabled).toBe(false);
  });
});
