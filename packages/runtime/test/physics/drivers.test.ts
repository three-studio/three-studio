import { createComponent, type EntityTemplate } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  block,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withScript,
} from './rig';

/*
 * Who drives a body. A kinematic body follows its entity's transform, so a
 * script moves it by moving its entity, and what rests on it rides along.
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

/** An 8 × 0.5 × 8 kinematic platform, its top through the origin, slid by its script. */
function platform(): EntityTemplate {
  const template = block([0, -0.25, 0], [4, 0.25, 4]);
  template.components.push({ ...createComponent('rigidbody'), bodyType: 'kinematicPosition' });
  return withScript(template, Slide);
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

    const carried = rig.solved(walker.entity.id).position;
    expect(carried.x - landed.x).toBeGreaterThan(1.7);
    expect(Math.abs(carried.y - landed.y)).toBeLessThan(0.05);
  });
});
