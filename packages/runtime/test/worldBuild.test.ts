import {
  Registry,
  assertDefined,
  colliderType,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  createRenderingSettings,
  createSceneId,
  fixedId,
  modelType,
  scriptType,
  type ComponentTypeId,
  type EntityTemplate,
  type SubsystemId,
} from '@three-studio/core';
import { BatchedMesh, BoxGeometry, Group, Mesh, type Object3D } from 'three/webgpu';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { nest, sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER, type AssetResolver } from '../src/assets/AssetResolver';
import { physicsOf } from '../src/physics/physicsOf';
import { Behaviour } from '../src/scripting/ScriptHost';
import { StudioTime } from '../src/time/StudioTime';
import type { LoadedScene } from '../src/world/scenes';
import { World, type SubsystemDefinition, type WorldOptions } from '../src/world/World';
import { serveModels, stubImages } from './assetFixtures';
import { bundleOf, withBody, withScript } from './physics/rig';
import { builtInRegistries } from './registries';

/*
 * A scene built into a running world over frames: its entities synced one at
 * a time as frames come, each after its parent, hidden under its own root;
 * ready once what it loads has landed; and nothing of it mounted, drawn or
 * run until it is started.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const STEP = 1 / 60;
const CRATE = fixedId('asset', 'crate');

/** A subsystem mounting `mounts` that logs what it is handed and when it starts. */
function recording(log: string[], mounts: readonly ComponentTypeId[]): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'recording'),
    mounts,
    create: () => ({
      mount: (entityId, component) => void log.push(`mount ${entityId}:${component.type}`),
      patch: (entityId, previous, next) =>
        void log.push(`patch ${entityId}:${previous === next ? 'itself' : next.type}`),
      start: () => void log.push('started'),
      dispose() {},
    }),
  };
}

/** The options of a world run by the kernel's subsystems and then these. */
function optionsFor(
  definitions: readonly SubsystemDefinition[],
  assets?: AssetCache,
  resolver: AssetResolver = NULL_ASSET_RESOLVER,
): WorldOptions {
  const registries = builtInRegistries();
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const definition of [...registries.subsystems.values(), ...definitions]) subsystems.register(definition);
  return {
    time: new StudioTime(),
    registries: { ...registries, subsystems },
    assets: assets ?? new AssetCache(registries, { resolver, idleBudgetBytes: 0 }),
    // Off, so that a mesh's object is the one a test reads.
    rendering: { ...createRenderingSettings(), batching: false },
  };
}

/** A running world with no scene, and these entities loaded into it with a budget of nothing: one a frame. */
async function building(
  options: WorldOptions,
  templates: readonly EntityTemplate[],
): Promise<{ world: World; scene: LoadedScene }> {
  const world = await World.play(options);
  onTestFinished(() => world.dispose());
  return { world, scene: world.loadScene(sceneWith(templates), { buildBudgetMs: 0 }) };
}

function isUnder(object: Object3D, ancestor: Object3D | undefined): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (at === ancestor) return true;
  return false;
}

