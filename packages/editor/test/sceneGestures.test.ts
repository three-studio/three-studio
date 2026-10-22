import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createMeshEntity,
  createModelEntity,
  createPhysicsSettings,
  createRenderingSettings,
  deserializeScene,
  serializeScene,
  type PrefabDoc,
  type ProjectFile,
  type SceneEntry,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { showAssetFile } from '../src/commands/assetCommands';
import { commandById } from '../src/commands/registry';
import { addEntity, deleteSelection, renameEntity } from '../src/commands/sceneCommands';
import {
  backToTheScene,
  currentSceneName,
  deleteCurrentScene,
  duplicateCurrentScene,
  newScene,
  openScene,
  renameCurrentScene,
  renameCurrentSceneWithPrompt,
  revealCurrentScene,
  revertCurrentScene,
  saveSceneAs,
  showSceneSettings,
} from '../src/commands/sceneFiles';
import { useAssetStore } from '../src/state/assetStore';
import { useDialogStore } from '../src/state/dialogStore';
import { selectDirty, useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { useProjectStore } from '../src/state/projectStore';
import { Selection } from '../src/state/selection';
import { useToastStore } from '../src/state/toastStore';
import { sceneUnsaved, watchUnsaved, windowUnsaved } from '../src/state/unsaved';

/*
 * The scene gestures act on the scene, whatever stands in front of it.
 *
 * In Prefab Mode the document is the prefab: Save As wrote the prefab out as a
 * scene, Rename put the scene's name on the prefab, and Delete marked the
 * prefab clean, so the main process went on to prompt about the deleted
 * scene's edits. During Play the scene is locked, and Stop puts back the
 * document Play started from whenever it finds another — its safety net, for a
 * write that went round the lock: Rename's name would be refused and Save As's
 * identity taken back, so both stop the game first.
 *
 * Everything that reaches outside the renderer writes into one ordered log —
 * the bridge, the prefab saves, and Stop — so each test reads what happened in
 * the order it happened.
 */

type Call = [method: string, ...args: unknown[]];
const log: Call[] = [];
const methods = () => log.map(([method]) => method);

/** What each prefab save wrote, beside the log, which only names it. */
const savedPrefabs: PrefabDoc[] = [];
/** What each scene save wrote. */
const written: string[] = [];
/** Each address `retarget` put in place of this window's, so a reload finds its scene. */
const addresses: string[] = [];
/**
 * What the window's scene file holds, as `readScene` answers it: the document as
 * it was saved, unless a test puts something else there — or an error, which
 * the read rejects with.
 */
let file: string | Error = '';
const sceneInAddress = (address: string) => new URL(address).searchParams.get('scene');

const doc = () => useDocumentStore.getState();
const prefabMode = () => usePrefabModeStore.getState();
const editor = () => useEditorStore.getState();

// In path order, as `discoverScenes` hands them over.
const LEVEL_2: SceneEntry = { id: 'b', name: 'Level 2', path: 'scenes/Level 2.scene.json', shadowedBy: null };
const MAIN: SceneEntry = { id: 'a', name: 'Main', path: 'scenes/Main.scene.json', shadowedBy: null };

const startingOn = (startScene: string): ProjectFile => ({
  version: PROJECT_FORMAT_VERSION,
  name: 'Races',
  engineVersion: '0.1.0',
  startScene,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Races'),
  },
});

const entryFor = (id: string, name: string): SceneEntry => ({
  id,
  name,
  path: `scenes/${name}.scene.json`,
  shadowedBy: null,
});

