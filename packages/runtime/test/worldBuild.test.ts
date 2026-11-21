import {
  Registry,
  colliderType,
  createEntity,
  createMeshEntity,
  createRenderingSettings,
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
import { World, type SubsystemDefinition, type WorldOptions } from '../src/world/World';
import { serveModels, stubImages } from './assetFixtures';
import { builtInRegistries } from './registries';

/*
 * A world built behind a loading scene: its document mounted an entity at a
 * time as frames come, each after its parent, the environment after the last;
 * ready once what it loads has landed and been handed back; and nothing of the
 * game running until it is started.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const STEP = 1 / 60;
const CRATE = fixedId('asset', 'crate');

/** A subsystem mounting `mounts` that logs what it is handed and each phase it is given. */
function recording(log: string[], mounts: readonly ComponentTypeId[]): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'recording'),
    mounts,
    create: () => ({
      mount: (entityId, component) => void log.push(`mount ${entityId}:${component.type}`),
      patch: (entityId, previous, next) =>
        void log.push(`patch ${entityId}:${previous === next ? 'itself' : next.type}`),
      update: () => void log.push('update'),
      fixed: () => void log.push('fixed'),
      lateUpdate: () => void log.push('lateUpdate'),
      renderPrep: () => void log.push('renderPrep'),
      start: () => void log.push('started'),
      dispose() {},
    }),
  };
}

/** The options of a world of these entities, run by the kernel's subsystems and then these. */
function optionsFor(
  templates: readonly EntityTemplate[],
  definitions: readonly SubsystemDefinition[],
  assets?: AssetCache,
  resolver: AssetResolver = NULL_ASSET_RESOLVER,
): WorldOptions {
  const registries = builtInRegistries();
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const definition of [...registries.subsystems.values(), ...definitions]) subsystems.register(definition);
  return {
    time: new StudioTime(),
    document: sceneWith(templates),
    registries: { ...registries, subsystems },
    assets: assets ?? new AssetCache(registries, { resolver, idleBudgetBytes: 0 }),
    // Off, so that a mesh's object is the one a test reads.
    rendering: { ...createRenderingSettings(), batching: false },
  };
}

/** A world loaded with a budget of nothing: one entity a frame. */
async function building(options: WorldOptions): Promise<World> {
  const world = await World.load({ ...options, buildBudgetMs: 0 });
  onTestFinished(() => world.dispose());
  return world;
}

/** Turns of the event loop, for what a frame started to land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a world built over frames', () => {
  it('mounts one entity a frame with no budget, each under its parent, then puts up the environment', async () => {
    // 250 roots, each with a chain of three below it.
    const templates: EntityTemplate[] = [];
    for (let root = 0; root < 250; root += 1) {
      const chain = [0, 1, 2, 3].map((depth) => createEntity(`E${root}.${depth}`, []));
      chain.reduce((parent, child) => {
        nest(parent, child);
        return child;
      });
      templates.push(...chain);
    }
    const log: string[] = [];
    const world = await building(optionsFor(templates, [recording(log, [])]));

    const miscounted: number[] = [];
    const misplaced: string[] = [];
    let environmentEarly = false;
    for (let frame = 1; frame <= templates.length; frame += 1) {
      if (world.scene.background !== null) environmentEarly = true;
      world.frame(STEP);
      let built = 0;
      for (const { entity } of templates) {
        const object = world.binder.getObject(entity.id);
        if (object === undefined) continue;
        built += 1;
        const parent = entity.parent === null ? world.binder.root : world.binder.getObject(entity.parent);
        if (object.parent !== parent) misplaced.push(`${entity.name} at frame ${frame}`);
      }
      if (built !== frame) miscounted.push(frame);
    }

    expect(miscounted).toEqual([]);
    expect(misplaced).toEqual([]);
    expect(environmentEarly).toBe(false);
    expect(world.scene.background).toBeNull();
    // The budget went with the last entity: the environment takes the next frame.
    world.frame(STEP);
    expect(world.scene.background).not.toBeNull();
    expect(log).toEqual([]);
  });

  it('batches nothing while it builds, and everything in one go once it is whole', async () => {
    const boxes = Array.from({ length: 40 }, () => createMeshEntity('box'));
    const options = optionsFor(boxes, []);
    const world = await building({ ...options, rendering: { ...options.rendering, batching: true } });
    const batches = () => world.binder.root.children.filter((child) => child instanceof BatchedMesh);

    let early = 0;
    for (let frame = 0; frame < boxes.length; frame += 1) {
      world.frame(STEP);
      early += batches().length;
    }
    world.frame(STEP);

    expect(early).toBe(0);
    expect(batches().map((batch) => batch.name)).toEqual(['Batch(40)']);
  });

  it('runs no phase and makes no behaviour before it is started, and both once it is', async () => {
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
    const options = optionsFor([holder], [recording(log, [])]);
    const world = await building({ ...options, scripts: new Map([[SCRIPT, Arrival]]) });

    for (let frame = 0; frame < 3; frame += 1) world.frame(STEP);
    await world.ready;
    world.frame(STEP);
    expect(log).toEqual([]);

    world.start();
    expect(log).toEqual(['awake', 'start', 'started']);
    world.frame(STEP);
    expect(log).toContain('script update');
    expect(log).toContain('renderPrep');
  });

  it('is ready once the models have landed and been read again, a landing handed back', async () => {
    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(new Group());
    });
    vi.spyOn(AssetCache.prototype, 'holdModel').mockReturnValue({ object: inFlight, dispose: () => {} });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const log: string[] = [];
    const options = optionsFor([crate], [recording(log, ['model'])], undefined, { url: () => 'file:///crate.glb' });
    const world = await building(options);
    let ready = false;
    void world.ready.then(() => {
      ready = true;
    });

    // The crate, then the environment.
    world.frame(STEP);
    world.frame(STEP);
    await settled();
    expect(log).toEqual([`mount ${crate.entity.id}:model`]);
    expect(ready).toBe(false);

    land();
    await world.ready;

    expect(log).toEqual([`mount ${crate.entity.id}:model`, `patch ${crate.entity.id}:itself`]);
  });

  it('rejects its ready when disposed before it, and gives back what it held', async () => {
    stubImages();
    const server = await serveModels();
    const registries = builtInRegistries();
    const assets = new AssetCache(registries, {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const world = await building(optionsFor([crate], [], assets));

    world.frame(STEP);
    // The file asked for as the world was made, and the crate's own hold since
    // the frame drew it: the first is given back once the build is whole.
    expect(assets.stats.held).toBe(2);
    world.dispose();

    await expect(world.ready).rejects.toThrow(/disposed/);
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

    const playing = World.play(optionsFor([crate], [slow], assets));
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
    // Physics no longer waits for the models before the build: `ready` does,
    // and the landing is handed back to it before the world starts. Built from
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

    const world = await World.play(optionsFor([slab], [], undefined, { url: () => 'file:///slab.glb' }));
    onTestFinished(() => world.dispose());

    const hit = physicsOf(world)?.raycast({ x: 1.5, y: 5, z: 1.5 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit?.entity).toBe(slab.entity.id);
    expect(Math.abs((hit?.point.y ?? 0) - 0.5)).toBeLessThan(1e-4);
  });
});
