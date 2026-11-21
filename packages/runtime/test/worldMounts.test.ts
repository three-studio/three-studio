import {
  Registry,
  assertDefined,
  collectDescendants,
  createCameraEntity,
  createEntity,
  createLight,
  createLightEntity,
  createMeshComponent,
  createMeshEntity,
  createRenderingSettings,
  findComponent,
  fixedId,
  modelType,
  type ComponentDoc,
  type ComponentTypeId,
  type EntityId,
  type EntityTemplate,
  type SubsystemId,
} from '@three-studio/core';
import { Group, type Object3D } from 'three/webgpu';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { nest, prefabWith, sceneWith } from '../../core/test/fixtures';
import { AssetCache } from '../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER, type AssetResolver } from '../src/assets/AssetResolver';
import { StudioTime } from '../src/time/StudioTime';
import { World, type Phase, type Subsystem, type SubsystemDefinition, type WorldOptions } from '../src/world/World';
import { builtInRegistries } from './registries';

/*
 * A running world keeps its scene as a document of its own, which its game
 * edits — spawns, destroys, instantiates, puts and deletes components — and
 * once a frame, after the late hooks, one pass brings the drawing side and
 * every subsystem in line with it. A subsystem is handed the components of the
 * types it declares, one by one, paired by component id.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const A = fixedId('subsystem', 'a');
const B = fixedId('subsystem', 'b');
const LAMP = fixedId('entity', 'lamp');
const STEP = 1 / 60;

/** What a test calls a component in a log, when it gave it a name; its type otherwise. */
const labels = new WeakMap<ComponentDoc, string>();

function labelled<T extends ComponentDoc>(component: T, label: string): T {
  labels.set(component, label);
  return component;
}

const tag = (component: ComponentDoc): string => labels.get(component) ?? component.type;

/** An entity under an id a log can show. */
function named<T extends EntityTemplate>(template: T, id: EntityId): T {
  template.entity.id = id;
  return template;
}

/**
 * A subsystem mounting `mounts` that logs what it is handed, each mount and
 * unmount saying whether the drawing side holds the entity's object then, and
 * each phase it is given.
 */
function recording(
  id: SubsystemId,
  log: string[],
  mounts: readonly ComponentTypeId[],
  phases: readonly Phase[] = [],
): SubsystemDefinition {
  const name: string = id;
  return {
    id,
    mounts,
    create(world) {
      const drawn = (entityId: EntityId) => (world.binder.getObject(entityId) === undefined ? 'undrawn' : 'drawn');
      const subsystem: Subsystem = {
        mount: (entityId, component) => void log.push(`${name} mount ${entityId}:${tag(component)} ${drawn(entityId)}`),
        patch: (entityId, previous, next) =>
          void log.push(`${name} patch ${entityId}:${tag(previous)}→${previous === next ? 'itself' : tag(next)}`),
        unmount: (entityId, component) =>
          void log.push(`${name} unmount ${entityId}:${tag(component)} ${drawn(entityId)}`),
        settle: () => void log.push(`${name} settle`),
        dispose() {},
      };
      for (const phase of phases) subsystem[phase] = () => void log.push(`${name} ${phase}`);
      return subsystem;
    },
  };
}

/** A log's handouts, its settles left out. */
const handouts = (log: readonly string[]): string[] => log.filter((line) => !line.endsWith(' settle'));

/** The options of a world of these entities, run by these subsystems alone. */
function optionsFor(
  definitions: readonly SubsystemDefinition[],
  templates: readonly EntityTemplate[],
  resolver: AssetResolver = NULL_ASSET_RESOLVER,
): WorldOptions {
  const registries = builtInRegistries();
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const definition of definitions) subsystems.register(definition);
  return {
    time: new StudioTime(),
    document: sceneWith(templates),
    registries: { ...registries, subsystems },
    assets: new AssetCache(registries, { resolver, idleBudgetBytes: 0 }),
    // Off, so that a mesh's object is the one a test reads.
    rendering: { ...createRenderingSettings(), batching: false },
  };
}

/** A world in Play, disposed when the test finishes. */
async function playing(
  definitions: readonly SubsystemDefinition[],
  templates: readonly EntityTemplate[],
  extra: Pick<WorldOptions, 'prefabs'> = {},
  resolver?: AssetResolver,
): Promise<World> {
  const world = await World.play({ ...optionsFor(definitions, templates, resolver), ...extra });
  onTestFinished(() => world.dispose());
  return world;
}

/** The top of the graph an object hangs in. */
function topOf(object: Object3D | undefined): Object3D | undefined {
  let top = object;
  while (top?.parent) top = top.parent;
  return top;
}

