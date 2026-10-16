import {
  LAUNCH_SNAPSHOT_VERSION,
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createMaterial,
  createMeshEntity,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  serializeScene,
  type PrefabDoc,
  type ProjectFile,
} from '@three-studio/core';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { addEntity } from '../src/commands/sceneCommands';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { useProjectStore } from '../src/state/projectStore';
import { useScriptStore } from '../src/state/scriptStore';
import {
  PlaySession,
  launchSnapshot,
  playSceneSource,
  readPlayInputs,
  type PlayHost,
} from '../src/viewport/PlaySession';
import type { Presentation } from '../src/viewport/Presentation';

/*
 * What Play runs and what a device launch sends are one reading of the editor's
 * stores. Two readings drift: a device that runs something other than what Play
 * would is a device that cannot be trusted to show what is on screen.
 */

const doc = () => useDocumentStore.getState();

const SCENE_ID = 'window-scene';
const PREFAB_ID = 'prefab-under-test';
const MATERIAL_ID = 'material-under-test';

const rendering = { ...createRenderingSettings(), exposure: 1.5 };
const physics = { ...createPhysicsSettings(), gravity: [0, -3, 0] as [number, number, number] };

const project: ProjectFile = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Inputs',
  engineVersion: '0.1.0',
  startScene: SCENE_ID,
  settings: {
    loadingScene: 'loading-scene',
    rendering,
    physics,
    build: createBuildProfiles('Inputs'),
  },
};

const saved: [string, PrefabDoc][] = [];
const realSavePrefab = useAssetStore.getState().savePrefab;
const realBuild = useScriptStore.getState().build;

beforeEach(async () => {
  await usePrefabModeStore.getState().exit();
  usePrefabModeStore.setState({ stack: [] });
  useEditorStore.getState().stop();
  // The document carries an id of its own that is not the window's, which is
  // exactly the case the entry's id must not be read from.
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useProjectStore.setState({
    project,
    sceneId: SCENE_ID,
    scenes: [{ id: SCENE_ID, name: 'Level One', path: 'scenes/level-one.scene.json', shadowedBy: null }],
  });
  const root = createMeshEntity('box');
  root.entity.name = 'Crate';
  useAssetStore.setState({
    materials: { [MATERIAL_ID]: createMaterial() },
    prefabs: { [PREFAB_ID]: prefabWith('Crate', [root], root.entity.id) },
    savePrefab: async (assetId, prefab) => {
      saved.push([assetId, prefab]);
    },
  });
  saved.length = 0;
});

afterEach(() => {
  useAssetStore.setState({ savePrefab: realSavePrefab });
  useScriptStore.setState({ build: realBuild });
});

describe('what Play runs, read in one place', () => {
  it('reads the scene on screen under the window’s id and name, with the project’s settings', () => {
    const inputs = readPlayInputs();

    expect(inputs.version).toBe(LAUNCH_SNAPSHOT_VERSION);
    expect(inputs.entry.id).toBe(SCENE_ID);
    expect(inputs.entry.id).not.toBe(doc().scene.id);
    expect(inputs.entry.name).toBe('Level One');
    expect(inputs.entry.scene).toBe(doc().scene);
    expect(inputs.rendering).toEqual(rendering);
    expect(inputs.physics).toEqual(physics);
    expect(inputs.loadingScene).toBe('loading-scene');
    expect(inputs.materials).toBe(useAssetStore.getState().materials);
    expect(inputs.prefabs).toBe(useAssetStore.getState().prefabs);
  });

  it('reads the scene set aside in Prefab Mode, with the prefab as edited, and saves nothing', async () => {
    const scene = doc().scene;
    await usePrefabModeStore.getState().open(PREFAB_ID);
    const inside = createMeshEntity('box');
    addEntity(inside);

    const inputs = readPlayInputs();

    expect(inputs.entry.id).toBe(SCENE_ID);
    expect(inputs.entry.name).toBe('Level One');
    expect(inputs.entry.scene).toBe(scene);
    expect(inputs.prefabs[PREFAB_ID]!.entities[inside.entity.id]).toBeDefined();
    expect(saved).toEqual([]);
    expect(usePrefabModeStore.getState().stack).toHaveLength(1);
  });
});