/** `window`, with what these gestures reach, each call written into the log. */
function installBridge(): void {
  const record =
    <A extends unknown[], R>(method: string, answer: (...args: A) => R) =>
    async (...args: A): Promise<R> => {
      log.push([method, ...args]);
      return answer(...args);
    };

  vi.stubGlobal('window', {
    // What `retarget` rewrites, so a reload lands on the file the window is on.
    location: { href: 'file:///index.html?scene=a' },
    history: {
      replaceState: (_state: unknown, _unused: string, url: URL | string) =>
        void addresses.push(String(url)),
    },
    studio: {
      project: {
        createScene: record('createScene', (name: string) => {
          const scene = entryFor('c', name);
          return { project: startingOn('a'), scenes: [LEVEL_2, MAIN, scene], scene };
        }),
        saveScene: async (input: { scenePath: string; contents: string }) => {
          log.push(['saveScene', input.scenePath]);
          written.push(input.contents);
        },
        duplicateScene: record('duplicateScene', (_sceneId: string, name: string) => {
          const scene = entryFor('d', name);
          return { project: startingOn('a'), scenes: [LEVEL_2, MAIN, scene], scene };
        }),
        renameScene: record('renameScene', (sceneId: string, name: string) => {
          const scene = entryFor(sceneId, name);
          return { project: startingOn('a'), scenes: [LEVEL_2, scene], scene };
        }),
        // The main process moves the start scene off the one it deletes.
        deleteScene: record('deleteScene', (_sceneId: string) => ({
          project: startingOn('b'),
          scenes: [LEVEL_2],
        })),
        switchScene: record('switchScene', (_sceneId: string) => true),
        setDirty: (dirty: boolean) => void log.push(['setDirty', dirty]),
        readScene: record('readScene', (_path: string) => {
          if (file instanceof Error) throw file;
          return file;
        }),
      },
      assets: {
        revealInFileManager: record('revealInFileManager', (_path: string) => undefined),
      },
    },
  });
}

async function answerName(name: string): Promise<void> {
  await vi.waitFor(() => expect(useDialogStore.getState().prompt).not.toBeNull());
  useDialogStore.getState().submit(name);
}

async function confirm(): Promise<void> {
  await vi.waitFor(() => expect(useDialogStore.getState().confirm).not.toBeNull());
  useDialogStore.getState().accept();
}

async function cancel(): Promise<void> {
  await vi.waitFor(() => {
    const { prompt, confirm } = useDialogStore.getState();
    expect(prompt ?? confirm).not.toBeNull();
  });
  useDialogStore.getState().cancel();
}

const CRATE = 'prefab-crate';
let crateRoot = '';
/** An entity of the scene's own, which no prefab holds. */
let wall = '';

function named(name: string) {
  const template = createMeshEntity('box');
  template.entity.name = name;
  return template;
}

async function openCrate(): Promise<void> {
  await prefabMode().open(CRATE);
}

const realSavePrefab = useAssetStore.getState().savePrefab;
/** Subscriptions a test made, ended after it whether it passed or not. */
const stops: (() => void)[] = [];

beforeEach(async () => {
  await prefabMode().exit();
  usePrefabModeStore.setState({ stack: [] });
  editor().stop();

  // The document carries the id of the file it was read from, as a loaded one does.
  doc().replaceScene({ ...createEmptyScene('Main'), id: MAIN.id });
  wall = addEntity(named('Wall'));
  doc().markClean();
  file = serializeScene(doc().scene);
  editor().clearSelection();

  useProjectStore.setState({
    summary: { name: 'Races', path: '/projects/Races', lastOpenedAt: 1 },
    project: startingOn('a'),
    scenes: [LEVEL_2, MAIN],
    sceneId: 'a',
    scenePath: MAIN.path,
  });

  const root = named('Crate');
  crateRoot = root.entity.id;
  useAssetStore.setState({
    prefabs: { [CRATE]: prefabWith('Crate', [root], crateRoot) },
    savePrefab: async (assetId, prefab) => {
      log.push(['savePrefab', assetId]);
      savedPrefabs.push(prefab);
    },
  });

  stops.push(
    useEditorStore.subscribe((state, before) => {
      // With the document's id at that moment: Stop puts back the document Play
      // started from when it finds another, identity included.
      if (state.playState === 'stopped' && before.playState !== 'stopped') {
        log.push(['stop', doc().scene.id]);
      }
    }),
  );

  log.length = 0;
  savedPrefabs.length = 0;
  written.length = 0;
  addresses.length = 0;
  installBridge();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  useDialogStore.getState().cancel();
  useToastStore.getState().clear();
  useAssetStore.setState({ savePrefab: realSavePrefab });
  vi.unstubAllGlobals();
});

