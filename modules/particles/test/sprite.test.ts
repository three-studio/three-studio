import { fixedId } from '@three-studio/core';
import { particleEmitterType } from '@three-studio/particles/core';
import { ParticleEmitterSystem } from '@three-studio/particles/runtime';
import { AssetCache, StudioTime, type SystemContext } from '@three-studio/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceArena } from '../../../packages/runtime/src/systems/ResourceArena';
import { stubImages } from '../../../packages/runtime/test/assetFixtures';
import { registriesWithParticles } from './registries';

const registries = registriesWithParticles();

const SPARK = fixedId('asset', 'spark');
const SMOKE = fixedId('asset', 'smoke');
const EMBERS = fixedId('entity', 'embers');

afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * An emitter's sprite is one of the images the project's cache shares: the
 * emitter holds it while it draws it, and gives it back — a frame later, since
 * the frame in flight may still be sampling it. One that forgot would pin the
 * image for the life of the window.
 */
describe("an emitter's sprite", () => {
  it('is held while drawn, and given back on a swap and at the unmount', () => {
    const loads = stubImages({ manual: true });
    const urls = new Map([
      [SPARK, 'http://127.0.0.1/spark.png'],
      [SMOKE, 'http://127.0.0.1/smoke.png'],
    ]);
    const assets = new AssetCache(registries, { resolver: { url: (id) => urls.get(id) ?? null }, idleBudgetBytes: 0 });
    const arena = new ResourceArena();
    const ctx: SystemContext = {
      arena,
      materials: new Map(),
      assets,
      time: new StudioTime(),
      shadowMapSize: 1024,
      sunOf: () => null,
      invalidate: () => {},
      attach: () => true,
    };
    const system = new ParticleEmitterSystem();
    const sparks = { ...particleEmitterType.create(), spriteId: SPARK };

    const handle = system.mount(EMBERS, sparks, ctx);
    expect(handle.sprite?.texture).toBe(handle.uniforms.map.value);
    expect(assets.stats.held).toBe(1);

    const swapped = system.patch(handle, sparks, { ...sparks, spriteId: SMOKE }, ctx);
    for (const load of loads) load.land();
    expect(assets.stats.held).toBe(2);
    arena.flush();
    expect(assets.stats.held).toBe(1);

    system.unmount(swapped, ctx);
    arena.flush();
    expect(assets.stats).toEqual({ entries: 0, held: 0, idleBytes: 0 });
    expect(loads.map((load) => load.url)).toEqual(['http://127.0.0.1/spark.png', 'http://127.0.0.1/smoke.png']);
  });
});
