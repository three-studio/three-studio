import {
  createEntity,
  createRenderingSettings,
  modelType,
  scriptType,
  fixedId,
  type SceneDoc,
  type ScriptComponent,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import type { SceneApi } from '../src/behaviour/Behaviour';
import { SceneHost, type SceneHostOptions } from '../src/SceneHost';
import { Behaviour } from '../src/scripting/ScriptHost';
import { serveModels, stubImages, type ModelServer } from './assetFixtures';
import { builtInRegistries, withoutPhysics } from './registries';

/*
 * Where a script is, as it asks `scenes.current`.
 *
 * It read `null` in the first scene's `onStart`, and the name of the scene just
 * left in every later one: every `onAwake` and `onStart` runs while the world
 * is being built, and the host named a scene only once it ran. A level that
 * restarted itself from `onStart` restarted the previous one, or failed on
 * `No scene "null"`.
 */

const WHERE = fixedId('asset', 'script-where');

const seen: [phase: string, current: string | null][] = [];
const held: SceneApi[] = [];

class Where extends Behaviour {
  override onAwake() {
    seen.push(['awake', this.scenes?.current ?? null]);
  }

  override onStart() {
    seen.push(['start', this.scenes?.current ?? null]);
    if (this.scenes) held.push(this.scenes);
  }
}

function sceneWithWhere(): SceneDoc {
  const script: ScriptComponent = { ...scriptType.create(), assetId: WHERE };
  return sceneWith([createEntity('Holder', [script])]);
}

function hostOf(
  scenes: Record<string, SceneDoc>,
  extra: Partial<Pick<SceneHostOptions, 'assets' | 'loadingScene'>> = {},
): SceneHost {
  const registries = builtInRegistries();
  return new SceneHost({
    source: {
      read: async (name) => {
        const scene = scenes[name];
        if (!scene) throw new Error(`No scene "${name}".`);
        return structuredClone(scene);
      },
    },
    registries: withoutPhysics(registries),
    // The bundle the host hands every world it builds, the script in it.
    scripts: new Map([[WHERE, Where]]),
    assets: extra.assets ?? new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    loadingScene: extra.loadingScene ?? null,
    rendering: createRenderingSettings(),
    // Rapier is not what this is about, and it is the one slow thing to load.
  });
}

beforeEach(() => {
  seen.length = 0;
  held.length = 0;
});

describe('scenes.current, as a script sees it', () => {
  it('names the first scene from its first onAwake and onStart', async () => {
    const host = hostOf({});
    await host.adopt('Menu', sceneWithWhere());

    expect(seen).toEqual([
      ['awake', 'Menu'],
      ['start', 'Menu'],
    ]);
    host.dispose();
  });

  it('names the scene moved to, not the one left', async () => {
    const host = hostOf({ Level: sceneWithWhere() });
    await host.adopt('Menu', sceneWithWhere());
    seen.length = 0;

    await host.go('Level');

    expect(seen).toEqual([
      ['awake', 'Level'],
      ['start', 'Level'],
    ]);
    expect(host.current).toBe('Level');
    host.dispose();
  });

  it('answers each scene’s scripts with their own scene, whatever the host is doing', async () => {
    // Two scenes can be under construction at once — a loading scene and the
    // one it stands in for — so a single name on the host would answer one of
    // them with the other's.
    const host = hostOf({ Level: sceneWithWhere() });
    await host.adopt('Menu', sceneWithWhere());
    await host.go('Level');

    expect(held.map((scenes) => scenes.current)).toEqual(['Menu', 'Level']);
    host.dispose();
  });
});

/*
 * What a switch between two scenes keeps. A build's cache keeps nothing that
 * nothing holds, so a model two consecutive scenes share must never drop to
 * no holder between them: the load holds what the next scene needs from the
 * moment it has read it until the next scene's world holds it too. Before,
 * it fetched each file, let go of it, and the next world fetched it again.
 */
describe('a switch between scenes', () => {
  const CRATE = fixedId('asset', 'crate');
  const LOADING = fixedId('scene', 'loading');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** A scene placing the crate. */
  function withCrate(): SceneDoc {
    return sceneWith([createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }])]);
  }

  /** A build's cache, keeping nothing idle, over the crate on the server. */
  function buildCache(server: ModelServer): AssetCache {
    return new AssetCache(builtInRegistries(), {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
  }

  it('fetches a model the two scenes share once', async () => {
    stubImages();
    const server = await serveModels();
    const assets = buildCache(server);
    const host = hostOf({ Level: withCrate() }, { assets });
    await host.adopt('Menu', withCrate());

    await host.go('Level');

    expect(server.requests('crate.gltf')).toBe(1);
    // The level's world holds it now, and nothing else does.
    expect(assets.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
    host.dispose();
  });

  it('gives back what a load held when it is cancelled, or replaced by another', async () => {
    stubImages();
    const server = await serveModels();
    const assets = buildCache(server);
    const host = hostOf({ Level: withCrate(), Empty: sceneWith([]) }, { assets });
    await host.adopt('Menu', sceneWith([]));

    const level = host.load('Level');
    await level.ready;
    // Ready means in hand: held until the swap, which a Press Start may keep waiting.
    expect(assets.stats.held).toBe(1);
    level.cancel();
    expect(assets.stats.held).toBe(0);

    const first = host.load('Level');
    await first.ready;
    expect(assets.stats.held).toBe(1);
    const second = host.load('Empty');
    expect(assets.stats.held).toBe(0);

    await second.activate();
    expect(host.current).toBe('Empty');
    host.dispose();
  });

  it('puts the loading scene up without dropping what the target shares with the scene left', async () => {
    stubImages();
    const server = await serveModels();
    const assets = buildCache(server);
    const host = hostOf({ Level: withCrate(), [LOADING]: sceneWith([]) }, { assets, loadingScene: LOADING });
    await host.adopt('Menu', withCrate());

    await host.go('Level');

    expect(server.requests('crate.gltf')).toBe(1);
    expect(host.current).toBe('Level');
    expect(assets.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
    host.dispose();
  });
});