describe('back to the scene', () => {
  it('leaves Prefab Mode before it stops the game', async () => {
    await openCrate();
    renameEntity(crateRoot, 'Edited');
    editor().play();

    await backToTheScene({ stopPlay: true });

    // The order Play itself follows: out of the prefab, then the game. An older
    // Stop put back the scene Play started from into whatever the document
    // was; stopped first, it put the scene into the prefab, and leaving then
    // saved the scene into the prefab's file.
    expect(log).toEqual([['savePrefab', CRATE], ['stop', 'a']]);
    expect(savedPrefabs[0]?.entities[crateRoot]?.name).toBe('Edited');
    expect(prefabMode().stack).toEqual([]);
    expect(doc().scene.entities[wall]).toBeDefined();
  });

  it('leaves the game running when not asked to stop it', async () => {
    await openCrate();
    editor().play();

    await backToTheScene({ stopPlay: false });

    expect(log).toEqual([['savePrefab', CRATE]]);
    expect(editor().playState).toBe('playing');
  });
});

describe('Save As, Rename and Delete from Prefab Mode', () => {
  it('saves the scene as a new file, not the prefab', async () => {
    await openCrate();

    const done = saveSceneAs();
    await answerName('Copy');
    await done;

    expect(methods()).toEqual(['savePrefab', 'createScene']);
    const copy = deserializeScene(log[1]![2] as string);
    expect(copy.entities[wall]).toBeDefined();
    expect(copy.entities[crateRoot]).toBeUndefined();
    expect(prefabMode().stack).toEqual([]);
    expect(useProjectStore.getState().scenePath).toBe('scenes/Copy.scene.json');
  });

  it.each([
    [
      'the prompt',
      async () => {
        const done = renameCurrentSceneWithPrompt();
        await answerName('Renamed');
        await done;
      },
    ],
    // The Inspector's Name field calls it on blur, with no prompt of its own.
    ['the Inspector', () => renameCurrentScene('Renamed')],
  ])('renames the scene, not the prefab, through %s', async (_, rename) => {
    await openCrate();

    await rename();

    expect(log).toEqual([
      ['savePrefab', CRATE],
      ['renameScene', 'a', 'Renamed'],
    ]);
    expect(prefabMode().stack).toEqual([]);
    expect(doc().scene.entities[wall]).toBeDefined();
    expect(doc().scene.name).toBe('Renamed');
    expect(doc().undoLabel()).toBe('Rename scene');
    expect(savedPrefabs[0]?.name).toBe('Crate');
    expect(useProjectStore.getState().scenePath).toBe('scenes/Renamed.scene.json');
  });

  it('marks the scene clean, and tells the main process, before it switches', async () => {
    renameEntity(wall, 'Edited wall');
    await openCrate();
    stops.push(watchUnsaved());
    log.length = 0;

    const done = deleteCurrentScene();
    await confirm();
    await done;

    // "Clean" reaches the main process before the switch, so it does not offer
    // to discard the edits of a scene that has just been deleted.
    expect(log).toEqual([
      ['savePrefab', CRATE],
      ['deleteScene', 'a'],
      ['setDirty', false],
      ['switchScene', 'b'],
    ]);
  });

  it.each([
    ['Save As', () => saveSceneAs()],
    ['Rename', () => renameCurrentSceneWithPrompt()],
    ['Delete', () => deleteCurrentScene()],
  ])('leaves the prefab open and the game running when %s is cancelled', async (_, gesture) => {
    await openCrate();
    editor().play();

    const done = gesture();
    await cancel();
    await done;

    expect(log).toEqual([]);
    expect(prefabMode().stack).toHaveLength(1);
    expect(editor().playState).toBe('playing');
  });

  it.each([
    ['Save As', () => saveSceneAs(), () => answerName('Copy')],
    ['Rename', () => renameCurrentSceneWithPrompt(), () => answerName('Renamed')],
    ['Delete', () => deleteCurrentScene(), confirm],
  ])('stops at a prefab that fails to save, before %s asks anything else', async (_, gesture, answer) => {
    useAssetStore.setState({
      savePrefab: async (assetId) => {
        log.push(['savePrefab', assetId]);
        throw new Error('disk full');
      },
    });
    await openCrate();

    const done = gesture();
    await answer();
    await done;

    expect(methods()).toEqual(['savePrefab']);
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toContain(
      'Could not do that to the scene',
    );
  });
});

