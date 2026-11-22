import {
  Registry,
  createEntity,
  createLightEntity,
  createRenderingSettings,
  modelType,
  scriptType,
  fixedId,
  type AssetId,
  type ComponentTypeId,
  type EntityTemplate,
  type SceneDoc,
  type ScriptComponent,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import type { SceneApi } from '../src/sceneApi';
import { SceneHost, type SceneHostOptions } from '../src/SceneHost';
import { Behaviour } from '../src/scripting/ScriptHost';
import type { SystemDefinition } from '../src/systems/ComponentSystem';
import type { WorldRegistries } from '../src/world/World';
import { serveModels, stubImages, type ModelServer } from './assetFixtures';
import { builtInRegistries, withoutPhysics } from './registries';
import { StudioTime } from '../src/time/StudioTime';

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
  extra: Partial<Pick<SceneHostOptions, 'assets' | 'loadingScene' | 'registries' | 'scripts'>> = {},
): SceneHost {
  const registries = builtInRegistries();
  return new SceneHost({
    time: new StudioTime(),
    source: {
      read: async (name) => {
        const scene = scenes[name];
        if (!scene) throw new Error(`No scene "${name}".`);
        return structuredClone(scene);
      },
    },
    registries: extra.registries ?? withoutPhysics(registries),
    // The bundle the host hands every world it builds, the script in it.
    scripts: extra.scripts ?? new Map([[WHERE, Where]]),
    assets: extra.assets ?? new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    loadingScene: extra.loadingScene ?? null,
    rendering: createRenderingSettings(),
    // Rapier is not what this is about, and it is the one slow thing to load.
  });
}

const STEP = 1 / 60;

/** The host's frames, as a player's loop runs them, until `condition` holds. */
async function framesUntil(host: SceneHost, condition: () => boolean): Promise<void> {
  for (let frame = 0; frame < 5000; frame += 1) {
    if (condition()) return;
    host.update(STEP);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Still waiting after 5 000 frames.');
}

/** The host's frames until `going` settles: a scene behind the loading scene builds as they come. */
async function framed(host: SceneHost, going: Promise<void>): Promise<void> {
  let done = false;
  const outcome = going.then(
    () => null,
    (cause: unknown) => cause,
  );
  void outcome.then(() => {
    done = true;
  });
  await framesUntil(host, () => done);
  const cause = await outcome;
  if (cause !== null) throw cause;
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

    await framed(host, host.go('Level'));

    expect(server.requests('crate.gltf')).toBe(1);
    expect(host.current).toBe('Level');
    expect(assets.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
    host.dispose();
  });
});

/*
 * A switch with the loading scene up builds the next scene over frames, behind
 * it, while it keeps playing: before, the loading scene was taken down and the
 * next built at once, the spinner standing still for as long as it took.
 */
describe('a switch behind the loading scene', () => {
  const LOADING = fixedId('scene', 'loading');
  const SPINNER = fixedId('asset', 'script-spinner');
  const ARRIVAL = fixedId('asset', 'script-arrival');
  const OTHER = fixedId('asset', 'script-other');

  /** A script logging its hooks under `name`. */
  function logging(name: string, log: string[]): typeof Behaviour {
    return class extends Behaviour {
      override onAwake() {
        log.push(`${name} awake`);
      }

      override onStart() {
        log.push(`${name} start`);
      }

      override onUpdate() {
        log.push(`${name} update`);
      }

      override onSceneUnload() {
        log.push(`${name} unload`);
      }

      override onDestroy() {
        log.push(`${name} destroy`);
      }
    };
  }

  /** A scene with an entity running the script `assetId`, and these others. */
  function running(assetId: AssetId, ...others: readonly EntityTemplate[]): SceneDoc {
    const script: ScriptComponent = { ...scriptType.create(), assetId };
    return sceneWith([createEntity('Runner', [script]), ...others]);
  }

  /** Eight lights, which `slowLights` takes 5 ms each to mount: more than one frame's budget. */
  const lights = () => Array.from({ length: 8 }, () => createLightEntity('point'));

  /** Registries whose worlds take 5 ms to draw each light, saying so in `log`: a scene's build is its drawing. */
  function slowLights(log: string[]): WorldRegistries {
    const base = withoutPhysics(builtInRegistries());
    const systems = new Registry<ComponentTypeId, SystemDefinition>('system');
    for (const definition of base.systems.values()) {
      if (definition.id !== 'light') {
        systems.register(definition);
        continue;
      }
      systems.register({
        id: definition.id,
        create: () => {
          const system = definition.create();
          const mount = system.mount.bind(system);
          system.mount = (...args: Parameters<typeof mount>) => {
            log.push('light mounted');
            const until = performance.now() + 5;
            while (performance.now() < until) {
              // A heavy mount.
            }
            return mount(...args);
          };
          return system;
        },
      });
    }
    return { ...base, systems };
  }

  function hostWith(log: string[]): SceneHost {
    return hostOf(
      {
        [LOADING]: running(SPINNER),
        Level: running(ARRIVAL, ...lights()),
        Other: running(OTHER),
      },
      {
        loadingScene: LOADING,
        registries: slowLights(log),
        scripts: new Map([
          [SPINNER, logging('spinner', log)],
          [ARRIVAL, logging('level', log)],
          [OTHER, logging('other', log)],
        ]),
      },
    );
  }

  it('plays the loading scene while the next builds over frames, then unloads it and starts the next', async () => {
    const log: string[] = [];
    const host = hostWith(log);
    await host.adopt('Menu', sceneWith([]));

    await framed(host, host.go('Level'));

    const first = log.indexOf('light mounted');
    const last = log.lastIndexOf('light mounted');
    expect(log.slice(first, last).filter((line) => line === 'spinner update').length).toBeGreaterThan(0);
    expect(log.slice(last + 1).filter((line) => line !== 'spinner update')).toEqual([
      'spinner unload',
      'spinner destroy',
      'level awake',
      'level start',
    ]);
    expect(host.current).toBe('Level');
    host.dispose();
  });

  it('drops a scene still building when another switch starts', async () => {
    const log: string[] = [];
    const host = hostWith(log);
    await host.adopt('Menu', sceneWith([]));
    const toLevel = host.go('Level');
    await framesUntil(host, () => log.includes('light mounted'));

    await framed(host, host.go('Other'));
    await toLevel;

    expect(host.current).toBe('Other');
    expect(log).not.toContain('level awake');
    expect(log.filter((line) => line === 'spinner unload')).toHaveLength(1);
    expect(log.slice(-2)).toEqual(['other awake', 'other start']);
    host.dispose();
  });

  it('leaves no world when stopped while a scene builds', async () => {
    const log: string[] = [];
    const host = hostWith(log);
    await host.adopt('Menu', sceneWith([]));
    const toLevel = host.go('Level');
    await framesUntil(host, () => log.includes('light mounted'));

    host.dispose();
    await toLevel;
    host.update(STEP);

    expect(host.world).toBeNull();
    expect(host.current).toBeNull();
    expect(log).toContain('spinner destroy');
    expect(log).not.toContain('level awake');
  });
});
