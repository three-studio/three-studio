import { dirname } from 'node:path';
import {
  ASSET_KIND_INFO,
  PROJECT_FILE_NAME,
  type AssetImportResult,
  type AssetManifest,
  type AssetSettings,
  type ImportPlanItem,
  type ImportSessionState,
  type ExportResult,
  type MaterialDef,
  type PrefabDoc,
  type ProjectContents,
  type ProjectFile,
  type ProjectSettings,
  type LayoutPreferences,
  type OpenProject,
  type ProjectSummary,
  type SceneChange,
  type ScriptBuildResult,
  IPC_EVENTS,
  IPC_INVOKE,
  conformLayoutPreferences,
  conformMaterial,
  conformSettingsPatch,
  migratePrefab,
  type BridgeHandlers,
} from '@three-studio/core';
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

/**
 * One entry of the table, as the registration loop sees it once the type above
 * has done its work. `any[]` because `ipcMain.handle` declares its own handler
 * that way and a stricter one is not assignable to it — the arguments are
 * checked where they are written, in the table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
import { AssetError } from './assetFiles';
import {
  createMaterialAsset,
  createPrefabAsset,
  readMaterialAssets,
  readPrefabAssets,
  saveMaterialAsset,
  savePrefabAsset,
} from './assetLibraries';
import {
  createAssetFolder,
  moveAsset,
  removeAsset,
  removeAssetFolder,
  renameAssetFolder,
} from './assetMutations';
import { scanAssets, updateAssetSettings } from './assetScan';
import { importSessions } from './import/ImportSession';
import { resolveInside } from './paths';
import { loadLayoutPreferences, saveLayoutPreferences } from './preferences';
import { exportBuild } from './exportWeb';
import {
  createProject,
  discoverScenes,
  openProject,
  readProject,
  readSceneFile,
  saveScene,
  updateProject,
} from './project';
import { createScene, deleteScene, duplicateScene, renameScene, setStartScene } from './scenes';
import { buildScripts, createScript } from './scripts';
import { setCurrentProject } from './protocol';
import { forget, listRecent } from './recentProjects';

/**
 * The renderer's unsaved state, mirrored per window so the close handler can
 * warn about the right one.
 *
 * A single boolean was enough while there was one editor window. With two, it
 * names whichever renderer spoke last: the close guard would throw away another
 * window's work, or block this one over a document it does not hold. Keyed by
 * `webContents.id` and purged when the window goes — the prerequisite for step
 * 4, put in place here while there is still only one window to get it wrong.
 */
const unsavedByWindow = new Map<number, boolean>();
/**
 * The open project, held here rather than passed from the renderer on every
 * call: an asset request that could name its own root would be a way around
 * the project sandbox.
 */
let activeProjectPath: string | null = null;

export function isDirty(windowId: number): boolean {
  return unsavedByWindow.get(windowId) === true;
}

/** Called when a window is gone, or reloaded onto another scene. */
export function forgetWindow(windowId: number): void {
  unsavedByWindow.delete(windowId);
}

function requireProject(): string {
  if (activeProjectPath === null) throw new Error('No project is open.');
  return activeProjectPath;
}

function adopt(opened: OpenProject): OpenProject {
  activeProjectPath = opened.summary.path;
  setCurrentProject(activeProjectPath);
  return opened;
}

/**
 * Every capability the renderer has. Handlers are the trust boundary: the
 * renderer is sandboxed and cannot touch the file system on its own, so
 * anything reachable from the page has to be justified here.
 */
/**
 * What the handlers need from the window layer.
 *
 * Injected rather than imported: `windows.ts` already reads `isDirty` from
 * here, and importing it back would be a cycle between the two modules that
 * hold the app together.
 */
export interface IpcDeps {
  openEditor: (projectPath: string) => void;
  /**
   * Reloads the asking window on another scene.
   *
   * `false` when the user cancelled at the unsaved-changes prompt. The window
   * is passed because with several open there is no such thing as "the editor".
   */
  switchScene: (from: Electron.WebContents, sceneId: string) => boolean;
  /** Opens a scene of the same project in a window of its own. */
  openSceneWindow: (sceneId: string) => void;
  /** Records which scene a window's renderer settled on. */
  noteScene: (from: Electron.WebContents, sceneId: string) => void;
  /** True when a scene is open in a window other than the one asking. */
  isSceneOpenElsewhere: (from: Electron.WebContents, sceneId: string) => boolean;
  /** Every editor window, for broadcasting a project that has changed. */
  editorWindows: () => readonly BrowserWindow[];
}