describe('Save As, Rename and Delete during Play', () => {
  it.each([
    ['Save As', () => saveSceneAs(), () => answerName('Copy'), ['createScene']],
    ['Rename', () => renameCurrentSceneWithPrompt(), () => answerName('Renamed'), ['renameScene']],
    ['Delete', () => deleteCurrentScene(), confirm, ['deleteScene', 'switchScene']],
  ])('stops the game once %s has its answer', async (_, gesture, answer, calls) => {
    editor().play();

    const done = gesture();
    // Asking first: a cancel has to find the game still running.
    expect(editor().playState).toBe('playing');
    await answer();
    await done;

    // During Play the scene is locked, and Stop puts back the document Play
    // started from whenever it finds another: written during Play, Rename's
    // name would be refused and Save As's identity taken back.
    expect(methods()).toEqual(['stop', ...calls]);
  });

  it('keeps the new name in the document once the game has stopped', async () => {
    // Stands in for `PlaySession.endPlay`'s safety net, which is not running
    // here, and made unconditional: the document Play started from goes back,
    // as a restore, whatever Stop finds. What the gesture writes after Stop
    // has to be out of its reach.
    const atPlay = doc().scene;
    stops.push(
      useEditorStore.subscribe((state, before) => {
        if (state.playState === 'stopped' && before.playState !== 'stopped') {
          doc().replaceScene(atPlay, { keepHistory: true });
        }
      }),
    );
    editor().play();

    await renameCurrentScene('Played');

    expect(editor().playState).toBe('stopped');
    expect(doc().scene.name).toBe('Played');
  });

  it("takes the copy's identity once the game has stopped, which Stop cannot then take back", async () => {
    const atPlay = doc().scene;
    stops.push(
      useEditorStore.subscribe((state, before) => {
        if (state.playState === 'stopped' && before.playState !== 'stopped') {
          doc().replaceScene(atPlay, { keepHistory: true });
        }
      }),
    );
    editor().play();

    const done = saveSceneAs();
    await answerName('Copy');
    await done;

    expect(log[0]).toEqual(['stop', 'a']);
    expect(doc().scene.id).toBe('c');
    expect(doc().scene.name).toBe('Copy');
  });
});

describe('Save As makes a scene of its own', () => {
  /*
   * The copy used to be written with the original's id and name still in the
   * document: two files claiming one scene, the original the one the next walk
   * of `scenes/` hid, and this window on an id no file carried. Every later
   * Cmd+S wrote the original's id into the copy again.
   */
  beforeEach(() => {
    renameEntity(wall, 'Edited wall');
    stops.push(watchUnsaved());
    log.length = 0;
  });

  async function saveAs(name: string): Promise<void> {
    const done = saveSceneAs();
    await answerName(name);
    await done;
  }

  it('hands the main process its document, then takes the copy’s id and name', async () => {
    const before = { length: doc().past.length, label: doc().undoLabel() };

    await saveAs('Copy');

    // One call, and "clean" told at once: the main process wrote the file.
    expect(methods()).toEqual(['createScene', 'setDirty']);
    expect(log[1]).toEqual(['setDirty', false]);
    const [, name, contents] = log[0]!;
    expect(name).toBe('Copy');
    // As it stands, original id included: the main process is what replaces it.
    const handed = deserializeScene(contents as string);
    expect(handed.id).toBe('a');
    expect(handed.entities[wall]?.name).toBe('Edited wall');

    expect(doc().scene.id).toBe('c');
    expect(doc().scene.name).toBe('Copy');
    // No undo entry: one would put the original's id back into the copy.
    expect({ length: doc().past.length, label: doc().undoLabel() }).toEqual(before);
    expect(windowUnsaved()).toBe(false);

    expect(useProjectStore.getState().sceneId).toBe('c');
    expect(useProjectStore.getState().scenePath).toBe('scenes/Copy.scene.json');
    expect(addresses.map(sceneInAddress)).toEqual(['c']);
  });

  it('is what the next save writes', async () => {
    await saveAs('Copy');
    renameEntity(wall, 'Edited after Save As');

    await useProjectStore.getState().save();

    expect(log.at(-2)).toEqual(['saveScene', 'scenes/Copy.scene.json']);
    const saved = deserializeScene(written[0]!);
    expect(saved.id).toBe('c');
    expect(saved.name).toBe('Copy');
    expect(saved.entities[wall]?.name).toBe('Edited after Save As');
  });

  it('leaves everything as it was when the main process refuses the name', async () => {
    vi.spyOn(window.studio.project, 'createScene').mockRejectedValue(
      new Error('This project already has a scene called "Copy".'),
    );

    await saveAs('Copy');

    expect(doc().scene.id).toBe('a');
    expect(doc().scene.name).toBe('Main');
    expect(windowUnsaved()).toBe(true);
    expect(useProjectStore.getState().sceneId).toBe('a');
    expect(useProjectStore.getState().scenePath).toBe(MAIN.path);
    expect(addresses).toEqual([]);
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toContain(
      'Could not do that to the scene',
    );
  });
});

