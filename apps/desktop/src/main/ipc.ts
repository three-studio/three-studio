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
  type ProjectFile,
  type ProjectSettings,
  type LayoutPreferences,
  type OpenProject,
  type ProjectSummary,
  type SceneChange,
  type ScriptBuildResult,
} from '@three-studio/core';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import {
  AssetError,
  createAssetFolder,
  createMaterialAsset,
  createPrefabAsset,
  moveAsset,
  readMaterialAssets,
  readPrefabAssets,
  removeAsset,
  removeAssetFolder,
  renameAssetFolder,
  saveMaterialAsset,
  savePrefabAsset,
  scanAssets,
  updateAssetSettings,
} from './assets';
import { importSessions } from './import/ImportSession';
import { resolveInside } from './paths';
import { loadLayoutPreferences, saveLayoutPreferences } from './preferences';
import { exportBuild } from './exportWeb';
import {
  createProject,
  openProject,
  readProject,
  readSceneFile,
  saveScene,
  writeProject,
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
  const announce = <T>(project: ProjectFile, from: Electron.WebContents, result: T): T => {
    let told = 0;
    for (const win of deps.editorWindows()) {
      if (win.webContents.id !== from.id && !win.isDestroyed()) {
        win.webContents.send('project:changed', project);
        told += 1;
      }
    }
    if (told > 0 && !app.isPackaged) console.log(`[windows] project change sent to ${told}`);
    return result;
  };

  ipcMain.handle('project:launch', (_event, projectPath: string): void => {
    deps.openEditor(projectPath);
  });

  ipcMain.handle('project:browseForProject', async (event): Promise<string | null> => {
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
  });

  ipcMain.handle('project:listRecent', (): Promise<ProjectSummary[]> => listRecent());

  ipcMain.handle('project:forget', (_event, projectPath: string): Promise<void> => {
    return forget(projectPath);
  });

  ipcMain.handle('project:pickDirectory', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window
      ? dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(
    'project:create',
    async (_event, input: { name: string; directory: string }): Promise<OpenProject> => {
      return adopt(await createProject(input.name, input.directory));
    },
  );

  ipcMain.handle(
    'project:open',
    async (event, projectPath: string, sceneId?: string | null): Promise<OpenProject> => {
      const opened = adopt(await openProject(projectPath, sceneId ?? undefined));
      // A window opened without a scene id lands on the start scene, and this
      // is where the main process learns which that was — see `noteScene`.
      deps.noteScene(event.sender, opened.sceneId);
      return opened;
    },
  );

  ipcMain.handle('project:close', () => {
    // Any import still open belongs to a project that is not open any more, and
    // its staged sources were checked against a manifest nobody can reach.
    if (activeProjectPath !== null) importSessions.closeProject(activeProjectPath);
    activeProjectPath = null;
    setCurrentProject(null);
  });

  ipcMain.handle('project:browseAndOpen', async (event): Promise<OpenProject | null> => {
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
  });

  ipcMain.handle(
    'project:saveScene',
    (
      _event,
      input: { projectPath: string; scenePath: string; contents: string },
    ): Promise<void> => {
      return saveScene(input.projectPath, input.scenePath, input.contents);
    },
  );

  // Reading a scene other than the open one is what a running game does when
  // it moves to the next level. Guarded like everything else: the renderer
  // names a path, and `readSceneFile` proves it stayed inside the project.
  ipcMain.handle('project:readScene', (_event, scenePath: string): Promise<string> => {
    return readSceneFile(requireProject(), scenePath);
  });

  ipcMain.on('project:setDirty', (event, dirty: boolean) => {
    unsavedByWindow.set(event.sender.id, dirty === true);
  });

  /*
   * Changing scene reloads the window on another one, prompt included. The
   * renderer cannot do this itself: the guard has to be able to say no, and a
   * renderer asking permission to destroy itself would be asking the thing it
   * is about to destroy.
   */
  ipcMain.handle('project:switchScene', (event, sceneId: string): boolean => {
    return deps.switchScene(event.sender, sceneId);
  });

  ipcMain.handle('project:openSceneWindow', (_event, sceneId: string): void => {
    deps.openSceneWindow(sceneId);
  });

  /*
   * The scene registry. `writeProject` had one caller until now — updating the
   * settings — and these are the others: everything that changes which scenes a
   * project has goes through the main process, because each of them has to
   * rewrite the project file and the files on disk together.
   */
  ipcMain.handle('project:createScene', async (event, name: string): Promise<SceneChange> => {
    const change = await createScene(requireProject(), name);
    return announce(change.project, event.sender, change);
  });

  ipcMain.handle(
    'project:duplicateScene',
    async (event, sceneId: string, name: string): Promise<SceneChange> => {
      const change = await duplicateScene(requireProject(), sceneId, name);
      return announce(change.project, event.sender, change);
    },
  );

  ipcMain.handle(
    'project:renameScene',
    async (event, sceneId: string, name: string): Promise<SceneChange> => {
      const change = await renameScene(requireProject(), sceneId, name);
      return announce(change.project, event.sender, change);
    },
  );

  ipcMain.handle('project:deleteScene', async (event, sceneId: string): Promise<ProjectFile> => {
    // Refused rather than left to go wrong later: the file would go, the other
    // window would stay open on it, and its next save would write back a scene
    // the project no longer lists.
    if (deps.isSceneOpenElsewhere(event.sender, sceneId)) {
      throw new Error('That scene is open in another window. Close that window first.');
    }
    const project = await deleteScene(requireProject(), sceneId);
    return announce(project, event.sender, project);
  });

  ipcMain.handle('project:setStartScene', async (event, sceneId: string): Promise<ProjectFile> => {
    const project = await setStartScene(requireProject(), sceneId);
    return announce(project, event.sender, project);
  });

  ipcMain.handle('assets:list', (): Promise<AssetManifest> => scanAssets(requireProject()));

  ipcMain.handle(
    'assets:openImport',
    (_event, sourcePaths: readonly string[], folder?: string): Promise<ImportSessionState> => {
      return importSessions.start(requireProject(), sourcePaths, folder ?? '');
    },
  );

  ipcMain.handle(
    'assets:browseAndOpenImport',
    async (event, folder?: string): Promise<ImportSessionState> => {
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
  );

  ipcMain.handle(
    'assets:commitImport',
    async (
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
  );

  ipcMain.handle('assets:cancelImport', (_event, sessionId: string): void => {
    importSessions.close(sessionId);
  });

  ipcMain.handle('assets:remove', (_event, assetPath: string): Promise<void> => {
    return removeAsset(requireProject(), assetPath);
  });

  ipcMain.handle(
    'assets:move',
    (_event, assetPath: string, targetFolder: string): Promise<string> => {
      return moveAsset(requireProject(), assetPath, targetFolder);
    },
  );

  ipcMain.handle('assets:createFolder', (_event, folder: string): Promise<string> => {
    return createAssetFolder(requireProject(), folder);
  });

  ipcMain.handle(
    'assets:renameFolder',
    (_event, folder: string, name: string): Promise<string> => {
      return renameAssetFolder(requireProject(), folder, name);
    },
  );

  ipcMain.handle('assets:removeFolder', (_event, folder: string): Promise<void> => {
    return removeAssetFolder(requireProject(), folder);
  });

  ipcMain.handle(
    'assets:updateSettings',
    (_event, assetPath: string, settings: AssetSettings): Promise<void> => {
      return updateAssetSettings(requireProject(), assetPath, settings);
    },
  );

  ipcMain.handle(
    'assets:readMaterials',
    (): Promise<Record<string, MaterialDef>> => readMaterialAssets(requireProject()),
  );

  ipcMain.handle(
    'assets:createMaterial',
    (_event, name: string, material: MaterialDef): Promise<string> => {
      return createMaterialAsset(requireProject(), name, material);
    },
  );

  ipcMain.handle(
    'assets:readPrefabs',
    (): Promise<Record<string, PrefabDoc>> => readPrefabAssets(requireProject()),
  );

  ipcMain.handle(
    'assets:createPrefab',
    (_event, name: string, prefab: PrefabDoc, assetId?: string): Promise<string> => {
      return createPrefabAsset(requireProject(), name, prefab, assetId);
    },
  );

  ipcMain.handle(
    'assets:saveMaterial',
    (_event, assetPath: string, material: MaterialDef): Promise<void> => {
      return saveMaterialAsset(requireProject(), assetPath, material);
    },
  );

  ipcMain.handle(
    'assets:savePrefab',
    (_event, assetPath: string, prefab: PrefabDoc): Promise<void> => {
      return savePrefabAsset(requireProject(), assetPath, prefab);
    },
  );

  // Only folders this session produced. The renderer naming a path and the
  // main process opening it is a hole; naming one it was just handed back is
  // not.
  const exportedDirs = new Set<string>();

  ipcMain.handle(
    'build:export',
    async (event, profileId?: string): Promise<ExportResult> => {
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
          if (!event.sender.isDestroyed()) event.sender.send('build:progress', progress);
        },
      );
      exportedDirs.add(outputDir);
      return result;
    },
  );

  ipcMain.handle(
    'build:chooseOutputDir',
    async (_event, startIn?: string | null): Promise<string | null> => {
      const picked = await dialog.showOpenDialog({
        title: 'Build output folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: startIn ?? undefined,
        buttonLabel: 'Choose',
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
  );

  ipcMain.handle(
    'project:updateSettings',
    async (event, patch: Partial<ProjectSettings>): Promise<ProjectFile> => {
      const projectPath = requireProject();
      // Re-read rather than trust the renderer's copy: the file may have moved
      // on since the dialog opened.
      const project = await readProject(projectPath);
      const updated: ProjectFile = {
        ...project,
        settings: { ...project.settings, ...patch },
      };
      await writeProject(projectPath, updated);
      return announce(updated, event.sender, updated);
    },
  );

  ipcMain.handle('build:revealOutput', (_event, outputDir: string): void => {
    if (!exportedDirs.has(outputDir)) {
      throw new Error('That folder was not produced by this session.');
    }
    shell.openPath(outputDir).catch(() => undefined);
  });

  ipcMain.handle('prefs:loadLayouts', (): Promise<LayoutPreferences> => loadLayoutPreferences());

  ipcMain.handle(
    'prefs:saveLayouts',
    (_event, preferences: LayoutPreferences): Promise<void> => saveLayoutPreferences(preferences),
  );

  ipcMain.handle('scripts:build', (): Promise<ScriptBuildResult> => buildScripts(requireProject()));

  ipcMain.handle('scripts:create', (_event, name: string): Promise<string> => {
    return createScript(requireProject(), name);
  });

  ipcMain.handle('assets:reveal', (_event, assetPath: string) => {
    // `showItemInFolder` takes an absolute path, so the guard still applies.
    shell.showItemInFolder(resolveInside(requireProject(), assetPath));
  });
}
