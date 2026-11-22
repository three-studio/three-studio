import {
  PROJECT_FORMAT_VERSION,
  Registry,
  assertDefined,
  createBuildProfiles,
  colliderType,
  createColliderShape,
  createEmptyScene,
  createEntity,
  createLight,
  createMeshEntity,
  createPhysicsMaterial,
  createPhysicsSettings,
  createPrefabInstance,
  createRenderingSettings,
  rigidbodyType,
  scriptType,
  findComponent,
  findComponentById,
  fixedId,
  instancedId,
  lightType,
  serializeScene,
  type ColliderComponent,
  type ComponentDefinition,
  type ComponentDoc,
  type ComponentTypeId,
  type EntityTemplate,
  type ProjectFile,
  type RigidBodyComponent,
  type SchemaField,
  type ScriptComponent,
} from '@three-studio/core';
import { AssetCache, Behaviour, World, NO_SCRIPTS, NULL_ASSET_RESOLVER, physicsOf } from '@three-studio/runtime';
import type { WebGPURenderer } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { commandById, currentContext } from '../src/commands/registry';
import { paneEntriesFor } from '../src/inspector/panes';
import { effectiveComponent, inspectorSignature, linkedAsset } from '../src/inspector/buildInspector';
import { MultiTarget } from '../src/inspector/target';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { expandedScene } from '../src/state/expansion';
import { useProjectStore } from '../src/state/projectStore';
import { useScriptStore } from '../src/state/scriptStore';
import { useToastStore } from '../src/state/toastStore';
import {
  keepTuning,
  tuneComponentField,
  tuneLinkedAsset,
  useTuningStore,
} from '../src/state/tuning';
import type { PaneExtension } from '../src/inspector/fields';
import { PlaySession, type PlayHost } from '../src/viewport/PlaySession';
import type { Presentation } from '../src/viewport/Presentation';
import { builtInRegistries } from './registries';
import { StudioTime } from '@three-studio/runtime/time/StudioTime';

const registries = builtInRegistries();

/*
 * The Inspector tunes the running game during Play: a physics row's value goes
 * into the running world's document, its own copy, and to `state/tuning`, never
 * to the window's document, which the scene lock holds still until Stop. The
 * running world takes it at its next pass, at the end of a frame; no viewport
 * runs frames here, so a test reconciles where a frame would.
 */

const SCENE_ID = fixedId('scene', 'window-scene');
const ICE = fixedId('asset', 'ice');
const BOSS = { id: fixedId('scene', 'boss-scene'), name: 'Boss', path: 'scenes/boss.scene.json', shadowedBy: null };

const project: ProjectFile = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Tuning',
  engineVersion: '0.1.0',
  startScene: SCENE_ID,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Tuning'),
  },
};

const play = () => useEditorStore.getState().play();
const stop = () => useEditorStore.getState().stop();
const doc = () => useDocumentStore.getState();
const toasts = () => useToastStore.getState().toasts;
const realSavePhysicsMaterial = useAssetStore.getState().savePhysicsMaterial;

/** A start goes through a few awaits; the longest is the physics module. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 400; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

const host: PlayHost = {
  time: new StudioTime(),
  // `null` is what `WorldOptions.renderer` allows for.
  renderer: null as unknown as WebGPURenderer,
  gameView: { canvas: new EventTarget(), visible: true, width: 16, height: 9 } as unknown as Presentation,
  rendering: createRenderingSettings(),
  registries: builtInRegistries(),
  assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
  onPlayPressed: () => {},
  onPlayStopped: () => {},
};

let session: PlaySession | null = null;

/** A session watching the transport, as the viewport builds one, and the world Play starts. */
async function playing(): Promise<World> {
  if (!session) {
    session = new PlaySession(host);
    session.watch();
  }
  play();
  await until(() => session?.playWorld != null, 'the world');
  return session.playWorld!;
}

/** A Cube with a Rigid Body of mass 1 and a Collider, as Add Component makes them. */
function cube(name = 'Cube'): EntityTemplate {
  const template = createMeshEntity('box');
  template.entity.name = name;
  template.components.push(rigidbodyType.create(), colliderType.create());
  return template;
}

function componentOf<T extends ComponentDoc['type']>(template: EntityTemplate, type: T) {
  const found = template.components.find((component): component is Extract<ComponentDoc, { type: T }> => component.type === type);
  if (!found) throw new Error(`"${template.entity.name}" has no ${type}.`);
  return found;
}

/** The running mass of the template's body. */
const massOf = (world: World | null, template: EntityTemplate) =>
  (world === null ? null : physicsOf(world))?.body(template.entity.id)?.mass;

