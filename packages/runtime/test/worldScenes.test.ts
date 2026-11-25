import {
  Registry,
  assertDefined,
  audioSourceType,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  createRenderingSettings,
  createSceneId,
  createWaterEntity,
  fixedId,
  modelType,
  skySunDirection,
  type ComponentTypeId,
  type Disposable,
  type EntityTemplate,
  type SceneDoc,
  type SubsystemId,
} from '@three-studio/core';
import { BatchedMesh, PerspectiveCamera, type Object3D } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { audioOf } from '../src/audio/audioOf';
import { audioSourcesOn } from '../src/behaviour/audio';
import { WaterSurface } from '../src/systems/WaterSurface';
import { collisionsOf, physicsOf } from '../src/physics/physicsOf';
import { Behaviour } from '../src/scripting/ScriptHost';
import { StudioTime } from '../src/time/StudioTime';
import type { LoadedScene } from '../src/world/scenes';
import { World, type SubsystemDefinition } from '../src/world/World';
import { serveModels, stubImages } from './assetFixtures';
import { rig as audioRig } from './audio/rig';
import { bundleOf, standInForTheBrowser, takeTheBrowserBack, withBody, withCollider, withScript } from './physics/rig';
import { builtInRegistries } from './registries';

/*
 * One world, several scenes: each built apart from the world's document,
 * hidden under a root of its own and mounted by no subsystem, then started —
 * merged in, mounted, its behaviours made — and unloaded on its own, leaving
 * nothing behind and the other scenes running.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

const STEP = 1 / 60;
const CRATE = fixedId('asset', 'crate');
const HUM = fixedId('asset', 'hum');

/** A subsystem mounting `mounts`, logging what it is handed and when a scene starts. */
function recording(log: string[], mounts: readonly ComponentTypeId[]): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'recording'),
    mounts,
    create: () => ({
      mount: (_entityId, component) => void log.push(`mount ${component.type}`),
      unmount: (_entityId, component) => void log.push(`unmount ${component.type}`),
      start: () => void log.push('started'),
      dispose() {},
    }),
  };
}

/** A script that says, in `log`, what it hears, under `name`. */
function saying(log: string[], name: string) {
  return class extends Behaviour {
    override onAwake() {
      log.push(`${name} awake`);
    }

    override onStart() {
      log.push(`${name} start`);
    }

    override onSceneUnload() {
      log.push(`${name} unload`);
    }

    override onDestroy() {
      log.push(`${name} destroy`);
    }
  };
}

/** A scene of its own id holding these entities. */
function scene(name: string, templates: readonly EntityTemplate[]): SceneDoc {
  return { ...sceneWith(templates), id: createSceneId(), name };
}

/** A running world with no scene, the kernel's subsystems then `log`'s recording of lights, batching on. */
async function playing(log: string[], templates: readonly EntityTemplate[], assets?: AssetCache): Promise<World> {
  stubImages();
  const base = builtInRegistries();
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const definition of [...base.subsystems.values(), recording(log, ['light'])]) subsystems.register(definition);
  const audio = audioRig({ [HUM]: { duration: 2 } }, { shareCache: true });
  const world = await World.play({
    time: new StudioTime(),
    registries: { ...base, subsystems },
    assets: assets ?? new AssetCache(base, { resolver: { url: () => null }, idleBudgetBytes: 0 }),
    rendering: { ...createRenderingSettings(), batching: true },
    scripts: bundleOf(templates),
    audioContext: audio.context,
    audioCache: audio.cache,
  });
  onTestFinished(() => world.dispose());
  return world;
}

/** Loads a scene at once and waits for it. */
async function loaded(world: World, document: SceneDoc, holds: readonly Disposable[] = []): Promise<LoadedScene> {
  const loading = world.loadScene(document, { holds });
  await loading.ready;
  return loading;
}

function batchNames(world: World): string[] {
  return world.binder.root.children.filter((child) => child instanceof BatchedMesh).map(({ name }) => name);
}

function isUnder(object: Object3D, ancestor: Object3D | undefined): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (at === ancestor) return true;
  return false;
}

/** A disposable that counts its disposals. */
function counted(): Disposable & { readonly disposals: number } {
  let disposals = 0;
  return {
    dispose: () => void (disposals += 1),
    get disposals() {
      return disposals;
    },
  };
}

