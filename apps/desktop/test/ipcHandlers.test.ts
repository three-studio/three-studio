import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IPC_EVENTS,
  IPC_INVOKE,
  LAYOUT_PREFERENCES_VERSION,
  createMaterial,
  type AssetManifest,
  type ProjectContents,
  type ProjectFile,
} from '@three-studio/core';
import type { BrowserWindow } from 'electron';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The handler table, driven.
 *
 * `ipc.ts` is the trust boundary, and it is the one file in the main process
 * that had no test at all. The guards in `core/guards.ts` are covered field by
 * field, and so is every function the handlers call — but nothing had ever
 * checked that a handler *reaches* a guard. `conformMaterial(material)` is one
 * argument inside one line; dropping it changes no type, breaks no test, and
 * turns the boundary off for that channel.
 *
 * Electron is why it went untested, so Electron is what is replaced: `ipcMain`
 * keeps the handlers instead of registering them, and the four other members
 * are the ones the handlers below actually touch. Nothing else is faked —
 * these run against a real project on disk, the real `session.ts`, and the
 * real writes.
 */

const stub = vi.hoisted(() => ({
  /** Where `preferences.ts` writes. A temporary directory, made below. */
  userData: '',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  // `isPackaged` true only so `announce` does not log. What it would have
  // counted is checked here by looking at who was sent to.
  app: {
    isPackaged: true,
    getPath: (): string => stub.userData,
    getAppPath: (): string => stub.userData,
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
  ipcMain: {
    on: () => undefined,
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      stub.handlers.set(channel, handler);
    },
  },
  shell: { showItemInFolder: () => undefined, openPath: () => Promise.resolve('') },
}));

const { registerIpcHandlers } = await import('../src/main/ipc');
const { createProject, discoverScenes, readProject } = await import('../src/main/project');
const { adoptProject, releaseProject } = await import('../src/main/session');

/** An editor window, as `announce` uses one: an id, a mailbox, and a grave. */
function editorWindow(id: number, destroyed = false) {
  const told: { channel: string; payload: unknown }[] = [];
  return {
    told,
    isDestroyed: (): boolean => destroyed,
    webContents: {
      id,
      send: (channel: string, payload: unknown): void => void told.push({ channel, payload }),
    },
  };
}

let windows: ReturnType<typeof editorWindow>[] = [];
let sceneOpenElsewhere = false;

beforeAll(async () => {
  stub.userData = await mkdtemp(join(tmpdir(), 'studio-ipc-prefs-'));
  registerIpcHandlers({
    openEditor: () => undefined,
    switchScene: () => true,
    openSceneWindow: () => undefined,
    noteScene: () => undefined,
    isSceneOpenElsewhere: () => sceneOpenElsewhere,
    editorWindows: () => windows as unknown as BrowserWindow[],
  });
});

beforeEach(() => {
  windows = [];
  sceneOpenElsewhere = false;
  releaseProject();
});

/** A project with one scene, open, as every handler below assumes. */
async function project(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-ipc-'));
  const root = (await createProject('Races', parent)).summary.path;
  adoptProject(root);
  return root;
}

/** One call, as `ipcMain` would make it: the asking window, then the arguments. */
async function invoke<T>(channel: string, from: number, ...args: unknown[]): Promise<T> {
  const handler = stub.handlers.get(channel);
  if (!handler) throw new Error(`nothing is registered on ${channel}`);
  return (await handler(
    { sender: { id: from, isDestroyed: () => false, send: () => undefined } },
    ...args,
  )) as T;
}

describe('the table that is registered', () => {
  it('answers on every channel the bridge names, and on no other', () => {
    // `BridgeHandlers` makes the table total at compile time; this is the loop
    // that walks it. It reads each channel out of a second table by name and
    // asserts the result, so a group present in one and not the other would
    // register the channel `undefined` and fail nowhere.
    const named = Object.values(IPC_INVOKE)
      .flatMap((group) => Object.values(group))
      .sort();

    expect([...stub.handlers.keys()].sort()).toEqual(named);
  });
});

