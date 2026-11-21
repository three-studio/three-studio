import { createEntity, createRenderingSettings, fixedId, modelType, assertDefined } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prefabWith, sceneWith } from '../../../core/test/fixtures';
import { AssetCache } from '../../src/assets/AssetCache';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { worldScriptsOf } from '../../src/scripting/ScriptWorld';
import { StudioTime } from '../../src/time/StudioTime';
import { World } from '../../src/world/World';
import { serveModels, stubImages } from '../assetFixtures';
import { bundleOf, standInForTheBrowser, takeTheBrowserBack, withScript } from '../physics/rig';
import { builtInRegistries } from '../registries';

/*
 * What a script may instantiate is held for its world's life. A prefab a
 * script was given is drawn by nothing at start, and under a build's idle
 * budget of nothing its model would be freed a frame after its last instance
 * went and fetched again for the next: a spawner's every crate a request.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

const STEP = 1 / 60;
const CRATE_MODEL = fixedId('asset', 'crate-model');
const CRATE = fixedId('asset', 'crate-prefab');

class Spawner extends Behaviour {}

/** Turns of the event loop, for a model a frame asked for to land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('what a script can instantiate', () => {
  it('is held from the world’s load to its disposal, and its model fetched once however many come and go', async () => {
    stubImages();
    const server = await serveModels();
    const registries = builtInRegistries();
    const assets = new AssetCache(registries, {
      resolver: { url: (id) => (id === CRATE_MODEL ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE_MODEL }]);
    const prefab = { ...prefabWith('Crate', [crate], crate.entity.id), id: CRATE };
    // Named by a script property, as a spawner is given what it spawns.
    const spawner = withScript(createEntity('Spawner'), Spawner, { crate: CRATE });

    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([spawner]),
      registries,
      scripts: bundleOf([spawner]),
      prefabs: new Map([[CRATE, prefab]]),
      assets,
      rendering: { ...createRenderingSettings(), batching: false },
    });

    expect(assets.stats.held).toBe(1);
    expect(server.requests('crate.gltf')).toBe(1);

    const scripts = assertDefined(worldScriptsOf(world), "the world's scripts");
    for (let round = 0; round < 10; round += 1) {
      const placed = assertDefined(scripts.instantiate(CRATE), 'a crate');
      world.frame(STEP);
      await settled();
      placed.destroy();
      world.frame(STEP);
      assets.beginFrame();
    }

    expect(assets.stats.held).toBe(1);
    expect(server.requests('crate.gltf')).toBe(1);

    world.dispose();

    expect(assets.stats.held).toBe(0);
  });
});