describe('the gestures that reload the window, from Prefab Mode during Play', () => {
  /*
   * Open Scene, New Scene and Duplicate end with a reload, which ends Prefab
   * Mode and the game by itself, and the main process's unsaved-changes prompt
   * comes with that reload. Leaving or stopping before it would leave the
   * window out of its prefab, its game stopped, behind a Cancel. What the
   * reload would lose is the open prefabs' edits, so those are saved, where
   * they stand.
   */

  /** A prefab open over the scene and edited, the game running, the main process told. */
  async function inAnEditedPrefabWhilePlaying(): Promise<void> {
    await openCrate();
    renameEntity(crateRoot, 'Edited');
    editor().play();
    stops.push(watchUnsaved());
    log.length = 0;
  }

  it('saves the prefab, says the window is clean, then opens the other scene', async () => {
    await inAnEditedPrefabWhilePlaying();

    await openScene('b');

    expect(log).toEqual([
      ['savePrefab', CRATE],
      ['setDirty', false],
      ['switchScene', 'b'],
    ]);
    // Left to the reload, which a Cancel at the main process's prompt stops.
    expect(prefabMode().stack).toHaveLength(1);
    expect(editor().playState).toBe('playing');
  });

  it("leaves the main process holding the scene's unsaved work, for its prompt", async () => {
    renameEntity(wall, 'Edited wall');
    await inAnEditedPrefabWhilePlaying();

    await openScene('b');

    expect(log).toEqual([
      ['savePrefab', CRATE],
      ['switchScene', 'b'],
    ]);
  });

  it("does nothing for the window's own scene", async () => {
    await inAnEditedPrefabWhilePlaying();

    await openScene('a');

    expect(log).toEqual([]);
    expect(prefabMode().stack).toHaveLength(1);
  });

  it.each([
    ['New Scene', () => newScene(), ['createScene', 'Fresh'], 'c'],
    ['Duplicate', () => duplicateCurrentScene(), ['duplicateScene', 'a', 'Fresh'], 'd'],
  ])('%s saves the prefab once it has its name', async (_, gesture, call, created) => {
    await inAnEditedPrefabWhilePlaying();

    const done = gesture();
    expect(log).toEqual([]);
    await answerName('Fresh');
    await done;

    expect(log).toEqual([['savePrefab', CRATE], ['setDirty', false], call, ['switchScene', created]]);
  });

  it.each([
    ['New Scene', () => newScene()],
    ['Duplicate', () => duplicateCurrentScene()],
  ])('%s cancelled at its name leaves everything as it was', async (_, gesture) => {
    await inAnEditedPrefabWhilePlaying();

    const done = gesture();
    await cancel();
    await done;

    expect(log).toEqual([]);
    expect(prefabMode().stack).toHaveLength(1);
    expect(editor().playState).toBe('playing');
  });
});

