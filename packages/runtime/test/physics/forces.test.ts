import { createComponent, createEntity, type EntityTemplate, type Vec3 } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec3Like } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  block,
  ground,
  nest,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withScript,
} from './rig';

/*
 * A body moved by numbers: its velocities read and written, a force or a
 * torque felt through the next tick, an impulse at once — and a value that is
 * not a number refused before it reaches the solver.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Out of gravity's reach, so a test's push is all that moves it. */
const FLOATING = { gravityScale: 0 };

/** Slides its entity along x at 2 m/s, a tick at a time. */
class Slide extends Behaviour {
  override onFixedUpdate(step: number) {
    this.transform.position.x += 2 * step;
  }
}

/** An 8 × 0.5 × 8 kinematic platform, its top at `y`. */
function platform(y = 0): EntityTemplate {
  const template = block([0, y - 0.25, 0], [8, 0.5, 8]);
  template.components.push({ ...createComponent('rigidbody'), bodyType: 'kinematicPosition' });
  return template;
}

/** How far a vector read off a body lies from `expected`. */
function off(value: Readonly<Vec3Like>, [x, y, z]: Vec3): number {
  return Math.hypot(value.x - x, value.y - y, value.z - z);
}

describe('a body moved by numbers', () => {
  it('changes its velocity by J / mass at an impulse, at once, however its colliders share the mass', async () => {
    const ball = withBody('sphere', [0, 0, 0], { ...FLOATING, mass: 3 });
    const cart = createEntity('Cart', [{ ...createComponent('rigidbody'), ...FLOATING, mass: 12 }]);
    cart.entity.transform.position = [0, 0, 5];
    const parts = [
      withCollider('box', [-2, 0, 0]),
      withCollider('sphere', [0, 0, 0]),
      withCollider('icosahedron', [2, 0, 0]),
    ];
    nest(cart, ...parts);
    const rig = await physicsRig([ball, cart, ...parts]);

    rig.body(ball.entity.id).applyImpulse({ x: 6, y: 0, z: 3 });
    rig.body(cart.entity.id).applyImpulse({ x: 24, y: 0, z: 0 });

    expect(off(rig.body(ball.entity.id).linearVelocity, [2, 0, 1])).toBeLessThan(1e-6);
    expect(off(rig.body(cart.entity.id).linearVelocity, [2, 0, 0])).toBeLessThan(1e-6);
  });

  it('feels a force for one tick: once, F·dt / m; added on every tick for a second, F·t / m', async () => {
    // Rapier keeps a force until it is reset: the force added once pushed for
    // the whole second, to 60 m/s, and the steady one grew by a push a tick.
    // Both speeds sit far above the one Rapier puts a body to sleep under.
    const once = withBody('sphere', [0, 0, 0], { ...FLOATING, mass: 2 });
    const steady = withBody('sphere', [0, 0, 3], { ...FLOATING, mass: 2 });
    const rig = await physicsRig([once, steady]);

    rig.body(once.entity.id).addForce({ x: 120, y: 0, z: 0 });
    for (let tick = 0; tick < 60; tick++) {
      rig.body(steady.entity.id).addForce({ x: 120, y: 0, z: 0 });
      rig.run(1 / 60);
    }

    expect(Math.abs(rig.body(once.entity.id).linearVelocity.x - 1)).toBeLessThan(1e-4);
    expect(Math.abs(rig.body(steady.entity.id).linearVelocity.x - 60)).toBeLessThan(1e-3);
  });

  it('spins by τ·t / I under a torque, and by J / I at once under a torque impulse', async () => {
    // 2/5 · 2 kg · (0.5 m)² = 0.2 kg·m², with no damping to take any spin off.
    const ball = withBody('sphere', [0, 0, 0], { ...FLOATING, mass: 2, angularDamping: 0 });
    const rig = await physicsRig([ball]);
    const body = rig.body(ball.entity.id);

    for (let tick = 0; tick < 60; tick++) {
      body.addTorque({ x: 0, y: 0.2, z: 0 });
      rig.run(1 / 60);
    }
    expect(Math.abs(body.angularVelocity.y - 1)).toBeLessThan(1e-3);

    body.applyTorqueImpulse({ x: 0, y: 0.2, z: 0 });
    expect(Math.abs(body.angularVelocity.y - 2)).toBeLessThan(1e-3);
  });

  it('turns too when pushed off its centre of mass', async () => {
    const ball = withBody('sphere', [0, 0, 0], { ...FLOATING, mass: 2, angularDamping: 0 });
    const rig = await physicsRig([ball]);
    const body = rig.body(ball.entity.id);

    const { x, y, z } = body.position;
    body.addForce({ x: 0, y: 0, z: -6 }, { x: x + 0.5, y, z });
    rig.run(1 / 60);

    // 6 N / 2 kg for a tick; 0.5 m × 6 N for a tick, over 0.2 kg·m².
    expect(Math.abs(body.linearVelocity.z + 0.05)).toBeLessThan(1e-6);
    expect(Math.abs(body.angularVelocity.y - 0.25)).toBeLessThan(1e-6);
  });

  it('reads back the velocities it is given', async () => {
    const ball = withBody('sphere', [0, 0, 0], FLOATING);
    const rig = await physicsRig([ball]);
    const body = rig.body(ball.entity.id);

    body.linearVelocity = { x: 1, y: 2, z: 3 };
    body.angularVelocity = { x: 0, y: 4, z: 0 };

    expect(off(body.linearVelocity, [1, 2, 3])).toBeLessThan(1e-6);
    expect(off(body.angularVelocity, [0, 4, 0])).toBeLessThan(1e-6);
  });

  it('takes none, Kinematic or Fixed, and reads the speed its transform gives a Kinematic one', async () => {
    const kinematic = platform();
    const fixed = ground();
    const sliding = withScript(platform(5), Slide);
    const rig = await physicsRig([kinematic, fixed, sliding]);

    const still = [kinematic, fixed].map((template) => ({
      template,
      at: rig.solved(template.entity.id).position,
    }));
    for (const { template } of still) {
      const body = rig.body(template.entity.id);
      body.linearVelocity = { x: 1, y: 0, z: 0 };
      body.addForce({ x: 0, y: 100, z: 0 });
      body.applyImpulse({ x: 0, y: 0, z: 10 });
    }
    rig.run(0.5);

    for (const { template, at } of still) {
      expect(off(rig.body(template.entity.id).linearVelocity, [0, 0, 0])).toBeLessThan(1e-6);
      expect(rig.solved(template.entity.id).position.distanceTo(at)).toBeLessThan(1e-6);
    }
    expect(Math.abs(rig.body(sliding.entity.id).linearVelocity.x - 2)).toBeLessThan(0.01);
  });

  it('ignores a vector that is not a number, and the rest of the call with it', async () => {
    const ball = withBody('sphere', [0, 0, 0], { ...FLOATING, angularDamping: 0 });
    const rig = await physicsRig([ball]);
    const body = rig.body(ball.entity.id);
    body.linearVelocity = { x: 1, y: 0, z: 0 };
    body.angularVelocity = { x: 0, y: 1, z: 0 };

    const push = { x: 1, y: 0, z: 0 };
    const nan = { x: NaN, y: 0, z: 0 };
    const infinite = { x: Infinity, y: 0, z: 0 };
    body.applyImpulse(nan);
    body.applyImpulse(push, nan);
    body.linearVelocity = infinite;
    body.angularVelocity = nan;
    body.addForce(infinite);
    body.addForce(push, nan);
    body.addTorque(nan);
    body.applyTorqueImpulse(infinite);
    rig.run(1 / 60);

    expect(off(body.linearVelocity, [1, 0, 0])).toBeLessThan(1e-6);
    expect(off(body.angularVelocity, [0, 1, 0])).toBeLessThan(1e-6);
  });
});
