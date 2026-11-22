import {
  Registry,
  assertDefined,
  createEntity,
  createLightEntity,
  createRenderingSettings,
  createSceneId,
  fixedId,
  modelType,
  type AssetId,
  type ComponentTypeId,
  type EntityTemplate,
  type SceneDoc,
} from '@three-studio/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import { Game, type GameOptions } from '../src/game/Game';
import type { SceneApi } from '../src/sceneApi';
import { worldScriptsOf } from '../src/scripting/ScriptWorld';
import type { ScriptClass } from '../src/scripting/scriptBundle';
import { Behaviour } from '../src/scripting/ScriptHost';
import type { SystemDefinition } from '../src/systems/ComponentSystem';
import { StudioTime } from '../src/time/StudioTime';
import type { WorldRegistries } from '../src/world/World';
import { serveModels, stubImages, type ModelServer } from './assetFixtures';
import { bundleOf, standInForTheBrowser, takeTheBrowserBack, withScript } from './physics/rig';
import { builtInRegistries, withoutPhysics } from './registries';

/*
 * A game: one world for the whole of it, into which each scene loads, starts
 * and goes. What a switch keeps — the world, what two scenes share — and what
 * it leaves behind — nothing of the scene left.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

const STEP = 1 / 60;

/** A scene of these templates, under a name and an id of its own: two scenes of one world never share an id. */
function scene(name: string, ...templates: readonly EntityTemplate[]): SceneDoc {
  return { ...sceneWith(templates), id: createSceneId(), name };
}

/** A scene with an entity running the script `type`, filed in `scripts` as a build compiles it, and these others. */
function running(
  name: string,
  type: ScriptClass,
  scripts: Map<AssetId, unknown>,
  ...others: readonly EntityTemplate[]
): SceneDoc {
  const runner = withScript(createEntity('Runner'), type);
  for (const [assetId, made] of bundleOf([runner])) scripts.set(assetId, made);
  return scene(name, runner, ...others);
}

function gameOf(
  scenes: Readonly<Record<string, SceneDoc>>,
  extra: Partial<Pick<GameOptions, 'assets' | 'loadingScene' | 'registries' | 'scripts' | 'prefabs'>> = {},
): Game {
  const registries = builtInRegistries();
  return new Game({
    time: new StudioTime(),
    source: {
      read: async (name) => {
        const found = scenes[name];
        if (!found) throw new Error(`No scene "${name}".`);
        return structuredClone(found);
      },
    },
    // Rapier is not what this is about, and it is the one slow thing to load.
    registries: extra.registries ?? withoutPhysics(registries),
    scripts: extra.scripts ?? new Map(),
    assets: extra.assets ?? new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    loadingScene: extra.loadingScene ?? null,
    prefabs: extra.prefabs,
    rendering: createRenderingSettings(),
  });
}