describe('what a launch sends while the editor plays', () => {
  function stubHost(): PlayHost {
    return {
      renderer: {} as WebGPURenderer,
      gameView: { canvas: {}, visible: false, width: 1, height: 1 } as unknown as Presentation,
      rendering,
      onPlayStarted: () => {},
      onPlayStopped: () => {},
    };
  }

  it('is the scene Play started from, until Stop', async () => {
    // The compile held open, so Play stays at the point where it has taken its
    // inputs and nothing has run yet: no renderer is needed to get there.
    let finishBuild: (compiled: boolean) => void = () => {};
    useScriptStore.setState({
      build: () => new Promise<boolean>((resolve) => (finishBuild = resolve)),
    });
    const session = new PlaySession(stubHost());
    session.watch();

    useEditorStore.getState().play();
    await Promise.resolve();
    const atPress = launchSnapshot().entry.scene;

    const later = createMeshEntity('box');
    addEntity(later);
    expect(doc().scene.entities[later.entity.id]).toBeDefined();
    expect(launchSnapshot().entry.scene.entities[later.entity.id]).toBeUndefined();
    expect(launchSnapshot().entry.scene).toBe(atPress);

    useEditorStore.getState().stop();
    expect(launchSnapshot().entry.scene).toBe(doc().scene);

    finishBuild(false);
    await Promise.resolve();
    session.dispose();
  });

  it('is the document again when Stop comes while Prefab Mode is being left', async () => {
    // Play leaves Prefab Mode before it reads anything, and leaving saves. A
    // Stop pressed during that save is handled before Play has taken its
    // inputs, so nothing after it would clear what Play then takes.
    let finishSave: () => void = () => {};
    useAssetStore.setState({
      savePrefab: () => new Promise<void>((resolve) => (finishSave = resolve)),
    });
    useScriptStore.setState({ build: () => new Promise<boolean>(() => {}) });
    await usePrefabModeStore.getState().open(PREFAB_ID);
    const session = new PlaySession(stubHost());
    session.watch();

    useEditorStore.getState().play();
    useEditorStore.getState().stop();
    finishSave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(usePrefabModeStore.getState().stack).toHaveLength(0);
    addEntity(createMeshEntity('box'));
    expect(launchSnapshot().entry.scene).toBe(doc().scene);
    session.dispose();
  });
});

describe('the scenes a running game reaches', () => {
  /*
   * A script that restarts the level asks for the scene it is in, by id or by
   * name. The saved file used to answer, so a restart dropped every unsaved
   * edit: the game on screen was the edited scene right up to the moment a
   * script reloaded it.
   */
  const OTHER = { id: 'other-scene', name: 'Boss', path: 'scenes/boss.scene.json', shadowedBy: null };

  function givenTwoScenes(): { reads: string[]; readFile: (path: string) => Promise<string> } {
    useProjectStore.setState({
      scenes: [
        { id: SCENE_ID, name: 'Level One', path: 'scenes/level-one.scene.json', shadowedBy: null },
        OTHER,
      ],
    });
    const reads: string[] = [];
    const boss = createStarterScene();
    boss.name = 'Boss';
    return {
      reads,
      readFile: async (path) => {
        reads.push(path);
        return serializeScene(boss);
      },
    };
  }

  it('answers the entry, by id or by name, with what Play started from, a new copy each time', async () => {
    const { reads, readFile } = givenTwoScenes();
    const unsaved = createMeshEntity('box');
    addEntity(unsaved);
    const entry = readPlayInputs().entry;
    const source = playSceneSource(entry, readFile);

    const byId = await source.read(SCENE_ID);
    const byName = await source.read('Level One');

    for (const scene of [byId, byName]) {
      expect(scene.entities[unsaved.entity.id]).toBeDefined();
      expect(scene).toEqual(entry.scene);
      expect(scene).not.toBe(entry.scene);
    }
    expect(byId).not.toBe(byName);
    expect(reads).toEqual([]);
  });

  it('reads any other scene from its file, by id or by name', async () => {
    const { reads, readFile } = givenTwoScenes();
    const source = playSceneSource(readPlayInputs().entry, readFile);

    expect((await source.read('Boss')).name).toBe('Boss');
    expect((await source.read(OTHER.id)).name).toBe('Boss');
    expect(reads).toEqual([OTHER.path, OTHER.path]);
  });

  it('refuses a scene the project does not have, and names it', async () => {
    const { readFile } = givenTwoScenes();
    const source = playSceneSource(readPlayInputs().entry, readFile);

    await expect(source.read('Nowhere')).rejects.toThrow('No scene "Nowhere"');
  });
});
