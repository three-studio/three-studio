import { createComponent, createEntity, type ScriptComponent } from '@three-studio/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Behaviour, clearScripts, registerScript } from '../../src/scripting/ScriptHost';
import { physicsRig, standInForTheBrowser, takeTheBrowserBack } from './rig';

/*
 * The editor's Step moves the game exactly one tick of the project's step.
 *
 * It advanced the runtime's own 1/60 whatever the project said: at 30 Hz every
 * other press ran no tick, and at 120 Hz every press ran two.
 */

const TICKER = 'script-ticker';
let ticks = 0;

class Ticker extends Behaviour {
  override onFixedUpdate() {
    ticks += 1;
  }
}

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

beforeEach(() => {
  registerScript(TICKER, Ticker);
  ticks = 0;
});

afterEach(() => {
  clearScripts();
});

describe('Step', () => {
  it("advances one tick of the project's step, whatever the last frame left over", async () => {
    const script: ScriptComponent = { ...createComponent('script'), assetId: TICKER };
    const { engine } = await physicsRig([createEntity('Ticker', [script])], {
      fixedTimestep: 1 / 50,
    });
    expect(engine.fixedStep).toBe(1 / 50);

    // Where the old 1/60 ran none.
    engine.update(engine.fixedStep);
    expect(ticks).toBe(1);

    // Less than a tick, left over for the next frame…
    engine.update(1 / 120);
    expect(ticks).toBe(1);

    // …which still makes a Step one tick.
    engine.update(engine.fixedStep);
    expect(ticks).toBe(2);
  });
});
