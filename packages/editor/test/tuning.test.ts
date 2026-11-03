import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createColliderShape,
  createComponent,
  createEmptyScene,
  createEntity,
  createMeshEntity,
  createPhysicsMaterial,
  createPhysicsSettings,
  createPrefabInstance,
  createRenderingSettings,
  findComponent,
  findComponentById,
  instancedId,
  serializeScene,
  type ColliderComponent,
  type ComponentDoc,
  type EntityTemplate,
  type ProjectFile,
  type RigidBodyComponent,
  type ScriptComponent,
} from '@three-studio/core';
import { Behaviour, Engine, clearScripts, registerScript } from '@three-studio/runtime';
import type { WebGPURenderer } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { commandById } from '../src/commands/registry';
import { COMPONENT_PANES, paneEntriesFor } from '../src/components/panes';
import { effectiveComponent, inspectorSignature, linkedMaterial } from '../src/inspector/buildInspector';
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
  tunePhysicsMaterialField,
  useTuningStore,
} from '../src/state/tuning';
import { PlaySession, type PlayHost } from '../src/viewport/PlaySession';
import type { Presentation } from '../src/viewport/Presentation';

/*
 * The Inspector tunes the running game during Play: a physics row's value goes
 * to the running world and to `state/tuning`, never to the document, which the
 * scene lock holds still until Stop.
 */

const SCENE_ID = 'window-scene';
const BOSS = { id: 'boss-scene', name: 'Boss', path: 'scenes/boss.scene.json', shadowedBy: null };

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
  // `null` is what `EngineOptions.renderer` allows for.
  renderer: null as unknown as WebGPURenderer,
  gameView: { canvas: new EventTarget(), visible: true, width: 16, height: 9 } as unknown as Presentation,
  rendering: createRenderingSettings(),
  onPlayPressed: () => {},
  onPlayStopped: () => {},
};

let session: PlaySession | null = null;

/** A session watching the transport, as the viewport builds one, and the engine Play starts. */
async function playing(): Promise<Engine> {
  if (!session) {
    session = new PlaySession(host);
    session.watch();
  }
  play();
  await until(() => session?.playEngine != null, 'the engine');
  return session.playEngine!;
}

/** A Cube with a Rigid Body of mass 1 and a Collider, as Add Component makes them. */
function cube(name = 'Cube'): EntityTemplate {
  const template = createMeshEntity('box');
  template.entity.name = name;
  template.components.push(createComponent('rigidbody'), createComponent('collider'));
  return template;
}

function componentOf<T extends ComponentDoc['type']>(template: EntityTemplate, type: T) {
  const found = template.components.find((component): component is Extract<ComponentDoc, { type: T }> => component.type === type);
  if (!found) throw new Error(`"${template.entity.name}" has no ${type}.`);
  return found;
}

/** The running mass of the template's body. */
const massOf = (engine: Engine | null, template: EntityTemplate) => engine?.physics?.body(template.entity.id)?.mass;

/** What a start that runs to a real engine needs of the browser. */
beforeAll(() => {
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), {
      performance,
      studio: { project: { readScene: async () => serializeScene(bossScene()) } },
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
  useAssetStore.setState({ physicsMaterials: {}, prefabs: {} });
  // Compiled, with nothing to import: the classes are registered here.
  useScriptStore.setState({ build: async () => true });
  useToastStore.getState().clear();
});