describe('showing a file', () => {
  /*
   * Nothing here reads or replaces the document, so Prefab Mode and the game are
   * left as they are. What is shown is the file this window saves to.
   */

  it('shows the file this window saves to, not the one that wins its id', async () => {
    // A copy made in the Finder keeps the id, and a space sorts before the dot,
    // so the copy wins `a`. This window still saves to its own file, which is the
    // one a person goes looking for.
    const copy: SceneEntry = { ...MAIN, name: 'Main copy', path: 'scenes/Main copy.scene.json' };
    useProjectStore.setState({ scenes: [LEVEL_2, copy, { ...MAIN, shadowedBy: copy.path }] });

    await revealCurrentScene();

    expect(log).toEqual([['revealInFileManager', MAIN.path]]);
  });

  it('leaves Prefab Mode open', async () => {
    await openCrate();

    await revealCurrentScene();

    expect(log).toEqual([['revealInFileManager', MAIN.path]]);
    expect(prefabMode().stack).toHaveLength(1);
  });

  it('leaves the game running', async () => {
    editor().play();

    await revealCurrentScene();

    expect(log).toEqual([['revealInFileManager', MAIN.path]]);
    expect(editor().playState).toBe('playing');
  });

  it('says what the main process said when the file has gone', async () => {
    vi.spyOn(window.studio.assets, 'revealInFileManager').mockRejectedValue(
      new Error(
        "Error invoking remote method 'assets:reveal': MissingFileError: There is no file at " +
          'scenes/Main.scene.json: it was moved or deleted outside the editor.',
      ),
    );

    await revealCurrentScene();

    expect(useToastStore.getState().toasts).toMatchObject([
      {
        kind: 'error',
        title: 'Could not show the scene file',
        description:
          'There is no file at scenes/Main.scene.json: it was moved or deleted outside the editor.',
      },
    ]);
  });

  it("says so for an asset's file too", async () => {
    // The Project panel's folder buttons, which used to drop the refusal: their
    // call was `void`, so a rejection went nowhere a person could see.
    vi.spyOn(window.studio.assets, 'revealInFileManager').mockRejectedValue(
      new Error(
        "Error invoking remote method 'assets:reveal': MissingFileError: There is no file at " +
          'assets/crate.glb: it was moved or deleted outside the editor.',
      ),
    );

    await showAssetFile('assets/crate.glb');

    expect(useToastStore.getState().toasts).toMatchObject([
      {
        kind: 'error',
        title: 'Could not show the file',
        description:
          'There is no file at assets/crate.glb: it was moved or deleted outside the editor.',
      },
    ]);
  });
});

describe('Scene Settings', () => {
  /*
   * The scene's own pane is the Inspector with nothing selected. In Prefab Mode
   * that pane is the prefab document's, so the mode is left first, saving the
   * prefab; the game keeps running, since nothing here replaces the document.
   */
  const requests = () => editor().sceneSettingsRequests;

  it('leaves Prefab Mode, saving the prefab, then empties the selection and asks for the pane', async () => {
    // Something selected in the scene, which leaving the prefab puts back: the
    // selection has to be emptied after leaving, not before.
    editor().setSelection([wall]);
    await openCrate();
    const before = requests();

    await showSceneSettings();

    expect(log).toEqual([['savePrefab', CRATE]]);
    expect(prefabMode().stack).toEqual([]);
    expect(editor().selection).toEqual([]);
    expect(requests()).toBe(before + 1);
  });

  it('leaves the game running', async () => {
    editor().setSelection([wall]);
    editor().play();
    const before = requests();

    await showSceneSettings();

    expect(log).toEqual([]);
    expect(editor().playState).toBe('playing');
    expect(editor().selection).toEqual([]);
    expect(requests()).toBe(before + 1);
  });

  it('asks again with nothing in the way: a second request is a request', async () => {
    const before = requests();

    await showSceneSettings();
    await showSceneSettings();

    expect(log).toEqual([]);
    expect(requests()).toBe(before + 2);
  });

  it('stops at a prefab that fails to save, the pane not asked for', async () => {
    useAssetStore.setState({
      savePrefab: async (assetId) => {
        log.push(['savePrefab', assetId]);
        throw new Error('disk full');
      },
    });
    await openCrate();
    const selected = editor().selection;
    const before = requests();

    await showSceneSettings();

    expect(prefabMode().stack).toHaveLength(1);
    expect(editor().selection).toEqual(selected);
    expect(requests()).toBe(before);
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toContain(
      'Could not do that to the scene',
    );
  });
});

