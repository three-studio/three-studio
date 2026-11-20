import { createEntity } from '@three-studio/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { physicsRig, standInForTheBrowser, takeTheBrowserBack, withScript } from './rig';

/*
 * The editor's Step moves the game exactly one tick of the project's step.
 *
 * It advanced the runtime's own 1/60 whatever the project said: at 30 Hz every
 * other press ran no tick, and at 120 Hz every press ran two.
 */

let ticks = 0;

class Ticker extends Behaviour {
  override onFixedUpdate() {
    ticks += 1;
  }
}

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

beforeEach(() => {
  ticks = 0;
});

describe('Step', () => {
  it("advances one tick of the project's step, whatever the last frame left over", async () => {
    const { world } = await physicsRig([withScript(createEntity('Ticker', []), Ticker)], {
      fixedTimestep: 1 / 50,
    });
    expect(world.fixedStep).toBe(1 / 50);

    // Where the old 1/60 ran none.
    world.frame(world.fixedStep);
    expect(ticks).toBe(1);

    // Less than a tick, left over for the next frame…
    world.frame(1 / 120);
    expect(ticks).toBe(1);

    // …which still makes a Step one tick.
    world.frame(world.fixedStep);
    expect(ticks).toBe(2);
  });
});