export function registerIpcHandlers(deps: IpcDeps): void {
  /**
   * Tells the other windows that the project file has moved on.
   *
   * They each hold a copy, taken when they opened. Without this, a scene
   * created, renamed or deleted in one window is invisible in every other one:
   * a stale scene menu, a title showing a name nobody uses any more, and a
   * start-scene radio on a choice that has been replaced. The window that asked
   * already has the answer as the call's return value.
   */
  const announce = <T>(
    contents: ProjectContents,
    from: Electron.WebContents,
    result: T,
  ): T => {
    let told = 0;
    for (const win of deps.editorWindows()) {
      if (win.webContents.id !== from.id && !win.isDestroyed()) {
        // The scene list as well as the file: it is the `scenes/` directory
        // now, and a renderer cannot read one. Without it a scene created in
        // this window would be missing from every other window's menu until
        // that window was reloaded.
        win.webContents.send(IPC_EVENTS.projectChanged, contents);
        told += 1;
      }
    }
    if (told > 0 && !app.isPackaged) console.log(`[windows] project change sent to ${told}`);
    return result;
  };

  ipcMain.on(IPC_EVENTS.setDirty, (event, dirty: boolean) => {
    unsavedByWindow.set(event.sender.id, dirty === true);
  });

  // Only folders this session produced. The renderer naming a path and the
  // main process opening it is a hole; naming one it was just handed back is
  // not.
  const exportedDirs = new Set<string>();

  /*
   * Every handler, in one table, and the table is the check.
   *
   * `BridgeHandlers` is derived from `StudioBridge`: leave a member out and
   * this does not compile, and add one to an API in `core` and this does not
   * compile until it has an answer here. Before, forty-four `ipcMain.handle`
   * calls each named their channel as a string and re-annotated their own
   * arguments; a typo was `No handler registered` at run time, and a member
   * with no handler at all was nothing anyone could be told about.
   *
   * The event comes first, as it does for `ipcMain.handle`, because a handler
   * often has to know which window asked — which one to reload onto another
   * scene, which one to parent a dialog to.
   */
  const handlers: BridgeHandlers<IpcMainInvokeEvent> = {
  project: {
    launch: (_event, projectPath: string): void => {
      deps.openEditor(projectPath);
    },

    browseForProject: async (event): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Open Project',
        properties: ['openFile'],
        filters: [{ name: 'Three Studio Project', extensions: ['json'] }],
      };
      const result = await (window
        ? dialog.showOpenDialog(window, options)
        : dialog.showOpenDialog(options));

      const picked = result.canceled ? undefined : result.filePaths[0];
      if (picked === undefined) return null;
      // The picker selects project.json; the project is the directory holding it.
      return picked.endsWith(PROJECT_FILE_NAME) ? dirname(picked) : picked;
    },


    listRecent: (): Promise<ProjectSummary[]> => listRecent(),

    forget: (_event, projectPath: string): Promise<void> => {
      return forget(projectPath);
    },

    pickDirectory: async (event): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await (window
        ? dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
        : dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    create: async (_event, input: { name: string; directory: string }): Promise<OpenProject> => {
      return adopt(await createProject(input.name, input.directory));
    },

    open: async (event, projectPath: string, sceneId?: string | null): Promise<OpenProject> => {
      const opened = adopt(await openProject(projectPath, sceneId ?? undefined));
      // A window opened without a scene id lands on the start scene, and this
      // is where the main process learns which that was — see `noteScene`.
      deps.noteScene(event.sender, opened.sceneId);
      return opened;
    },

    close: () => {
      // Any import still open belongs to a project that is not open any more, and
      // its staged sources were checked against a manifest nobody can reach.
      if (activeProjectPath !== null) importSessions.closeProject(activeProjectPath);
      activeProjectPath = null;
      setCurrentProject(null);
    },

    browseAndOpen: async (event): Promise<OpenProject | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Open Project',
        properties: ['openFile'],
        filters: [{ name: 'Three Studio Project', extensions: ['json'] }],
      };
      const result = await (window
        ? dialog.showOpenDialog(window, options)
        : dialog.showOpenDialog(options));

      const picked = result.canceled ? undefined : result.filePaths[0];
      if (picked === undefined) return null;
      // The picker selects project.json; the project is the directory holding it.
      return adopt(await openProject(picked.endsWith(PROJECT_FILE_NAME) ? dirname(picked) : picked));
    },

    saveScene: (
      _event,
      input: { projectPath: string; scenePath: string; contents: string },
    ): Promise<void> => {
      return saveScene(input.projectPath, input.scenePath, input.contents);
    },

  // Reading a scene other than the open one is what a running game does when
  // it moves to the next level. Guarded like everything else: the renderer
  // names a path, and `readSceneFile` proves it stayed inside the project.
    readScene: (_event, scenePath: string): Promise<string> => {
      return readSceneFile(requireProject(), scenePath);
    },

  /*
   * Changing scene reloads the window on another one, prompt included. The
   * renderer cannot do this itself: the guard has to be able to say no, and a
   * renderer asking permission to destroy itself would be asking the thing it
   * is about to destroy.
   */
    switchScene: (event, sceneId: string): boolean => {
      return deps.switchScene(event.sender, sceneId);
    },

    openSceneWindow: (_event, sceneId: string): void => {
      deps.openSceneWindow(sceneId);
    },

  /*
   * The scenes of the project. Only the last two write `project.json` at all
   * now: what scenes a project has is what is under `scenes/`, so creating,
   * duplicating and renaming one are writes to that directory and nothing else.
   * They are still here rather than in the renderer because the renderer has no
   * file system — and because a window that could write there could add a scene
   * to a project it cannot read.
   */
    createScene: async (event, name: string): Promise<SceneChange> => {
      const change = await createScene(requireProject(), name);
      return announce(change, event.sender, change);
    },

    duplicateScene: async (event, sceneId: string, name: string): Promise<SceneChange> => {
      const change = await duplicateScene(requireProject(), sceneId, name);
      return announce(change, event.sender, change);
    },

    renameScene: async (event, sceneId: string, name: string): Promise<SceneChange> => {
      const change = await renameScene(requireProject(), sceneId, name);
      return announce(change, event.sender, change);
    },

    deleteScene: async (event, sceneId: string): Promise<ProjectContents> => {
      // Refused rather than left to go wrong later: the file would go, the other
      // window would stay open on it, and its next save would write back a scene
      // the project no longer lists.
      if (deps.isSceneOpenElsewhere(event.sender, sceneId)) {
        throw new Error('That scene is open in another window. Close that window first.');
      }
      const contents = await deleteScene(requireProject(), sceneId);
      return announce(contents, event.sender, contents);
    },

    setStartScene: async (event, sceneId: string): Promise<ProjectContents> => {
      const contents = await setStartScene(requireProject(), sceneId);
      return announce(contents, event.sender, contents);
    },

    updateSettings: async (event, patch: Partial<ProjectSettings>): Promise<ProjectFile> => {
      const projectPath = requireProject();
      // Re-read inside the write rather than trusting the renderer's copy: the
      // file may have moved on since the dialog opened, and another window may
      // be setting the start scene at this very moment. `updateProject` is what
      // makes the read and the write one step.
      const updated = await updateProject(projectPath, (project) => ({
        ...project,
        // Conformed against the settings on disk, not spread in as they came:
        // a patch is whatever the renderer sent, and this one lands in
        // `project.json`. See `conformSettingsPatch`.
        settings: { ...project.settings, ...conformSettingsPatch(patch, project.settings) },
      }));
      // Settings cannot change which scenes exist, but the broadcast carries
      // the whole of what a window holds, so the list has to come along or the
      // other windows would adopt an empty one.
      const scenes = await discoverScenes(projectPath);
      return announce({ project: updated, scenes }, event.sender, updated);
    },
  },
  assets: {
    list: (): Promise<AssetManifest> => scanAssets(requireProject()),

    openImport: (_event, sourcePaths: readonly string[], folder?: string): Promise<ImportSessionState> => {
      return importSessions.start(requireProject(), sourcePaths, folder ?? '');
    },

    browseAndOpenImport: async (event, folder?: string): Promise<ImportSessionState> => {
      const projectPath = requireProject();
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: 'Import Assets',
        // Folders too: dropping one onto the panel already works, and a picker
        // that refused what a drop accepts would be the odd one out.
        properties: ['openFile', 'multiSelections', 'openDirectory'],
        filters: Object.entries(ASSET_KIND_INFO).map(([kind, info]) => ({
          name: `${kind[0]?.toUpperCase()}${kind.slice(1)}s`,
          extensions: [...info.extensions],
        })),
      };
      const result = await (window
        ? dialog.showOpenDialog(window, options)
        : dialog.showOpenDialog(options));

      if (result.canceled || result.filePaths.length === 0) {
        return { sessionId: '', files: [], folder: folder ?? '' };
      }
      return importSessions.start(projectPath, result.filePaths, folder ?? '');
    },

    commitImport: async (
      _event,
      sessionId: string,
      plan: readonly ImportPlanItem[],
    ): Promise<AssetImportResult> => {
      const session = importSessions.get(sessionId);
      if (session === undefined) {
        throw new AssetError('That import is no longer open.');
      }
      try {
        return await session.commit(plan);
      } finally {
        // Committed or thrown, the session is spent: its sources were staged
        // against a project state that the commit has just changed.
        importSessions.close(sessionId);
      }
    },

    cancelImport: (_event, sessionId: string): void => {
      importSessions.close(sessionId);
    },

    remove: (_event, assetPath: string): Promise<void> => {
      return removeAsset(requireProject(), assetPath);
    },

    move: (_event, assetPath: string, targetFolder: string): Promise<string> => {
      return moveAsset(requireProject(), assetPath, targetFolder);
    },

    createFolder: (_event, folder: string): Promise<string> => {
      return createAssetFolder(requireProject(), folder);
    },

    renameFolder: (_event, folder: string, name: string): Promise<string> => {
      return renameAssetFolder(requireProject(), folder, name);
    },

    removeFolder: (_event, folder: string): Promise<void> => {
      return removeAssetFolder(requireProject(), folder);
    },

    updateSettings: (_event, assetPath: string, settings: AssetSettings): Promise<void> => {
      // Conformed inside, where the sidecar's kind is known; see there.
      return updateAssetSettings(requireProject(), assetPath, settings);
    },

    readMaterials: (): Promise<Record<string, MaterialDef>> => readMaterialAssets(requireProject()),

    createMaterial: (_event, name: string, material: MaterialDef): Promise<string> => {
      return createMaterialAsset(requireProject(), name, conformMaterial(material));
    },

    readPrefabs: (): Promise<Record<string, PrefabDoc>> => readPrefabAssets(requireProject()),

    createPrefab: (_event, name: string, prefab: PrefabDoc, assetId?: string): Promise<string> => {
      // `migratePrefab` rather than `conform`, and the difference is who wrote
      // the data. A prefab has been read off the disk, possibly written by a
      // build that knew a component type this one does not, and the migration
      // is the one repair that keeps such a type instead of inventing a shape
      // for it. Conforming it would drop the author's work on the round trip.
      return createPrefabAsset(requireProject(), name, migratePrefab(prefab), assetId);
    },

    saveMaterial: (_event, assetPath: string, material: MaterialDef): Promise<void> => {
      return saveMaterialAsset(requireProject(), assetPath, conformMaterial(material));
    },

    savePrefab: (_event, assetPath: string, prefab: PrefabDoc): Promise<void> => {
      return savePrefabAsset(requireProject(), assetPath, migratePrefab(prefab));
    },

    revealInFileManager: (_event, assetPath: string) => {
      // `showItemInFolder` takes an absolute path, so the guard still applies.
      shell.showItemInFolder(resolveInside(requireProject(), assetPath));
    },
  },
  scripts: {
    build: (): Promise<ScriptBuildResult> => buildScripts(requireProject()),

    create: (_event, name: string): Promise<string> => {
      return createScript(requireProject(), name);
    },
  },
  build: {
    export: async (event, profileId?: string): Promise<ExportResult> => {
      const projectPath = requireProject();
      const project = await readProject(projectPath);
      const settings = project.settings.build;
      const id = profileId ?? settings.active;
      const profile = settings.profiles[id];
      if (!profile) throw new Error(`No build profile "${id}".`);

      const outputDir = profile.outputDir;
      if (!outputDir) {
        throw new Error(`"${profile.name}" has no output folder. Choose one in Package.`);
      }

      // Packaged, the player sits in the app's resources; in development it is
      // the workspace build, found by walking up from the app path.
      const result = await exportBuild(
        projectPath,
        profile,
        outputDir,
        [process.resourcesPath, app.getAppPath()],
        (progress) => {
          // `isDestroyed` because an export outlives a window that is closed
          // mid-run, and sending to a dead frame throws.
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.buildProgress, progress);
        },
      );
      exportedDirs.add(outputDir);
      return result;
    },

    chooseOutputDir: async (_event, startIn?: string | null): Promise<string | null> => {
      const picked = await dialog.showOpenDialog({
        title: 'Build output folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: startIn ?? undefined,
        buttonLabel: 'Choose',
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },

    revealOutput: (_event, outputDir: string): void => {
      if (!exportedDirs.has(outputDir)) {
        throw new Error('That folder was not produced by this session.');
      }
      shell.openPath(outputDir).catch(() => undefined);
    },
  },
  preferences: {
    loadLayouts: (): Promise<LayoutPreferences> => loadLayoutPreferences(),

    saveLayouts: (_event, preferences: LayoutPreferences): Promise<void> =>
      saveLayoutPreferences(conformLayoutPreferences(preferences)),
  },
  };

  /*
   * One registration, walked. The casts are `Object.entries` widening its keys
   * to `string` and nothing more: what may be in the table is settled above, by
   * the type.
   */
  for (const [group, methods] of Object.entries(handlers)) {
    const channels = IPC_INVOKE[group as keyof typeof IPC_INVOKE] as Record<string, string>;
    for (const [method, handler] of Object.entries(methods as Record<string, IpcHandler>)) {
      ipcMain.handle(channels[method]!, handler);
    }
  }
}