/** The game's frames, as a player's loop runs them, until `condition` holds. */
async function framesUntil(game: Game, condition: () => boolean): Promise<void> {
  for (let frame = 0; frame < 5000; frame += 1) {
    if (condition()) return;
    game.update(STEP);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Still waiting after 5 000 frames.');
}

/** The game's frames until `going` settles: a scene behind the loading scene builds as they come. */
async function framed(game: Game, going: Promise<void>): Promise<void> {
  let done = false;
  const outcome = going.then(
    () => null,
    (cause: unknown) => cause,
  );
  void outcome.then(() => {
    done = true;
  });
  await framesUntil(game, () => done);
  const cause = await outcome;
  if (cause !== null) throw cause;
}

/** A script logging its hooks under `name`. */
function logging(name: string, log: string[]): ScriptClass {
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

/** A scene running `logging(name, log)`, and these others. */
function logged(
  name: string,
  log: string[],
  scripts: Map<AssetId, unknown>,
  ...others: readonly EntityTemplate[]
): SceneDoc {
  return running(name, logging(name, log), scripts, ...others);
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

/*
 * Where a script is, as it asks `scenes.current`. It read `null` in the first
 * scene's `onStart`, and the name of the scene just left in every later one: a
 * level that restarted itself from `onStart` restarted the previous one, or
 * failed on `No scene "null"`.
 */
describe('scenes.current, as a script sees it', () => {
  function where(seen: [string, string | null][], held: SceneApi[]): ScriptClass {
    return class extends Behaviour {
      override onAwake() {
        seen.push(['awake', this.scenes?.current ?? null]);
      }

      override onStart() {
        seen.push(['start', this.scenes?.current ?? null]);
        if (this.scenes) held.push(this.scenes);
      }
    };
  }

  it('names the first scene from its first onAwake and onStart', async () => {
    const seen: [string, string | null][] = [];
    const scripts = new Map<AssetId, unknown>();
    const menu = running('Menu', where(seen, []), scripts);
    const game = gameOf({}, { scripts });

    await game.start('Menu', menu);

    expect(seen).toEqual([
      ['awake', 'Menu'],
      ['start', 'Menu'],
    ]);
    game.dispose();
  });

  it('names the scene moved to, not the one left, and each scene’s scripts their own', async () => {
    const seen: [string, string | null][] = [];
    const held: SceneApi[] = [];
    const type = where(seen, held);
    const scripts = new Map<AssetId, unknown>();
    const menu = running('Menu', type, scripts);
    const level = running('Level', type, scripts);
    const game = gameOf({ Level: level }, { scripts });
    await game.start('Menu', menu);
    seen.length = 0;

    await game.go('Level');

    expect(seen).toEqual([
      ['awake', 'Level'],
      ['start', 'Level'],
    ]);
    expect(game.current).toBe('Level');
    expect(held.map((scenes) => scenes.current)).toEqual(['Menu', 'Level']);
    game.dispose();
  });
});

describe('a game', () => {
  it('keeps one world across its switches, and says only the problems of the scene it runs', async () => {
    const game = gameOf({ A: scene('A'), B: scene('B') });
    await game.start('A', scene('A'));
    const world = assertDefined(game.world, 'the world');
    world.warn('A problem of A.');

    await game.go('B');

    expect(game.world).toBe(world);
    expect(world.warnings).not.toContain('A problem of A.');
    expect(world.warnings).toContain('No camera and no player controller; using a default view.');
    await game.go('A');
    expect(game.world).toBe(world);
    expect(world.scenes.map(({ name }) => name)).toEqual(['A']);
    game.dispose();
    expect(game.world).toBeNull();
  });

  it('takes the scene left down before it builds the next, with no loading scene', async () => {
    const log: string[] = [];
    const scripts = new Map<AssetId, unknown>();
    const a = logged('A', log, scripts);
    const b = logged('B', log, scripts, ...lights());
    const game = gameOf({ B: b }, { scripts, registries: slowLights(log) });
    await game.start('A', a);

    await game.go('B');

    expect(log.indexOf('A destroy')).toBeLessThan(log.indexOf('light mounted'));
    expect(log.slice(log.indexOf('A unload'))).toEqual([
      'A unload',
      'A destroy',
      ...Array.from({ length: 8 }, () => 'light mounted'),
      'B awake',
      'B start',
    ]);
    game.dispose();
  });

  it('runs a switch a script asks for in onUpdate once the frame is over', async () => {
    const log: string[] = [];
    const scripts = new Map<AssetId, unknown>();
    class Leaver extends Behaviour {
      override onUpdate() {
        log.push('leaving');
        void this.scenes?.go('B');
      }
    }
    const a = running('A', Leaver, scripts);
    const b = logged('B', log, scripts);
    const game = gameOf({ B: b }, { scripts });
    await game.start('A', a);

    // A scene that started or went inside the frame throws there.
    expect(() => game.update(STEP)).not.toThrow();
    expect(log).toEqual(['leaving']);

    await framesUntil(game, () => game.current === 'B');
    expect(log.slice(log.indexOf('B awake'), log.indexOf('B awake') + 2)).toEqual(['B awake', 'B start']);
    game.dispose();
  });
});

/*
 * What a switch between two scenes keeps. A build's cache keeps nothing that
 * nothing holds, so a model two consecutive scenes share must never drop to
 * no holder between them: a load holds what the next scene needs from the
 * moment it has read it, and its scene holds it from then until its unload.
 */
describe('a switch between scenes', () => {
  const CRATE = fixedId('asset', 'crate');
  const LOADING = fixedId('scene', 'loading');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** A scene placing the crate. */
  function withCrate(name: string): SceneDoc {
    return scene(name, createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]));
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
    const game = gameOf({ Level: withCrate('Level') }, { assets });
    await game.start('Menu', withCrate('Menu'));

    await game.go('Level');

    expect(server.requests('crate.gltf')).toBe(1);
    // The level holds it twice, and nothing else does: its scene, from its
    // read to its unload, and the object that draws it.
    expect(assets.stats).toEqual({ entries: 1, held: 2, idleBytes: 0 });
    game.dispose();
    expect(assets.stats.held).toBe(0);
  });

  it('gives back what a load held when it is cancelled, or replaced by another', async () => {
    stubImages();
    const server = await serveModels();
    const assets = buildCache(server);
    const game = gameOf({ Level: withCrate('Level'), Empty: scene('Empty') }, { assets });
    await game.start('Menu', scene('Menu'));

    const level = game.load('Level');
    await level.ready;
    // Ready means in hand: held until the switch, which a Press Start may keep waiting.
    expect(assets.stats.held).toBe(1);
    level.cancel();
    expect(assets.stats.held).toBe(0);

    const first = game.load('Level');
    await first.ready;
    expect(assets.stats.held).toBe(1);
    const second = game.load('Empty');
    expect(assets.stats.held).toBe(0);

    await second.activate();
    expect(game.current).toBe('Empty');
    game.dispose();
  });

  it('puts the loading scene up without dropping what the target shares with the scene left', async () => {
    stubImages();
    const server = await serveModels();
    const assets = buildCache(server);
    const game = gameOf({ Level: withCrate('Level'), [LOADING]: scene('Loading') }, { assets, loadingScene: LOADING });
    await game.start('Menu', withCrate('Menu'));

    await framed(game, game.go('Level'));

    expect(server.requests('crate.gltf')).toBe(1);
    expect(game.current).toBe('Level');
    expect(assets.stats).toEqual({ entries: 1, held: 2, idleBytes: 0 });
    game.dispose();
  });
});