describe('Revert Scene', () => {
  /*
   * In place: the document becomes what its file holds, through a load — clean,
   * no history — as the window's reload would give it, without the reload. The
   * file is read before anything is left, so a file that cannot be used leaves
   * Prefab Mode and the game where they were.
   */
  const can = () => commandById('revertScene').can();

  async function revert(): Promise<void> {
    const done = revertCurrentScene();
    await confirm();
    await done;
  }

  /**
   * Stands in for `PlaySession.endPlay`'s safety net, which is not running
   * here, and made unconditional: what the gesture writes after Stop has to be
   * out of its reach.
   */
  function restoreAtStop(): void {
    const atPlay = doc().scene;
    stops.push(
      useEditorStore.subscribe((state, before) => {
        if (state.playState === 'stopped' && before.playState !== 'stopped') {
          doc().replaceScene(atPlay, { keepHistory: true });
        }
      }),
    );
  }

  const titles = () => useToastStore.getState().toasts.map((toast) => toast.title);

  describe('is offered only when there is scene work to drop', () => {
    it('not on a clean scene, and once it is edited', () => {
      expect(can()).toBe(false);
      renameEntity(wall, 'Edited wall');
      expect(can()).toBe(true);
    });

    it('with the scene edited behind an untouched prefab', async () => {
      renameEntity(wall, 'Edited wall');
      await openCrate();
      expect(can()).toBe(true);
    });

    it('not for an edited prefab over a clean scene, which leaving saves', async () => {
      await openCrate();
      renameEntity(crateRoot, 'Edited');
      expect(can()).toBe(false);
    });
  });

  it('puts the document back the way its file has it, clean and with no history', async () => {
    renameEntity(wall, 'Edited wall');
    const added = addEntity(named('Barrel'));
    editor().setSelection([wall, added]);
    stops.push(watchUnsaved());
    log.length = 0;

    await revert();

    // Read and loaded in place: nothing saved, no reload, and the main process
    // told at once that nothing is unsaved.
    expect(log).toEqual([
      ['readScene', MAIN.path],
      ['setDirty', false],
    ]);
    expect(doc().scene.entities[wall]?.name).toBe('Wall');
    expect(doc().scene.entities[added]).toBeUndefined();
    expect(doc().scene.id).toBe('a');
    expect(selectDirty(doc())).toBe(false);
    expect(doc().past).toEqual([]);
    // What the file still holds stays selected.
    expect(editor().selection).toEqual([wall]);
  });

  it('asks first, in words that say what stays', async () => {
    renameEntity(wall, 'Edited wall');

    const done = revertCurrentScene();
    await vi.waitFor(() => expect(useDialogStore.getState().confirm).not.toBeNull());
    const asked = useDialogStore.getState().confirm!;
    useDialogStore.getState().cancel();
    await done;

    expect(asked).toMatchObject({ title: 'Revert "Main"?', confirmLabel: 'Revert', destructive: true });
    expect(asked.message).toContain('Changes already written to materials and prefabs stay.');
  });

  describe('cancelled, leaves everything as it was', () => {
    it('in Prefab Mode', async () => {
      renameEntity(wall, 'Edited wall');
      await openCrate();
      log.length = 0;

      const done = revertCurrentScene();
      await cancel();
      await done;

      expect(log).toEqual([]);
      expect(prefabMode().stack).toHaveLength(1);
      expect(sceneUnsaved()).toBe(true);
    });

    it('during Play', async () => {
      renameEntity(wall, 'Edited wall');
      editor().play();

      const done = revertCurrentScene();
      await cancel();
      await done;

      expect(log).toEqual([]);
      expect(editor().playState).toBe('playing');
      expect(doc().scene.entities[wall]?.name).toBe('Edited wall');
    });
  });

  it('reads the file, then leaves Prefab Mode, saving the prefab, then loads', async () => {
    renameEntity(wall, 'Edited wall');
    await openCrate();
    renameEntity(crateRoot, 'Edited');
    log.length = 0;

    await revert();

    expect(log).toEqual([
      ['readScene', MAIN.path],
      ['savePrefab', CRATE],
    ]);
    expect(savedPrefabs[0]?.entities[crateRoot]?.name).toBe('Edited');
    expect(prefabMode().stack).toEqual([]);
    expect(doc().scene.entities[wall]?.name).toBe('Wall');
    expect(sceneUnsaved()).toBe(false);
  });

  it('stops the game before it loads, so Stop cannot put the edits back', async () => {
    renameEntity(wall, 'Edited wall');
    restoreAtStop();
    editor().play();
    log.length = 0;

    await revert();

    expect(log).toEqual([
      ['readScene', MAIN.path],
      ['stop', 'a'],
    ]);
    expect(editor().playState).toBe('stopped');
    expect(doc().scene.entities[wall]?.name).toBe('Wall');
    expect(selectDirty(doc())).toBe(false);
  });

  it.each([
    [
      'a file that has gone',
      () =>
        new Error(
          "Error invoking remote method 'project:readScene': MissingFileError: There is no file at " +
            'scenes/Main.scene.json: it was moved or deleted outside the editor.',
        ),
      'There is no file at scenes/Main.scene.json',
    ],
    ['a file that does not read', () => '{', undefined],
    [
      'a file holding another scene',
      () => serializeScene({ ...deserializeScene(file as string), id: 'z', name: 'Intruder' }),
      'another scene',
    ],
  ])('refuses %s, and nothing moves', async (_, contents, said) => {
    renameEntity(wall, 'Edited wall');
    await openCrate();
    const before = doc().scene;
    file = contents();
    log.length = 0;

    await revert();

    expect(log).toEqual([['readScene', MAIN.path]]);
    expect(prefabMode().stack).toHaveLength(1);
    expect(doc().scene).toBe(before);
    expect(sceneUnsaved()).toBe(true);
    const toast = useToastStore.getState().toasts.find((t) => t.title === 'Could not revert the scene');
    expect(toast?.kind).toBe('error');
    if (said !== undefined) expect(toast?.description).toContain(said);
  });

  it('loads the file as it is now, changed outside the editor', async () => {
    const outside = deserializeScene(file as string);
    outside.entities[wall]!.name = 'Changed outside';
    file = serializeScene(outside);
    renameEntity(wall, 'Edited wall');

    await revert();

    expect(doc().scene.entities[wall]?.name).toBe('Changed outside');
    expect(selectDirty(doc())).toBe(false);
  });

  it('gives the document the name its file holds, as a reload would', async () => {
    // A rename moves the file and writes the new name into the document as an
    // edit, which stays unsaved until the next save — so the file still holds
    // the old one. What Cmd+Z of the rename would give, too.
    await renameCurrentScene('Renamed');
    log.length = 0;

    await revert();

    expect(log).toEqual([['readScene', 'scenes/Renamed.scene.json']]);
    expect(doc().scene.name).toBe('Main');
    expect(currentSceneName()).toBe('Renamed');
  });

  it('says again what the file points at and cannot find', async () => {
    // An entity the session removed, whose model has gone since: the file still
    // holds it, and the revert brings it back.
    const barrel = addEntity(createModelEntity('gone-model', 'Barrel'));
    doc().markClean();
    file = serializeScene(doc().scene);
    deleteSelection(Selection.of([barrel], doc().scene));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await revert();

      expect(doc().scene.entities[barrel]).toBeDefined();
      expect(warn.mock.calls.map(([line]) => String(line).split(' to ')[0])).toEqual([
        '[scene] 1 reference',
      ]);
    } finally {
      warn.mockRestore();
    }
    expect(titles()).not.toContain('Could not revert the scene');
  });
});