/** What a start that runs to a real world needs of the browser. */
beforeAll(() => {
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), {
      performance,
      studio: { project: { readScene: async () => serializeScene(registries, bossScene()) } },
    }),
    document: new EventTarget(),
  });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

beforeEach(() => {
  stop();
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useProjectStore.setState({
    project,
    sceneId: SCENE_ID,
    scenes: [{ id: SCENE_ID, name: 'Level One', path: 'scenes/level-one.scene.json', shadowedBy: null }, BOSS],
  });
  useAssetStore.setState({ physicsMaterials: new Map(), prefabs: new Map() });
  // Compiled, with nothing to import: a test puts its classes in the store.
  useScriptStore.setState({ build: async () => true });
  useToastStore.getState().clear();
});

afterEach(() => {
  stop();
  session?.dispose();
  session = null;
  useScriptStore.setState({ scripts: NO_SCRIPTS });
  useAssetStore.setState({ savePhysicsMaterial: realSavePhysicsMaterial });
  vi.restoreAllMocks();
});

function bossScene() {
  const scene = sceneWith([cube('Crate')]);
  scene.name = 'Boss';
  return scene;
}

describe('tuning during Play', () => {
  it('a Rigid Body tuned during Play changes the running body, and nothing in the document', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const errors = vi.spyOn(console, 'error');
    const world = await playing();
    const revision = useDocumentStore.getState().revision;

    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    world.reconcile();

    expect(massOf(world, box)).toBeCloseTo(5, 5);
    expect(useDocumentStore.getState().revision).toBe(revision);
    stop();
    expect(errors.mock.calls.flat().some((line) => String(line).includes('round the lock'))).toBe(false);
  });

  it('a tune while paused waits for no frame: the running world takes it at the pass the paused viewport runs', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const world = await playing();
    useEditorStore.getState().togglePause();

    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    expect(massOf(world, box)).toBeCloseTo(1, 5);
    world.reconcile();

    expect(massOf(world, box)).toBeCloseTo(5, 5);
  });

  it('what was tuned is what the Inspector reads during Play, and the document’s value after Stop', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const body = componentOf(box, 'rigidbody');
    await playing();

    tuneComponentField(registries, box.entity.id, body.id, ['mass'], 5);

    expect((effectiveComponent(registries, box.entity.id, body) as RigidBodyComponent).mass).toBe(5);
    stop();
    expect((effectiveComponent(registries, box.entity.id, body) as RigidBodyComponent).mass).toBe(1);
  });

  it('a kind tuned during Play brings its rows', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const collider = componentOf(box, 'collider');
    await playing();
    const before = inspectorSignature(registries, box.entity.id);

    tuneComponentField(registries, box.entity.id, collider.id, ['shape'], createColliderShape('sphere'));

    expect(inspectorSignature(registries, box.entity.id)).not.toBe(before);
    const labels = paneEntriesFor(registries, effectiveComponent(registries, box.entity.id, collider)).entries.flatMap((entry) =>
      'path' in entry ? [entry.label] : [],
    );
    expect(labels).toContain('Radius');
  });

  it('a write at a path replaces the values tuned under it', async () => {
    const box = cube();
    const collider = componentOf(box, 'collider');
    collider.shape = createColliderShape('sphere');
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();

    tuneComponentField(registries, box.entity.id, collider.id, ['shape', 'radius'], 0.7);
    tuneComponentField(registries, box.entity.id, collider.id, ['shape'], createColliderShape('box'));
    tuneComponentField(registries, box.entity.id, collider.id, ['shape'], createColliderShape('sphere'));
    tuneComponentField(registries, box.entity.id, collider.id, ['shape', 'radius'], 0.9);

    expect((effectiveComponent(registries, box.entity.id, collider) as ColliderComponent).shape).toEqual({
      ...createColliderShape('sphere'),
      radius: 0.9,
    });
    expect(useTuningStore.getState().values.map(({ path }) => path.join('.'))).toEqual(['shape', 'shape.radius']);
  });

  it('a linked physics material’s rows tune the asset in the running game, and its file is not written', async () => {
    const ice = { ...createPhysicsMaterial(), friction: 0.05 };
    const save = vi.fn(async () => {});
    useAssetStore.setState({ physicsMaterials: new Map([[ICE, ice]]), savePhysicsMaterial: save });
    const box = cube();
    const collider = componentOf(box, 'collider');
    collider.materialId = ICE;
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const world = await playing();
    const tune = vi.spyOn(world, 'setAssetValues');

    const linked = assertDefined(linkedAsset(registries, collider, ['material', 'friction']), 'the link');
    tuneLinkedAsset(linked.kind, linked.assetId, linked.path, 0);

    expect(tune).toHaveBeenCalledWith(ICE, { ...ice, friction: 0 });
    expect(save).not.toHaveBeenCalled();
    const effective = effectiveComponent(registries, box.entity.id, collider);
    expect(effective.type === 'collider' && effective.material.friction).toBe(0);
  });

  it('a field any type marks tunable is tuned in Play, and its component put into the running game', async () => {
    // A Light whose intensity tunes: no physics, and nothing in the editor names it.
    const intensity: SchemaField = { ...assertDefined(lightType.schema['intensity'], 'the light’s intensity'), tunable: true };
    const tunedLight = { ...lightType, schema: { ...lightType.schema, intensity } };
    const components = new Registry<ComponentTypeId, ComponentDefinition>('component type');
    components.register(tunedLight satisfies ComponentDefinition);
    const lamp = createEntity('Lamp', [createLight('point')]);
    const light = componentOf(lamp, 'light');
    useDocumentStore.getState().replaceScene(sceneWith([lamp]));
    const world = await playing();
    const tune = vi.spyOn(world, 'putComponent');

    const rows = paneEntriesFor({ components, panes: new Registry<ComponentTypeId, PaneExtension>('pane') }, light).entries;
    expect(rows.find((entry) => 'path' in entry && entry.path.join('.') === 'intensity')).toMatchObject({ tunable: true });
    expect(rows.filter((entry) => 'path' in entry && entry.tunable === true)).toHaveLength(1);
    tuneComponentField(registries, lamp.entity.id, light.id, ['intensity'], 3);

    expect(tune).toHaveBeenCalledWith(lamp.entity.id, { ...light, intensity: 3 });
  });

  it('several selected bodies are tuned together', async () => {
    const [left, right] = [cube('Left'), cube('Right')];
    right.entity.transform.position = [3, 0, 0];
    useDocumentStore.getState().replaceScene(sceneWith([left, right]));
    const world = await playing();

    const body = new MultiTarget(registries, [left.entity.id, right.entity.id])
      .components()
      .find(({ type }) => type === 'rigidbody');
    body?.tune(['mass'], 3);
    world.reconcile();

    expect(massOf(world, left)).toBeCloseTo(3, 5);
    expect(massOf(world, right)).toBeCloseTo(3, 5);
    expect(body?.read(['mass'])).toBe(3);
  });

  it('a game that restarts the window’s scene keeps the tuning; another scene’s world is handed none', async () => {
    /** Goes to a scene once asked: its own, or Boss. */
    class Director extends Behaviour {
      static to: string | null = null;
      override onUpdate() {
        const to = Director.to;
        if (to === null) return;
        Director.to = null;
        void this.scenes?.go(to === 'self' ? (this.scenes.current ?? '') : to);
      }
    }
    const DIRECTOR = fixedId('asset', 'script-director');
    useScriptStore.setState({ scripts: new Map([[DIRECTOR, Director]]) });
    const director: ScriptComponent = { ...scriptType.create(), assetId: DIRECTOR };
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box, createEntity('Director', [director])]));
    const first = await playing();
    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);

    Director.to = 'self';
    first.frame(1 / 60);
    const entry = first.activeScene;
    await until(() => first.activeScene !== null && first.activeScene !== entry, 'the restarted scene');
    // One world for the whole game: the scene restarts in it.
    const restarted = first;
    expect(session?.playWorld).toBe(first);
    expect(massOf(restarted, box)).toBeCloseTo(5, 5);

    const tune = vi.spyOn(World.prototype, 'putComponent');
    Director.to = 'Boss';
    restarted.frame(1 / 60);
    const again = restarted.activeScene;
    await until(() => restarted.activeScene !== null && restarted.activeScene !== again, 'Boss');
    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 7);
    expect(tune).not.toHaveBeenCalled();
  });

  it('the next Play starts from the document', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    stop();

    const next = await playing();

    expect(massOf(next, box)).toBeCloseTo(1, 5);
    expect(useTuningStore.getState().values).toEqual([]);
  });
});

