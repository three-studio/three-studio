import { createComponent, type EntityTemplate } from '@three-studio/core';
import { Euler, Quaternion } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Behaviour, type ScriptClass } from '../../src/scripting/ScriptHost';
import {
  block,
  ground,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withScript,
} from './rig';

/*
 * Who drives a body. A kinematic body follows its entity's transform, so a
 * script moves it by moving its entity, and what rests on it rides along. A
 * write to the transform of a body the solver or a character moves puts the
 * body there: the write is a teleport, and the world never undoes it.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Still for half a second, while what rides it settles, then 2 m/s along x. */
class Slide extends Behaviour {
  private ticks = 0;

  override onFixedUpdate(step: number) {
    this.ticks += 1;
    if (this.ticks > 30) this.transform.position.x += 2 * step;
  }
}

/** As `Slide`, but at the display's rate, as a script moving it in `onUpdate` does. */
class SlideEachFrame extends Behaviour {
  override onUpdate(delta: number) {
    if (this.time > 0.5) this.transform.position.x += 2 * delta;
  }
}

/** On its 30th tick, puts its entity at (5, 10, 0), turned a radian about y. */
class MoveOnce extends Behaviour {
  private ticks = 0;

  override onFixedUpdate() {
    this.ticks += 1;
    if (this.ticks !== 30) return;
    this.transform.position.set(5, 10, 0);
    this.transform.rotation.set(0, 1, 0);
  }
}

/** On its 30th tick, puts its entity at (5, 1, 0). */
class Respawn extends Behaviour {
  private ticks = 0;

  override onFixedUpdate() {
    this.ticks += 1;
    if (this.ticks === 30) this.transform.position.set(5, 1, 0);
  }
}

/** An 8 × 0.5 × 8 kinematic platform, its top through the origin, slid by its script. */
function platform(script: ScriptClass = Slide): EntityTemplate {
  const template = block([0, -0.25, 0], [4, 0.25, 4]);
  template.components.push({ ...createComponent('rigidbody'), bodyType: 'kinematicPosition' });
  return withScript(template, script);
}

describe('a kinematic body', () => {
  it('moved by its script at 2 m/s is 2 m on a second later, and carries a box resting on it', async () => {
    // The world copied the platform's body, which nothing had moved, over its
    // entity every frame: the script's move was undone before it was drawn, and
    // a moving platform stood at x = 0 for ever.
    const moving = platform();
    const crate = withBody('box', [0, 0.5, 0]);
    const rig = await physicsRig([moving, crate]);

    rig.run(1.5);

    expect(Math.abs(rig.drawn(moving.entity.id).position.x - 2)).toBeLessThan(1e-9);
    expect(Math.abs(rig.solved(moving.entity.id).position.x - 2)).toBeLessThan(1e-6);
    const carried = rig.solved(crate.entity.id).position;
    expect(carried.x).toBeGreaterThan(1.5);
    expect(Math.abs(carried.y - 0.5)).toBeLessThan(0.05);
  });

  it('carries the player standing on it', async () => {
    const moving = platform();
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([moving, walker]);

    rig.run(0.5);
    const landed = rig.solved(walker.entity.id).position;
    rig.run(1);

    // 2 m less a tick: Rapier carries a character by its platform's last step.
    const carried = rig.solved(walker.entity.id).position;
    expect(carried.x - landed.x).toBeGreaterThan(1.9);
    expect(Math.abs(carried.y - landed.y)).toBeLessThan(0.05);
  });

  it('carries the player riding it at 120 Hz, moved a frame at a time', async () => {
    // Rapier's controller dropped the platform's carry on a tick in four, and the
    // player slid off the back of a platform its script moved in `onUpdate`.
    const moving = platform(SlideEachFrame);
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([moving, walker]);

    rig.run(0.5, 120);
    const landed = rig.solved(walker.entity.id).position;
    rig.run(1, 120);

    const carried = rig.solved(walker.entity.id).position;
    expect(carried.x - landed.x).toBeGreaterThan(1.9);
    expect(Math.abs(carried.y - landed.y)).toBeLessThan(0.05);
  });
});

describe("a write to a body's transform", () => {
  it('puts a falling ball there, turned as written, falling as fast', async () => {
    // The world copied the body back over the write, and the ball fell on from
    // where it had been, as if nothing had been written.
    const ball = withScript(withBody('sphere', [0, 10, 0]), MoveOnce);
    const rig = await physicsRig([ball]);

    rig.run(0.5);

    const moved = rig.solved(ball.entity.id);
    expect(Math.abs(moved.position.x - 5)).toBeLessThan(1e-6);
    const written = new Quaternion().setFromEuler(new Euler(0, 1, 0));
    expect(moved.quaternion.angleTo(written)).toBeLessThan(1e-6);

    rig.run(0.1);
    // From rest it would drop 5 cm. Keeping its half second of fall, about 54.
    expect(moved.position.y - rig.solved(ball.entity.id).position.y).toBeGreaterThan(0.4);
  });

  it('puts the player there', async () => {
    const walker = withScript(player([0, 1, 0]), Respawn);
    const rig = await physicsRig([ground(), walker]);

    rig.run(0.4);
    const settled = rig.solved(walker.entity.id).position;
    rig.run(0.6);

    const { position } = rig.solved(walker.entity.id);
    expect(Math.abs(position.x - 5)).toBeLessThan(1e-3);
    expect(Math.abs(rig.drawn(walker.entity.id).position.x - 5)).toBeLessThan(0.05);
    expect(Math.abs(position.y - settled.y)).toBeLessThan(0.05);
  });

  it('leaves a disabled body alone, and puts it where its entity is once enabled again', async () => {
    const ball = withBody('sphere', [0, 0.5, 0]);
    const rig = await physicsRig([ground(), ball]);
    rig.run(0.5);
    const rested = rig.solved(ball.entity.id);

    const body = rig.engine.physics?.body(ball.entity.id);
    const object = rig.engine.binder.getObject(ball.entity.id);
    if (!body || !object) throw new Error('The ball was not built.');
    body.enabled = false;
    object.position.set(3, 2, 0);
    rig.run(0.5);

    const held = rig.solved(ball.entity.id);
    expect(held.position.distanceTo(rested.position)).toBeLessThan(1e-6);
    expect(held.quaternion.angleTo(rested.quaternion)).toBeLessThan(1e-6);
    expect(object.position.toArray()).toEqual([3, 2, 0]);

    // Enabled again, it stayed where it had been disabled, and the world then
    // wrote it back over the entity that had been moved meanwhile.
    body.enabled = true;
    rig.engine.update(rig.engine.fixedStep);
    expect(Math.abs(rig.solved(ball.entity.id).position.x - 3)).toBeLessThan(1e-6);
  });
});