describe('scenes in one world', () => {
  it('starts two scenes into one document, and answers each entity’s scene, a spawn’s included', async () => {
    const log: string[] = [];
    const a = createEntity('A root');
    const b = createEntity('B root');
    const world = await playing(log, []);
    const first = await loaded(world, scene('A', [a]));
    const second = await loaded(world, scene('B', [b]));
    world.setActiveScene(first);
    world.startScene(first);
    world.startScene(second);

    expect([...world.document.entities.keys()]).toEqual([a.entity.id, b.entity.id]);
    expect(world.scenes).toEqual([first, second]);
    expect(world.sceneOf(a.entity.id)).toBe(first);
    expect(world.sceneOf(b.entity.id)).toBe(second);

    const underB = assertDefined(world.spawn(createEntity('Under B'), b.entity.id), 'spawned under B');
    const loose = assertDefined(world.spawn(createEntity('Loose')), 'spawned with no parent');
    expect(world.sceneOf(underB)).toBe(second);
    expect(world.sceneOf(loose)).toBe(first);
    expect(world.binder.getObject(loose)?.parent).toBe(first.root);
  });

  it('keeps a scene loaded and not started out of the document, hidden, unmounted, unscripted and unclaimed', async () => {
    const log: string[] = [];
    const boxes = (count: number) => Array.from({ length: count }, () => createMeshEntity('box'));
    const floor = withCollider('box', [50, 0, 0]);
    const camera = createCameraEntity();
    for (const component of camera.components) if (component.type === 'camera') component.isMain = true;
    const first = withScript(createEntity('First'), saying(log, 'first'));
    const second = withScript(createEntity('Second'), saying(log, 'second'));
    const query = withScript(
      createEntity('Query'),
      class extends Behaviour {
        override onStart() {
          const hit = physicsOf(world)?.raycast({ x: 50, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
          log.push(`hit ${hit?.entity === floor.entity.id ? 'floor' : 'nothing'}`);
        }
      },
    );
    const level = [...boxes(5), floor, camera, createLightEntity('point'), first, second, query];
    const world = await playing(log, level);
    // Four at least make a batch.
    const running = await loaded(world, scene('Running', boxes(4)));
    world.setActiveScene(running);
    world.startScene(running);
    log.length = 0;

    const building = await loaded(world, scene('Level', level));

    expect(world.document.entities.has(floor.entity.id)).toBe(false);
    expect(world.sceneOf(floor.entity.id)).toBeNull();
    const drawn = assertDefined(world.binder.getObject(camera.entity.id), 'the camera drawn');
    expect(isUnder(drawn, building.root)).toBe(true);
    expect(building.root.visible).toBe(false);
    world.frame(STEP);
    expect(batchNames(world)).toEqual(['Batch(4)']);
    expect(log).toEqual([]);
    expect(world.cameras.active.parent).not.toBe(drawn);

    world.startScene(building);

    expect(log).toEqual([
      'mount light',
      'first awake',
      'second awake',
      'first start',
      'second start',
      'hit floor',
      // Registered after the behaviours.
      'started',
    ]);
    expect(building.started).toBe(true);
    expect(building.root.visible).toBe(true);
    // Its five boxes and its floor, a box too, join the running scene's four.
    expect(batchNames(world)).toEqual(['Batch(10)']);
    expect(world.cameras.active).toBeInstanceOf(PerspectiveCamera);
    expect(isUnder(world.cameras.active, drawn)).toBe(true);
  });

  it('draws the active scene’s environment, and lights a building scene’s water by its own sky', async () => {
    const world = await playing([], []);
    const plain = scene('Plain', []);
    const water = createWaterEntity();
    const sea = scene('Sea', [water]);
    sea.environment = { ...sea.environment, sky: { ...plain.environment.sky, elevation: 45, azimuth: 90 } };
    const first = await loaded(world, plain);
    world.setActiveScene(first);
    world.startScene(first);

    const second = await loaded(world, sea);
    const surface = world.binder.getObject(water.entity.id)?.children.find((child) => child instanceof WaterSurface);
    if (!(surface instanceof WaterSurface)) throw new Error('The water drew no surface.');
    const [x, y, z] = skySunDirection(sea.environment.sky);
    expect(surface.sunDirection.value.toArray().map((value) => +value.toFixed(6))).toEqual(
      [x, y, z].map((value) => +value.toFixed(6)),
    );
    expect(world.document.environment).toBe(plain.environment);

    world.startScene(second);
    world.setActiveScene(second);
    expect(world.activeScene).toBe(second);
    expect(world.document.environment).toBe(sea.environment);
  });

  it('unloads a scene whole, its scripts told first, while the other scene’s body falls on', async () => {
    const log: string[] = [];
    const server = await serveModels();
    const base = builtInRegistries();
    const assets = new AssetCache(base, {
      resolver: { url: (id) => (id === CRATE ? server.url('crate.gltf') : null) },
      idleBudgetBytes: 0,
    });
    const faller = withBody('box', [0, 10, 0]);
    const leaving = withScript(createEntity('Leaving'), saying(log, 'leaving'));
    const staying = withScript(createEntity('Staying'), saying(log, 'staying'));
    const crate = createEntity('Crate', [{ ...modelType.create(), assetId: CRATE }]);
    const body = withBody('sphere', [20, 10, 0]);
    const listener = withScript(
      createEntity('Listener'),
      class extends Behaviour {
        override onCollisionEnter() {}
      },
    );
    const speaker = createEntity('Speaker', [
      { ...audioSourceType.create(), assetId: HUM, playOnStart: true, loop: true },
    ]);
    const camera = createCameraEntity();
    const world = await playing(log, [faller, staying, leaving, listener], assets);
    const kept = await loaded(world, scene('Kept', [faller, staying]));
    world.setActiveScene(kept);
    world.startScene(kept);
    const hold = counted();
    const gone = await loaded(world, scene('Gone', [leaving, crate, body, listener, speaker, camera]), [hold]);
    world.startScene(gone);
    for (let frame = 0; frame < 3; frame += 1) world.frame(STEP);
    expect(assets.stats.held).toBe(1);
    expect(collisionsOf(world)?.listenedEntities()).toContain(listener.entity.id);
    const audio = assertDefined(audioOf(world), 'the audio');
    expect(audioSourcesOn(audio, speaker.entity.id)).toHaveLength(1);
    const cameraDrawn = assertDefined(world.binder.getObject(camera.entity.id), 'the camera drawn');
    expect(isUnder(world.cameras.active, cameraDrawn)).toBe(true);
    const height = () => assertDefined(physicsOf(world)?.body(faller.entity.id), 'the faller').position.y;
    const before = height();
    log.length = 0;

    world.unloadScene(gone);

    expect(log).toEqual(['leaving unload', 'leaving destroy']);
    expect(world.scenes).toEqual([kept]);
    for (const { entity } of [leaving, crate, body, listener, speaker, camera]) {
      expect(world.document.entities.has(entity.id)).toBe(false);
      expect(world.binder.getObject(entity.id)).toBeUndefined();
    }
    expect(physicsOf(world)?.body(body.entity.id)).toBeNull();
    expect(collisionsOf(world)?.listenedEntities()).not.toContain(listener.entity.id);
    expect(audioSourcesOn(audio, speaker.entity.id)).toEqual([]);
    expect(isUnder(world.cameras.active, cameraDrawn)).toBe(false);
    expect(gone.root.parent).toBeNull();
    expect(hold.disposals).toBe(1);
    expect(assets.stats.held).toBe(0);
    await expect(gone.ready).resolves.toBeUndefined();
    log.length = 0;

    world.frame(STEP);
    expect(height()).toBeLessThan(before);
    expect(log).toEqual([]);
  });

  it('refuses a scene already loaded, or sharing an entity id with a started or a building scene', async () => {
    const log: string[] = [];
    const shared = createEntity('Shared');
    const other = createEntity('Other');
    const world = await playing(log, []);
    const first = await loaded(world, scene('First', [shared]));
    world.setActiveScene(first);
    world.startScene(first);
    const building = world.loadScene(scene('Building', [other]), { buildBudgetMs: 0 });

    const again = world.loadScene({ ...scene('First', []), id: first.id });
    const hold = counted();
    const clash = world.loadScene(scene('Clash', [{ entity: { ...shared.entity }, components: [] }]), {
      holds: [hold],
    });
    const late = world.loadScene(scene('Late', [{ entity: { ...other.entity }, components: [] }]));

    await expect(again.ready).rejects.toThrow('Scene "First" is already loaded.');
    await expect(clash.ready).rejects.toThrow(/"Clash".*"Shared".*"First"/);
    await expect(late.ready).rejects.toThrow(/"Late".*"Other".*"Building"/);
    expect(world.scenes).toEqual([first, building]);
    expect(clash.root.parent).toBeNull();
    expect(hold.disposals).toBe(1);
    expect(world.warnings.filter((warning) => warning.includes('not loaded'))).toHaveLength(2);
  });

  it('refuses to start or unload a scene inside a frame', async () => {
    let thrown: unknown[] = [];
    const impatient = withScript(
      createEntity('Impatient'),
      class extends Behaviour {
        override onUpdate() {
          for (const call of [() => world.startScene(second), () => world.unloadScene(first)]) {
            try {
              call();
            } catch (cause) {
              thrown = [...thrown, cause];
            }
          }
        }
      },
    );
    const world = await playing([], [impatient]);
    const first = await loaded(world, scene('First', []));
    world.setActiveScene(first);
    world.startScene(first);
    const second = await loaded(world, scene('Second', []));
    world.spawn(impatient);
    world.frame(STEP);
    world.frame(STEP);

    expect(thrown).toHaveLength(2);
    expect(second.started).toBe(false);
    expect(world.scenes).toEqual([first, second]);
  });

  it('plays a document handed to it as its first scene, loaded, active and started', async () => {
    const log: string[] = [];
    const holder = withScript(createEntity('Holder'), saying(log, 'holder'));
    const base = builtInRegistries();
    const world = await World.play({
      time: new StudioTime(),
      document: scene('Entry', [holder]),
      registries: base,
      assets: new AssetCache(base, { resolver: { url: () => null }, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
      scripts: bundleOf([holder]),
    });
    onTestFinished(() => world.dispose());

    expect(world.activeScene?.name).toBe('Entry');
    expect(world.activeScene?.started).toBe(true);
    expect(world.sceneOf(holder.entity.id)).toBe(world.activeScene);
    expect(log).toEqual(['holder awake', 'holder start']);
  });
});