describe('keeping what was tuned', () => {
  it('Keep writes what was tuned as one undo step, an instance’s field as its override and a physics material’s file included', async () => {
    const ice = { ...createPhysicsMaterial(), friction: 0.05 };
    const save = vi.fn(async () => {});
    const inside = createMeshEntity('sphere');
    inside.components.push({ ...colliderType.create(), shape: createColliderShape('sphere') });
    const BALL = fixedId('asset', 'ball');
    useAssetStore.setState({
      physicsMaterials: new Map([[ICE, ice]]),
      // Filed under its own id, as the main process reads a prefab.
      prefabs: new Map([[BALL, { ...prefabWith('Ball', [inside], inside.entity.id), id: BALL }]]),
      savePhysicsMaterial: save,
    });
    const box = cube();
    componentOf(box, 'collider').materialId = ICE;
    const instance = createEntity('Ball', [createPrefabInstance(BALL)]);
    instance.entity.transform.position = [3, 0, 0];
    useDocumentStore.getState().replaceScene(sceneWith([box, instance]));
    const produced = instancedId(instance.entity.id, inside.entity.id);
    const ball = componentOf(inside, 'collider');
    await playing();

    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    // A kind, then a measure of it: one field, written whole.
    tuneComponentField(registries, produced, ball.id, ['shape'], createColliderShape('capsule'));
    tuneComponentField(registries, produced, ball.id, ['shape', 'radius'], 0.8);
    tuneLinkedAsset('physicsMaterial', ICE, ['friction'], 0);
    stop();
    expect(toasts()[0]?.description).toBe(
      'Tuned on 2 entities and 1 asset. Edit ▸ Keep Tuned Values keeps them until the next Play.',
    );
    keepTuning(registries);

    const mass = () => findComponent(doc().scene, box.entity.id, 'rigidbody')?.mass;
    const override = () =>
      findComponent(doc().scene, instance.entity.id, 'prefabInstance')?.overrides[inside.entity.id]?.components?.[ball.id];
    const shape = () => {
      const collider = findComponentById(expandedScene(registries).scene, produced, ball.id);
      return collider?.type === 'collider' ? collider.shape : null;
    };
    expect(mass()).toBe(5);
    expect(override()).toBeDefined();
    expect(shape()).toEqual({ ...createColliderShape('capsule'), radius: 0.8 });
    expect(save).toHaveBeenLastCalledWith(ICE, { ...ice, friction: 0 });
    expect(doc().undoLabel()).toBe('Keep tuned values');

    doc().undo();
    expect(mass()).toBe(1);
    expect(override()).toBeUndefined();
    expect(shape()).toEqual(createColliderShape('sphere'));
    expect(save).toHaveBeenLastCalledWith(ICE, ice);

    doc().redo();
    expect(mass()).toBe(5);
    expect(shape()).toEqual({ ...createColliderShape('capsule'), radius: 0.8 });
    expect(save).toHaveBeenLastCalledWith(ICE, { ...ice, friction: 0 });
  });

  it('Keep is offered at Stop, and in the Edit menu until the next Play', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);

    stop();

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      kind: 'info',
      title: 'Keep the values tuned during Play?',
      description: 'Tuned on 1 entity. Edit ▸ Keep Tuned Values keeps them until the next Play.',
    });
    expect(toasts()[0]!.actions?.map(({ label }) => label)).toEqual(['Keep']);
    expect(commandById('keepTuning').can(currentContext(registries))).toBe(true);
    expect(commandById('keepTuning').label(currentContext(registries))).toBe('Keep Tuned Values');

    play();
    expect(toasts()).toEqual([]);
    await until(() => session?.playWorld != null, 'the next world');
    stop();
    expect(commandById('keepTuning').can(currentContext(registries))).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('another scene in the window drops what was tuned', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(registries, box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    stop();

    useProjectStore.setState({ sceneId: BOSS.id });

    expect(commandById('keepTuning').can(currentContext(registries))).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('nothing tuned, nothing offered', async () => {
    useDocumentStore.getState().replaceScene(sceneWith([cube()]));
    await playing();

    stop();

    expect(toasts()).toEqual([]);
    expect(commandById('keepTuning').can(currentContext(registries))).toBe(false);
  });
});

describe('the rows that tune', () => {
  it('are every row of the Rigid Body’s, the Collider’s and the Joint’s panes, read from their fields, and no other type’s', () => {
    const byType = registries.components.values().map((definition) => {
      const rows = paneEntriesFor(registries, definition.create()).entries.flatMap((entry) => ('path' in entry ? [entry] : []));
      return { type: definition.id, rows: rows.length, tunable: rows.filter((row) => row.tunable === true).length };
    });

    expect(byType.filter(({ tunable }) => tunable > 0).map(({ type }) => type).sort()).toEqual(['collider', 'joint', 'rigidbody']);
    for (const { type, rows, tunable } of byType) {
      if (tunable > 0) expect({ type, tunable }).toEqual({ type, tunable: rows });
    }
  });
});
