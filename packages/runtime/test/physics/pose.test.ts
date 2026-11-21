import { createEntity } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  ground,
  nest,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withScript,
} from './rig';

/*
 * A body is drawn where the solver holds it, turned as the solver turns it.
 *
 * A ball rolling down a slope was drawn sliding: every body the solver turned
 * was drawn at the identity from its first frame, while its body rolled.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a body is drawn as the solver holds it', () => {
  it('a ball rolling down a slope is drawn turned as its body turns', async () => {
    // Drawn at its body, so the two can be compared at any moment.
    const ball = withBody('sphere', [0, 1, 0], { interpolate: false });
    const rig = await physicsRig([ground(15), ball]);

    rig.run(1);

    const drawn = rig.drawn(ball.entity.id).quaternion;
    expect(drawn.angleTo(rig.solved(ball.entity.id).quaternion)).toBeLessThan(1e-4);
    // Rolled, not slid: the identity is where it used to be drawn.
    expect(drawn.angleTo(new Quaternion())).toBeGreaterThan(1);
  });

  it('a nested body is drawn where its body is, whichever the table lists first', async () => {
    const parent = withBody('box', [0, 3, 0], { interpolate: false });
    parent.entity.transform.rotation = [0, 0, Math.PI / 6];
    const child = withBody('sphere', [3, 2, 0], { interpolate: false });
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    // The child first on purpose: written before its parent, it was placed
    // against the pose its parent was about to leave, one frame of the fall off
    // its body.
    const rig = await physicsRig([child, parent]);

    rig.run(0.5);

    for (const { entity } of [parent, child]) {
      const drawn = rig.drawn(entity.id);
      const solved = rig.solved(entity.id);
      expect(drawn.position.distanceTo(solved.position)).toBeLessThan(1e-5);
      expect(drawn.quaternion.angleTo(solved.quaternion)).toBeLessThan(1e-4);
    }
  });
});

/*
 * A body asleep is not read from the solver again until it wakes, and is drawn
 * where it fell asleep: what is drawn must not tell the two apart.
 */
describe('a body asleep', () => {
  it('is drawn where it sleeps under an entity that moves', async () => {
    class Slide extends Behaviour {
      static going = false;
      override onFixedUpdate(step: number) {
        if (Slide.going) this.transform.position.x += 2 * step;
      }
    }
    const arm = withScript(createEntity('Arm', []), Slide);
    arm.entity.transform.position = [0, 5, 0];
    const hand = withBody('box', [2, 0, 0], { gravityScale: 0, interpolate: false });
    const rig = await physicsRig([nest(arm, hand), hand]);
    // Still for longer than Rapier waits before it puts a body to sleep.
    rig.run(4);

    Slide.going = true;
    rig.run(1);

    expect(rig.drawn(arm.entity.id).position.x).toBeGreaterThan(1.9);
    expect(rig.solved(hand.entity.id).position.distanceTo(new Vector3(2, 5, 0))).toBeLessThan(1e-6);
    expect(rig.drawn(hand.entity.id).position.distanceTo(rig.solved(hand.entity.id).position)).toBeLessThan(1e-6);
  });

  it('is drawn between its ticks again once something wakes it', async () => {
    // Interpolated, as a Rigid Body is made.
    const box = withBody('box', [0, 0.5, 0]);
    const rig = await physicsRig([ground(), box]);
    rig.run(4);

    rig.body(box.entity.id).applyImpulse({ x: 0, y: 5, z: 0 });
    let began = rig.solved(box.entity.id).position;
    for (let frame = 0; frame < 15; frame += 1) {
      rig.run(rig.world.fixedStep);
      // A frame of one tick ends where its next begins: drawn where this one began.
      expect(rig.drawn(box.entity.id).position.distanceTo(began)).toBeLessThan(1e-5);
      began = rig.solved(box.entity.id).position;
    }
    expect(began.y).toBeGreaterThan(0.7);
  });
});