describe('a subsystem mounting components', () => {
  it('is handed the components of its types when the world is built, then as they come, and no other', async () => {
    const log: string[] = [];
    const cube = named(createMeshEntity('box'), fixedId('entity', 'cube'));
    const world = await playing(
      [recording(A, log, ['light']), recording(B, log, [])],
      [named(createLightEntity('point'), LAMP), cube, createCameraEntity()],
    );

    expect(handouts(log)).toEqual(['a mount lamp:light drawn']);

    log.length = 0;
    world.putComponent(cube.entity.id, createLight('spot'));
    world.frame(STEP);

    expect(handouts(log)).toEqual(['a mount cube:light drawn']);
  });

  it('unmounts the last registered first, still drawn, mounts the first first, drawn, then settles', async () => {
    const log: string[] = [];
    const world = await playing(
      [recording(A, log, ['light']), recording(B, log, ['light'])],
      [named(createLightEntity('point'), LAMP)],
    );
    log.length = 0;

    world.destroy(LAMP);
    world.spawn(named(createLightEntity('spot'), fixedId('entity', 'torch')));
    world.frame(STEP);

    expect(log).toEqual([
      'b unmount lamp:light drawn',
      'a unmount lamp:light drawn',
      'a mount torch:light drawn',
      'b mount torch:light drawn',
      'a settle',
      'b settle',
    ]);
    expect(world.binder.getObject(LAMP)).toBeUndefined();
  });

  it('pairs by component id: a new id mounts, a new object under one patches, a deleted one unmounts', async () => {
    const log: string[] = [];
    const world = await playing([recording(A, log, ['light'])], [named(createLightEntity('point'), LAMP)]);
    const first = labelled(assertDefined(findComponent(world.document, LAMP, 'light'), "the lamp's light"), 'first');
    log.length = 0;

    const second = labelled(createLight('spot'), 'second');
    world.putComponent(LAMP, second);
    world.reconcile();
    world.putComponent(LAMP, labelled({ ...first, intensity: 3 }, 'brighter'));
    world.reconcile();
    world.deleteComponent(LAMP, second.id);
    world.reconcile();

    expect(handouts(log)).toEqual([
      'a mount lamp:second drawn',
      'a patch lamp:first→brighter',
      'a unmount lamp:second drawn',
    ]);
  });

  it('unmounts every component of what is destroyed, the subtree whole', async () => {
    const log: string[] = [];
    const parent = named(createLightEntity('point'), LAMP);
    const child = named(createLightEntity('spot'), fixedId('entity', 'bulb'));
    const world = await playing([recording(A, log, ['light'])], [nest(parent, child), child]);
    log.length = 0;

    world.destroy(LAMP);
    world.reconcile();

    expect(handouts(log)).toEqual(['a unmount lamp:light drawn', 'a unmount bulb:light drawn']);
  });

  it('hands back as it is each component naming an asset given new values, and no other', async () => {
    const log: string[] = [];
    const steel = fixedId('asset', 'steel');
    const linked = labelled(createMeshComponent('box'), 'linked');
    linked.materialId = steel;
    const crate = named(createEntity('Crate', [linked, createLight('point')]), fixedId('entity', 'crate'));
    const plain = named(createMeshEntity('box'), fixedId('entity', 'plain'));
    const world = await playing([recording(A, log, ['mesh', 'light'])], [crate, plain]);
    log.length = 0;
    const values = { roughness: 1 };

    world.setAssetValues(steel, values);
    world.frame(STEP);

    expect(handouts(log)).toEqual(['a patch crate:linked→itself']);
    expect(world.assetValues(steel)).toBe(values);
  });

  it('hands a component back as it is when a model lands on its entity after the pass that mounted it', async () => {
    const log: string[] = [];
    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(new Group());
    });
    vi.spyOn(AssetCache.prototype, 'holdModel').mockReturnValue({ object: inFlight, dispose: () => {} });
    const crate = named(
      createEntity('Crate', [{ ...modelType.create(), assetId: fixedId('asset', 'crate') }]),
      fixedId('entity', 'crate'),
    );
    // Loaded rather than played: Play's world waits for the model to land, and
    // this test lands it once the build's pass has mounted the component. The
    // build's last passes hand it back, before the world is ready.
    const world = await World.load(
      optionsFor([recording(A, log, ['model'])], [crate], { url: () => 'file:///crate.glb' }),
    );
    onTestFinished(() => world.dispose());
    expect(handouts(log)).toEqual(['a mount crate:model drawn']);
    log.length = 0;

    land();
    await world.ready;

    expect(handouts(log)).toEqual(['a patch crate:model→itself']);
  });
});