describe('the guards are reached, not merely written', () => {
  it('conforms a material on the way in, before it becomes a file', async () => {
    await project();

    const id = await invoke<string>(IPC_INVOKE.assets.createMaterial, 1, 'Brick', {
      ...createMaterial(),
      side: 'sideways',
      roughness: 'lots',
      trap: 1,
    });

    // Read back through the channel that reads the file, so what is checked is
    // what a scene will be given, not what the handler was handed.
    const written = (await invoke<Record<string, Record<string, unknown>>>(
      IPC_INVOKE.assets.readMaterials,
      1,
    ))[id]!;
    // `side` is a closed union, so a member nobody declared falls back to the
    // factory's; `roughness` is a number and a string does not fit; and a field
    // the model does not name is dropped rather than carried into the file.
    expect(written.side).toBe('front');
    expect(written.roughness).toBe(0.75);
    expect(written).not.toHaveProperty('trap');
  });

  it('conforms it again on the way back out, which is a second call site', async () => {
    await project();
    const id = await invoke<string>(
      IPC_INVOKE.assets.createMaterial,
      1,
      'Brick',
      createMaterial(),
    );
    const manifest = await invoke<AssetManifest>(IPC_INVOKE.assets.list, 1);
    const entry = manifest.assets.find((asset) => asset.id === id)!;

    await invoke(IPC_INVOKE.assets.saveMaterial, 1, entry.path, {
      ...createMaterial('#ff0000'),
      wrap: 'sideways',
      trap: 1,
    });

    const written = (await invoke<Record<string, Record<string, unknown>>>(
      IPC_INVOKE.assets.readMaterials,
      1,
    ))[id]!;
    expect(written.color).toBe('#ff0000');
    expect(written.wrap).toBe(createMaterial().wrap);
    expect(written).not.toHaveProperty('trap');
  });

  it('conforms a settings patch, so `profiles: "oops"` does not mint four profiles', async () => {
    const root = await project();
    const before = Object.keys((await readProject(root)).settings.build.profiles);

    await invoke(IPC_INVOKE.project.updateSettings, 1, { build: { profiles: 'oops' } });

    // `Object.entries` walks a string one character at a time. Unconformed,
    // this wrote four profiles into `project.json` under the ids `0`…`3`, each
    // a copy of the model, and the Package dialog then offered them.
    const after = await readProject(root);
    expect(Object.keys(after.settings.build.profiles)).toEqual(before);
  });

  it('conforms layout preferences before they reach the file', async () => {
    await invoke(IPC_INVOKE.preferences.saveLayouts, 1, {
      version: LAYOUT_PREFERENCES_VERSION,
      working: 'not an object',
      templates: 'not a list',
      trap: 1,
    });

    const written = JSON.parse(
      await readFile(join(stub.userData, 'layouts.json'), 'utf8'),
    ) as Record<string, unknown>;
    // These are handed straight back to dockview on the next launch, so the
    // shapes it cannot read have to be gone before they are stored.
    expect(written.working).toBeNull();
    expect(written.templates).toEqual([]);
    expect(written).not.toHaveProperty('trap');
  });
});

describe('the refusals that exist only at the boundary', () => {
  it('will not delete a scene another window has open, and leaves the file', async () => {
    const root = await project();
    const scene = (await discoverScenes(root))[0]!;
    sceneOpenElsewhere = true;

    await expect(invoke(IPC_INVOKE.project.deleteScene, 1, scene.id)).rejects.toThrow(
      'open in another window',
    );

    // The point of refusing early: the other window would have stayed open on
    // a file that was gone, and its next save would have written back a scene
    // the project no longer lists.
    await expect(stat(join(root, scene.path))).resolves.toBeDefined();
  });

  it('will not reveal a folder this session did not export to', async () => {
    await project();

    await expect(invoke(IPC_INVOKE.build.revealOutput, 1, tmpdir())).rejects.toThrow(
      'not produced by this session',
    );
  });
});

describe('what the other windows are told', () => {
  it('tells every other editor window, and never the one that asked', async () => {
    await project();
    windows = [editorWindow(1), editorWindow(2), editorWindow(3)];

    await invoke(IPC_INVOKE.project.createScene, 1, 'Boss');

    // The asker already has the answer as the call's return value; sending it
    // again would be a second render of a change it has already applied.
    expect(windows[0]!.told).toEqual([]);
    expect(windows[1]!.told.map((entry) => entry.channel)).toEqual([IPC_EVENTS.projectChanged]);
    expect(windows[2]!.told).toHaveLength(1);
  });

  it('skips a window that has been destroyed', async () => {
    await project();
    const gone = editorWindow(2, true);
    windows = [editorWindow(1), gone];

    await invoke(IPC_INVOKE.project.createScene, 1, 'Boss');

    expect(gone.told).toEqual([]);
  });

  it('broadcasts the scene list even when only the settings changed', async () => {
    await project();
    windows = [editorWindow(1), editorWindow(2)];

    const returned = await invoke<ProjectFile>(IPC_INVOKE.project.updateSettings, 1, {
      loadingScene: 'splash',
    });

    // The two differ on purpose. The asker gets the file it changed; the others
    // hold a whole `ProjectContents`, so handing them the file alone would
    // leave them adopting an empty scene list.
    expect(returned).not.toHaveProperty('scenes');
    const payload = windows[1]!.told[0]!.payload as ProjectContents;
    expect(payload.project.settings.loadingScene).toBe('splash');
    expect(payload.scenes.length).toBeGreaterThan(0);
  });
});