/*
 * What a scene's scripts may instantiate is held while the scene is loaded. A
 * prefab a script was given is drawn by nothing at start, and under a build's
 * idle budget of nothing its model would be freed a frame after its last
 * instance went and fetched again for the next: a spawner's every crate a
 * request.
 */
describe('what a scene can instantiate', () => {
  const CRATE_MODEL = fixedId('asset', 'crate-model');
  const CRATE = fixedId('asset', 'crate-prefab');

  class Spawner extends Behaviour {}

  /** Turns of the event loop, for a model a frame asked for to land. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is held from its scene’s read to its unload, and its model fetched once however many come and go', async () => {
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
    const game = gameOf(
      { Empty: scene('Empty') },
      { assets, scripts: bundleOf([spawner]), prefabs: new Map([[CRATE, prefab]]), registries: withoutPhysics(registries) },
    );
    await game.start('Level', scene('Level', spawner));

    expect(assets.stats.held).toBe(1);
    expect(server.requests('crate.gltf')).toBe(1);

    const world = assertDefined(game.world, 'the world');
    const scripts = assertDefined(worldScriptsOf(world), "the world's scripts");
    for (let round = 0; round < 10; round += 1) {
      const placed = assertDefined(scripts.instantiate(CRATE), 'a crate');
      game.update(STEP);
      await settled();
      placed.destroy();
      game.update(STEP);
      assets.beginFrame();
    }

    expect(assets.stats.held).toBe(1);
    expect(server.requests('crate.gltf')).toBe(1);

    await game.go('Empty');

    expect(assets.stats.held).toBe(0);
    game.dispose();
  });
});

/*
 * A switch with the loading scene up builds the next scene over frames, behind
 * it, while it keeps playing: the spinner turns while the next level builds.
 */
describe('a switch behind the loading scene', () => {
  const LOADING = fixedId('scene', 'loading');

  function gameWith(log: string[]): Game {
    const scripts = new Map<AssetId, unknown>();
    return gameOf(
      {
        [LOADING]: logged('spinner', log, scripts),
        Level: logged('level', log, scripts, ...lights()),
        Other: logged('other', log, scripts),
      },
      { loadingScene: LOADING, registries: slowLights(log), scripts },
    );
  }

  it('plays the loading scene while the next builds over frames, then unloads it and starts the next', async () => {
    const log: string[] = [];
    const game = gameWith(log);
    await game.start('Menu', scene('Menu'));

    await framed(game, game.go('Level'));

    const first = log.indexOf('light mounted');
    const last = log.lastIndexOf('light mounted');
    expect(log.slice(first, last).filter((line) => line === 'spinner update').length).toBeGreaterThan(0);
    expect(log.slice(last + 1).filter((line) => line !== 'spinner update')).toEqual([
      'spinner unload',
      'spinner destroy',
      'level awake',
      'level start',
    ]);
    expect(game.current).toBe('Level');
    expect(assertDefined(game.world, 'the world').scenes.map(({ name }) => name)).toEqual(['level']);
    game.dispose();
  });

  it('drops a scene still building when another switch starts', async () => {
    const log: string[] = [];
    const game = gameWith(log);
    await game.start('Menu', scene('Menu'));
    const toLevel = game.go('Level');
    await framesUntil(game, () => log.includes('light mounted'));

    await framed(game, game.go('Other'));
    await toLevel;

    expect(game.current).toBe('Other');
    expect(log).not.toContain('level awake');
    expect(log.filter((line) => line === 'spinner unload')).toHaveLength(1);
    expect(log.slice(-2)).toEqual(['other awake', 'other start']);
    expect(assertDefined(game.world, 'the world').scenes.map(({ name }) => name)).toEqual(['other']);
    game.dispose();
  });

  it('leaves no world when stopped while a scene builds', async () => {
    const log: string[] = [];
    const game = gameWith(log);
    await game.start('Menu', scene('Menu'));
    const toLevel = game.go('Level');
    await framesUntil(game, () => log.includes('light mounted'));

    game.dispose();
    await toLevel;
    game.update(STEP);

    expect(game.world).toBeNull();
    expect(game.current).toBeNull();
    expect(log).toContain('spinner destroy');
    expect(log).not.toContain('level awake');
  });
});