/** Turns of the event loop, for what a frame started to land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a scene built over frames', () => {
  it('builds one entity a frame while the running scene plays on, and mounts, draws, claims and runs none of it before its start', async () => {
    // 250 roots, each with a chain of three below it, and a model, a main
    // camera, a light and a script among them: 1 004 entities.
    const templates: EntityTemplate[] = [];
    for (let root = 0; root < 250; root += 1) {
      const chain = [0, 1, 2, 3].map((depth) => createEntity(`E${root}.${depth}`, []));
      chain.reduce((parent, child) => {
        nest(parent, child);
        return child;
      });
      templates.push(...chain);
    }
    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(new Group());
    });
    vi.spyOn(AssetCache.prototype, 'holdModel').mockReturnValue({ object: inFlight, dispose: () => {} });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const camera = createCameraEntity();
    for (const component of camera.components) if (component.type === 'camera') component.isMain = true;
    const log: string[] = [];
    const arrival = withScript(
      createEntity('Arrival'),
      class extends Behaviour {
        override onAwake() {
          log.push('arrival awake');
        }
      },
    );
    const light = createLightEntity('point');
    templates.push(crate, camera, light, arrival);
    let updates = 0;
    const runner = withScript(
      createEntity('Runner'),
      class extends Behaviour {
        override onUpdate() {
          updates += 1;
        }
      },
    );
    const faller = withBody('box', [0, 100, 0]);
    const options = optionsFor([recording(log, ['light', 'model'])], undefined, { url: () => 'file:///crate.glb' });
    const world = await World.play({ ...options, scripts: bundleOf([runner, arrival]) });
    onTestFinished(() => world.dispose());
    const running = world.loadScene(sceneWith([runner, faller]));
    await running.ready;
    world.setActiveScene(running);
    world.startScene(running);
    log.length = 0;
    const height = () => physicsOf(world)?.body(faller.entity.id)?.position.y ?? Number.NaN;

    // An id of its own: a world loads a scene once.
    const scene = world.loadScene({ ...sceneWith(templates), id: createSceneId() }, { buildBudgetMs: 0 });
    let ready = false;
    void scene.ready.then(() => {
      ready = true;
    });
    const miscounted: number[] = [];
    const misplaced: string[] = [];
    const stalled: number[] = [];
    for (let frame = 1; frame <= templates.length; frame += 1) {
      const before = height();
      world.frame(STEP);
      if (!(height() < before) || updates !== frame) stalled.push(frame);
      const { entity } = assertDefined(templates[frame - 1], 'the entity built');
      const parent = entity.parent === null ? scene.root : world.binder.getObject(entity.parent);
      if (world.binder.getObject(entity.id)?.parent !== parent) misplaced.push(`${entity.name} at frame ${frame}`);
      if (templates.filter(({ entity }) => world.binder.getObject(entity.id) !== undefined).length !== frame) {
        miscounted.push(frame);
      }
    }
    world.frame(STEP);
    await settled();

    expect(miscounted).toEqual([]);
    expect(misplaced).toEqual([]);
    expect(stalled).toEqual([]);
    // Built, its model still in flight.
    expect(ready).toBe(false);
    expect(scene.root.visible).toBe(false);
    expect(world.document.entities.has(camera.entity.id)).toBe(false);
    expect(isUnder(world.cameras.active, world.binder.getObject(camera.entity.id))).toBe(false);
    expect(log).toEqual([]);

    land();
    await scene.ready;
    world.startScene(scene);

    expect(log).toEqual([
      `mount ${crate.entity.id}:model`,
      `mount ${light.entity.id}:light`,
      'arrival awake',
      'started',
    ]);
    expect(scene.root.visible).toBe(true);
    expect(isUnder(world.cameras.active, world.binder.getObject(camera.entity.id))).toBe(true);
  });

  it('batches nothing while it builds, and everything in one go once it starts', async () => {
    const boxes = Array.from({ length: 40 }, () => createMeshEntity('box'));
    const options = optionsFor([]);
    const { world, scene } = await building({ ...options, rendering: { ...options.rendering, batching: true } }, boxes);
    const batches = () => world.binder.root.children.filter((child) => child instanceof BatchedMesh);

    let early = 0;
    for (let frame = 0; frame < boxes.length; frame += 1) {
      world.frame(STEP);
      early += batches().length;
    }
    await scene.ready;
    world.frame(STEP);
    early += batches().length;
    world.startScene(scene);

    expect(early).toBe(0);
    expect(batches().map((batch) => batch.name)).toEqual(['Batch(40)']);
  });

  it('mounts nothing and makes no behaviour before it is started, and both once it is', async () => {
    const log: string[] = [];
    class Arrival extends Behaviour {
      override onAwake() {
        log.push('awake');
      }

      override onStart() {
        log.push('start');
      }

      override onUpdate() {
        log.push('script update');
      }
    }
    const SCRIPT = fixedId('asset', 'script-arrival');
    const holder = createEntity('Holder', [{ ...scriptType.create(), assetId: SCRIPT }]);
    const options = optionsFor([recording(log, ['script'])]);
    const { world, scene } = await building({ ...options, scripts: new Map([[SCRIPT, Arrival]]) }, [holder]);

    for (let frame = 0; frame < 3; frame += 1) world.frame(STEP);
    await scene.ready;
    world.frame(STEP);
    expect(log).toEqual([]);

    world.startScene(scene);
    expect(log).toEqual([`mount ${holder.entity.id}:script`, 'awake', 'start', 'started']);
    world.frame(STEP);
    expect(log).toContain('script update');
  });

  it('is ready once its models have landed, and mounts them at its start as they landed', async () => {
    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(new Group());
    });
    vi.spyOn(AssetCache.prototype, 'holdModel').mockReturnValue({ object: inFlight, dispose: () => {} });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const log: string[] = [];
    const options = optionsFor([recording(log, ['model'])], undefined, { url: () => 'file:///crate.glb' });
    const { world, scene } = await building(options, [crate]);
    let ready = false;
    void scene.ready.then(() => {
      ready = true;
    });

    world.frame(STEP);
    world.frame(STEP);
    await settled();
    expect(ready).toBe(false);

    land();
    await scene.ready;
    world.frame(STEP);
    expect(log).toEqual([]);

    world.startScene(scene);
    expect(log).toEqual([`mount ${crate.entity.id}:model`, 'started']);
  });

  it('rejects its ready when unloaded while it builds, and gives back what it held', async () => {
    stubImages();
    const server = await serveModels();
    const registries = builtInRegistries();
    const assets = new AssetCache(registries, {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const { world, scene } = await building(optionsFor([], assets), [crate, createMeshEntity('box')]);

    world.frame(STEP);
    expect(assets.stats.held).toBe(1);
    world.unloadScene(scene);

    await expect(scene.ready).rejects.toThrow(/unloaded/);
    expect(world.binder.getObject(crate.entity.id)).toBeUndefined();
    expect(world.scenes).toEqual([]);
    expect(assets.stats.held).toBe(0);
  });

  it('rejects its ready when its world is disposed before it, and gives back what it held', async () => {
    stubImages();
    const server = await serveModels();
    const registries = builtInRegistries();
    const assets = new AssetCache(registries, {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const { world, scene } = await building(optionsFor([], assets), [crate]);

    world.frame(STEP);
    expect(assets.stats.held).toBe(1);
    world.dispose();

    await expect(scene.ready).rejects.toThrow(/disposed/);
    expect(assets.stats.held).toBe(0);
  });
});

describe('Play’s world, built at once', () => {
  it('asks for its scene’s files while its subsystems are made, before the build that draws them', async () => {
    // Rapier's start is the slow one to make, and the binder used to have the
    // models loading through it. A subsystem that waits stands in for it here.
    stubImages();
    const server = await serveModels();
    const registries = builtInRegistries();
    const assets = new AssetCache(registries, {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    let entered = (): void => {};
    const making = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = (): void => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SubsystemDefinition = {
      id: fixedId('subsystem', 'slow'),
      create: async () => {
        entered();
        await released;
        return { dispose() {} };
      },
    };
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);

    const playing = World.play({ ...optionsFor([slow], assets), document: sceneWith([crate]) });
    await making;
    let waited = 0;
    while (server.requests('crate.gltf') === 0 && waited < 200) {
      await settled();
      waited += 1;
    }
    const requestedWhileMaking = server.requests('crate.gltf');
    release();
    const world = await playing;
    onTestFinished(() => world.dispose());

    expect(requestedWhileMaking).toBe(1);
    expect(server.requests('crate.gltf')).toBe(1);
    expect(assets.stats.held).toBe(1);
  });

  it('starts with a mesh Collider built from its model, which landed after the pass that mounted it', async () => {
    // Physics no longer waits for the models before the build: the scene's
    // `ready` does, and it starts with the model in place. Built from
    // the empty group a glTF hangs from, an imported level was a box the
    // player fell straight past.
    vi.spyOn(AssetCache.prototype, 'holdModel').mockImplementation(() => ({
      object: new Promise<Object3D>((resolve) => {
        setTimeout(() => resolve(new Group().add(new Mesh(new BoxGeometry(4, 1, 4)))), 0);
      }),
      dispose: () => {},
    }));
    const slab = createEntity('Slab', [
      { ...modelType.create(), assetId: fixedId('asset', 'slab') },
      { ...colliderType.create(), shape: { kind: 'mesh', build: 'triangles' } },
    ]);

    const world = await World.play({
      ...optionsFor([], undefined, { url: () => 'file:///slab.glb' }),
      document: sceneWith([slab]),
    });
    onTestFinished(() => world.dispose());

    const hit = physicsOf(world)?.raycast({ x: 1.5, y: 5, z: 1.5 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit?.entity).toBe(slab.entity.id);
    expect(Math.abs((hit?.point.y ?? 0) - 0.5)).toBeLessThan(1e-4);
  });
});