afterEach(() => {
  stop();
  session?.dispose();
  session = null;
  clearScripts();
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
    const engine = await playing();
    const revision = useDocumentStore.getState().revision;

    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);

    expect(massOf(engine, box)).toBeCloseTo(5, 5);
    expect(useDocumentStore.getState().revision).toBe(revision);
    stop();
    expect(errors.mock.calls.flat().some((line) => String(line).includes('round the lock'))).toBe(false);
  });

  it('what was tuned is what the Inspector reads during Play, and the document’s value after Stop', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const body = componentOf(box, 'rigidbody');
    await playing();

    tuneComponentField(box.entity.id, body.id, ['mass'], 5);

    expect((effectiveComponent(box.entity.id, body) as RigidBodyComponent).mass).toBe(5);
    stop();
    expect((effectiveComponent(box.entity.id, body) as RigidBodyComponent).mass).toBe(1);
  });

  it('a kind tuned during Play brings its rows', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const collider = componentOf(box, 'collider');
    await playing();
    const before = inspectorSignature(box.entity.id);

    tuneComponentField(box.entity.id, collider.id, ['shape'], createColliderShape('sphere'));

    expect(inspectorSignature(box.entity.id)).not.toBe(before);
    const labels = paneEntriesFor(effectiveComponent(box.entity.id, collider)).entries.flatMap((entry) =>
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

    tuneComponentField(box.entity.id, collider.id, ['shape', 'radius'], 0.7);
    tuneComponentField(box.entity.id, collider.id, ['shape'], createColliderShape('box'));
    tuneComponentField(box.entity.id, collider.id, ['shape'], createColliderShape('sphere'));
    tuneComponentField(box.entity.id, collider.id, ['shape', 'radius'], 0.9);

    expect((effectiveComponent(box.entity.id, collider) as ColliderComponent).shape).toEqual({
      ...createColliderShape('sphere'),
      radius: 0.9,
    });
    expect(useTuningStore.getState().values.map(({ path }) => path.join('.'))).toEqual(['shape', 'shape.radius']);
  });

  it('a linked physics material’s rows tune the asset in the running game, and its file is not written', async () => {
    const ice = { ...createPhysicsMaterial(), friction: 0.05 };
    const save = vi.fn(async () => {});
    useAssetStore.setState({ physicsMaterials: { ice }, savePhysicsMaterial: save });
    const box = cube();
    const collider = componentOf(box, 'collider');
    collider.materialId = 'ice';
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    const engine = await playing();
    const tune = vi.spyOn(engine, 'tunePhysicsMaterial');

    expect(linkedMaterial(effectiveComponent(box.entity.id, collider), ['material', 'friction'])?.assetId).toBe('ice');
    tunePhysicsMaterialField('ice', 'friction', 0);

    expect(tune).toHaveBeenCalledWith('ice', { ...ice, friction: 0 });
    expect(save).not.toHaveBeenCalled();
    expect((effectiveComponent(box.entity.id, collider) as ColliderComponent).material.friction).toBe(0);
  });

  it('several selected bodies are tuned together', async () => {
    const [left, right] = [cube('Left'), cube('Right')];
    right.entity.transform.position = [3, 0, 0];
    useDocumentStore.getState().replaceScene(sceneWith([left, right]));
    const engine = await playing();

    const body = new MultiTarget([left.entity.id, right.entity.id]).components().find(({ type }) => type === 'rigidbody');
    body?.tune(['mass'], 3);

    expect(massOf(engine, left)).toBeCloseTo(3, 5);
    expect(massOf(engine, right)).toBeCloseTo(3, 5);
    expect(body?.read(['mass'])).toBe(3);
  });

  it('a game that restarts the window’s scene keeps the tuning; another scene’s engine is handed none', async () => {
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
    registerScript('script-director', Director);
    const director: ScriptComponent = { ...createComponent('script'), assetId: 'script-director' };
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box, createEntity('Director', [director])]));
    const first = await playing();
    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);

    Director.to = 'self';
    first.update(1 / 60);
    await until(() => session?.playEngine !== first && session?.playEngine != null, 'the restarted engine');
    const restarted = session!.playEngine!;
    expect(massOf(restarted, box)).toBeCloseTo(5, 5);

    const tune = vi.spyOn(Engine.prototype, 'tune');
    Director.to = 'Boss';
    restarted.update(1 / 60);
    await until(() => session?.playEngine !== restarted && session?.playEngine != null, 'Boss’s engine');
    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 7);
    expect(tune).not.toHaveBeenCalled();
  });

  it('the next Play starts from the document', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
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
    inside.components.push({ ...createComponent('collider'), shape: createColliderShape('sphere') });
    useAssetStore.setState({
      physicsMaterials: { ice },
      prefabs: { ball: prefabWith('Ball', [inside], inside.entity.id) },
      savePhysicsMaterial: save,
    });
    const box = cube();
    componentOf(box, 'collider').materialId = 'ice';
    const instance = createEntity('Ball', [createPrefabInstance('ball')]);
    instance.entity.transform.position = [3, 0, 0];
    useDocumentStore.getState().replaceScene(sceneWith([box, instance]));
    const produced = instancedId(instance.entity.id, inside.entity.id);
    const ball = componentOf(inside, 'collider');
    await playing();

    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    // A kind, then a measure of it: one field, written whole.
    tuneComponentField(produced, ball.id, ['shape'], createColliderShape('capsule'));
    tuneComponentField(produced, ball.id, ['shape', 'radius'], 0.8);
    tunePhysicsMaterialField('ice', 'friction', 0);
    stop();
    keepTuning();

    const mass = () => findComponent(doc().scene, box.entity.id, 'rigidbody')?.mass;
    const override = () =>
      findComponent(doc().scene, instance.entity.id, 'prefabInstance')?.overrides[inside.entity.id]?.components?.[ball.id];
    const shape = () => {
      const collider = findComponentById(expandedScene().scene, produced, ball.id);
      return collider?.type === 'collider' ? collider.shape : null;
    };
    expect(mass()).toBe(5);
    expect(override()).toBeDefined();
    expect(shape()).toEqual({ ...createColliderShape('capsule'), radius: 0.8 });
    expect(save).toHaveBeenLastCalledWith('ice', { ...ice, friction: 0 });
    expect(doc().undoLabel()).toBe('Keep tuned physics');

    doc().undo();
    expect(mass()).toBe(1);
    expect(override()).toBeUndefined();
    expect(shape()).toEqual(createColliderShape('sphere'));
    expect(save).toHaveBeenLastCalledWith('ice', ice);

    doc().redo();
    expect(mass()).toBe(5);
    expect(shape()).toEqual({ ...createColliderShape('capsule'), radius: 0.8 });
    expect(save).toHaveBeenLastCalledWith('ice', { ...ice, friction: 0 });
  });

  it('Keep is offered at Stop, and in the Edit menu until the next Play', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);

    stop();

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({ kind: 'info', title: 'Keep the physics tuned during Play?' });
    expect(toasts()[0]!.actions?.map(({ label }) => label)).toEqual(['Keep']);
    expect(commandById('keepTuning').can()).toBe(true);

    play();
    expect(toasts()).toEqual([]);
    await until(() => session?.playEngine != null, 'the next engine');
    stop();
    expect(commandById('keepTuning').can()).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('another scene in the window drops what was tuned', async () => {
    const box = cube();
    useDocumentStore.getState().replaceScene(sceneWith([box]));
    await playing();
    tuneComponentField(box.entity.id, componentOf(box, 'rigidbody').id, ['mass'], 5);
    stop();

    useProjectStore.setState({ sceneId: BOSS.id });

    expect(commandById('keepTuning').can()).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('nothing tuned, nothing offered', async () => {
    useDocumentStore.getState().replaceScene(sceneWith([cube()]));
    await playing();

    stop();

    expect(toasts()).toEqual([]);
    expect(commandById('keepTuning').can()).toBe(false);
  });
});

describe('the panes that tune', () => {
  it('the Rigid Body, the Collider and the Joint declare `live`, and no other pane does', () => {
    const live = Object.entries(COMPONENT_PANES)
      .filter(([, pane]) => pane.live === true)
      .map(([type]) => type)
      .sort();
    expect(live).toEqual(['collider', 'joint', 'rigidbody']);
  });
});
