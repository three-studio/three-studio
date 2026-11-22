import { createRenderingSettings } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { AssetCache } from '../../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import { holdTouchControls, touchHolds } from '../../src/controllers/touch';
import { StudioTime } from '../../src/time/StudioTime';
import { World } from '../../src/world/World';
import { standInForTheBrowser, takeTheBrowserBack } from '../physics/rig';
import { builtInRegistries, withoutPhysics } from '../registries';

/*
 * One set of sticks per world, however many player controllers hold it. In
 * Node there is no document, so no DOM is built: the holds are what is read.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

async function world(): Promise<World> {
  const registries = builtInRegistries();
  const made = await World.play({
    time: new StudioTime(),
    registries: withoutPhysics(registries),
    scripts: new Map(),
    assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    rendering: createRenderingSettings(),
  });
  onTestFinished(() => made.dispose());
  return made;
}

describe('holdTouchControls', () => {
  it('makes one set for two holds in a world, and the last release takes it down', async () => {
    const shared = await world();
    const first = holdTouchControls(shared, 'auto');
    const second = holdTouchControls(shared, 'always');
    expect(touchHolds(shared)).toBe(2);

    first.dispose();
    first.dispose();
    expect(touchHolds(shared)).toBe(1);
    second.dispose();
    expect(touchHolds(shared)).toBe(0);
    expect(second.shown).toBe(false);
  });

  it('gives another world its own', async () => {
    const one = await world();
    const other = await world();
    const held = holdTouchControls(one, 'auto');
    expect([touchHolds(one), touchHolds(other)]).toEqual([1, 0]);
    holdTouchControls(other, 'auto').dispose();
    expect(touchHolds(one)).toBe(1);
    held.dispose();
  });
});