describe('a running world’s structural calls', () => {
  it('put a spawn in the document and draw it at once, and the frame’s pass leaves its objects as they are', async () => {
    const world = await playing([], []);
    const crate = createMeshEntity('box');

    expect(world.spawn(crate)).toBe(crate.entity.id);
    expect(world.document.entities.has(crate.entity.id)).toBe(true);
    const drawn = assertDefined(world.binder.getObject(crate.entity.id), 'the crate drawn');
    expect(topOf(drawn)).toBe(world.scene);
    // Moved before the pass, as a script moves what it just spawned.
    drawn.position.x = 4;

    world.frame(STEP);

    expect(world.binder.getObject(crate.entity.id)).toBe(drawn);
    expect(drawn.position.x).toBe(4);
  });

  it('place a prefab whole, and destroy a placement with everything it placed', async () => {
    const tower = fixedId('asset', 'tower');
    const base = createMeshEntity('box');
    const middle = createMeshEntity('box');
    const top = createMeshEntity('sphere');
    const prefab = { ...prefabWith('Tower', [nest(base, nest(middle, top)), middle, top], base.entity.id), id: tower };
    const world = await playing([], [], { prefabs: new Map([[tower, prefab]]) });

    const root = assertDefined(
      world.instantiate(tower, { transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }),
      'the placement',
    );
    const placed = [root, ...collectDescendants(world.document, root)];
    expect(placed).toHaveLength(4);
    // Drawn from the call, each under its own parent.
    for (const entityId of placed) expect(topOf(world.binder.getObject(entityId))).toBe(world.scene);
    for (const entityId of placed) {
      const parent = world.document.entities.get(entityId)?.parent ?? null;
      if (parent !== null) expect(world.binder.getObject(entityId)?.parent).toBe(world.binder.getObject(parent));
    }

    world.frame(STEP);
    for (const entityId of placed) expect(topOf(world.binder.getObject(entityId))).toBe(world.scene);
    expect(world.binder.getObject(root)?.position.y).toBe(2);

    world.destroy(root);
    expect(world.document.entities.size).toBe(0);
    world.frame(STEP);
    for (const entityId of placed) expect(world.binder.getObject(entityId)).toBeUndefined();
  });

  it('are reconciled once a frame, after the late hooks, before the render ones, not when nothing was asked', async () => {
    const log: string[] = [];
    const world = await playing([recording(A, log, ['light'], ['update', 'lateUpdate', 'renderPrep'])], []);
    log.length = 0;

    world.spawn(named(createLightEntity('point'), LAMP));
    world.frame(STEP);
    world.frame(STEP);

    expect(log).toEqual([
      'a update',
      'a lateUpdate',
      'a mount lamp:light drawn',
      'a settle',
      'a renderPrep',
      'a update',
      'a lateUpdate',
      'a renderPrep',
    ]);
  });

  it('are reconciled outside a frame when asked, as a paused host asks', async () => {
    const log: string[] = [];
    const world = await playing([recording(A, log, ['light'])], []);
    log.length = 0;

    world.spawn(named(createLightEntity('point'), LAMP));
    world.reconcile();

    expect(log).toEqual(['a mount lamp:light drawn', 'a settle']);
  });

  it('refuse an edit world, whose document is the editor’s', () => {
    const lamp = createLightEntity('point');
    const world = World.edit(optionsFor([], [lamp]));
    onTestFinished(() => world.dispose());
    const light = assertDefined(findComponent(world.document, lamp.entity.id, 'light'), "the lamp's light");

    expect(() => world.spawn(createEntity('Crate'))).toThrow(/an edit world's document/);
    expect(() => world.instantiate(fixedId('asset', 'tower'))).toThrow(/an edit world's document/);
    expect(() => world.destroy(lamp.entity.id)).toThrow(/an edit world's document/);
    expect(() => world.putComponent(lamp.entity.id, createLight('spot'))).toThrow(/an edit world's document/);
    expect(() => world.deleteComponent(lamp.entity.id, light.id)).toThrow(/an edit world's document/);
    expect(() => world.setAssetValues(fixedId('asset', 'steel'), {})).toThrow(/an edit world's document/);
  });
});

describe('an entity’s own fields on the drawing side', () => {
  it('keep what a script did to its object through a component put on its entity', async () => {
    const cube = createMeshEntity('box');
    const world = await playing([], [cube]);
    const object = assertDefined(world.binder.getObject(cube.entity.id), "the cube's object");

    object.visible = false;
    object.name = 'Hidden by a script';
    world.putComponent(cube.entity.id, createLight('point'));
    world.frame(STEP);

    expect(object.visible).toBe(false);
    expect(object.name).toBe('Hidden by a script');
  });

  it('follow a change the document makes to them', () => {
    const cube = createMeshEntity('box');
    const world = World.edit(optionsFor([], [cube]));
    onTestFinished(() => world.dispose());
    const object = assertDefined(world.binder.getObject(cube.entity.id), "the cube's object");
    const changed = new Set([cube.entity.id]);

    world.binder.sync(sceneWith([{ ...cube, entity: { ...cube.entity, visible: false, name: 'Hidden' } }]), changed);
    expect([object.visible, object.name]).toEqual([false, 'Hidden']);

    world.binder.sync(sceneWith([cube]), changed);
    expect([object.visible, object.name]).toEqual([true, cube.entity.name]);
  });
});
