import type {
  AssetImportResult,
  AssetManifest,
  ImportSessionState,
  ExportProgress,
  ExportResult,
  AssetChange,
  LayoutPreferences,
  ShortcutPreferences,
  MaterialDef,
  OpenProject,
  PrefabDoc,
  Platform,
  ProjectContents,
  ProjectFile,
  ProjectSummary,
  SceneChange,
  ScriptBuildResult,
  StudioBridge,
} from '@three-studio/core';
/*
 * The channel names, from the one table that has them. Written here as
 * literals until now, and written again in `ipc.ts` — forty-seven of them,
 * twice, with a typo landing as `No handler registered` at run time.
 */
import { IPC_EVENTS, IPC_INVOKE } from '@three-studio/core';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { windowIdentity } from './windowIdentity';

/**
 * What this window is, read from what it was handed.
 *
 * Through argv and the URL rather than over IPC because the renderer needs its
 * role before the first render: asking for it would paint the launcher shell
 * for a frame inside the editor window, and vice versa. The reading is in
 * `windowIdentity.ts`, where it can be run without a window.
 */
const identity = windowIdentity(process.argv, location.search);

/**
 * Everything the renderer is allowed to reach in the main process goes through
 * this object. It stays small and explicit on purpose — each addition widens
 * the surface a project file or user script can attack.
 */
const bridge: StudioBridge = {
  platform: process.platform as Platform,
  windowRole: identity.windowRole,
  projectPath: identity.projectPath,
  sceneId: identity.sceneId,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  project: {
    listRecent: (): Promise<ProjectSummary[]> => ipcRenderer.invoke(IPC_INVOKE.project.listRecent),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC_INVOKE.project.pickDirectory),
    create: (input): Promise<OpenProject> => ipcRenderer.invoke(IPC_INVOKE.project.create, input),
    open: (projectPath, sceneId): Promise<OpenProject> =>
      ipcRenderer.invoke(IPC_INVOKE.project.open, projectPath, sceneId),
    switchScene: (sceneId): Promise<boolean> =>
      ipcRenderer.invoke(IPC_INVOKE.project.switchScene, sceneId),
    openSceneWindow: (sceneId): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.project.openSceneWindow, sceneId),
    browseAndOpen: (): Promise<OpenProject | null> => ipcRenderer.invoke(IPC_INVOKE.project.browseAndOpen),
    launch: (projectPath): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.project.launch, projectPath),
    browseForProject: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_INVOKE.project.browseForProject),
    saveScene: (input): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.project.saveScene, input),
    readScene: (scenePath): Promise<string> =>
      ipcRenderer.invoke(IPC_INVOKE.project.readScene, scenePath),
    createScene: (name): Promise<SceneChange> => ipcRenderer.invoke(IPC_INVOKE.project.createScene, name),
    duplicateScene: (sceneId, name): Promise<SceneChange> =>
      ipcRenderer.invoke(IPC_INVOKE.project.duplicateScene, sceneId, name),
    renameScene: (sceneId, name): Promise<SceneChange> =>
      ipcRenderer.invoke(IPC_INVOKE.project.renameScene, sceneId, name),
    deleteScene: (sceneId): Promise<ProjectContents> =>
      ipcRenderer.invoke(IPC_INVOKE.project.deleteScene, sceneId),
    setStartScene: (sceneId): Promise<ProjectContents> =>
      ipcRenderer.invoke(IPC_INVOKE.project.setStartScene, sceneId),
    forget: (projectPath): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.project.forget, projectPath),
    close: (): Promise<void> => ipcRenderer.invoke(IPC_INVOKE.project.close),
    setDirty: (dirty): void => ipcRenderer.send(IPC_EVENTS.setDirty, dirty),
    updateSettings: (patch): Promise<ProjectFile> =>
      ipcRenderer.invoke(IPC_INVOKE.project.updateSettings, patch),
    onProjectChanged: (listener) => {
      const handler = (_event: unknown, contents: ProjectContents) => listener(contents);
      ipcRenderer.on(IPC_EVENTS.projectChanged, handler);
      return () => ipcRenderer.off(IPC_EVENTS.projectChanged, handler);
    },
  },
  assets: {
    list: (): Promise<AssetManifest> => ipcRenderer.invoke(IPC_INVOKE.assets.list),
    openImport: (sourcePaths, folder): Promise<ImportSessionState> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.openImport, sourcePaths, folder),
    browseAndOpenImport: (folder): Promise<ImportSessionState> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.browseAndOpenImport, folder),
    commitImport: (sessionId, plan): Promise<AssetImportResult> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.commitImport, sessionId, plan),
    cancelImport: (sessionId): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.cancelImport, sessionId),
    remove: (assetPath): Promise<AssetChange> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.remove, assetPath),
    move: (assetPath, targetFolder): Promise<AssetChange> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.move, assetPath, targetFolder),
    createFolder: (folder): Promise<AssetChange> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.createFolder, folder),
    renameFolder: (folder, name): Promise<AssetChange> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.renameFolder, folder, name),
    removeFolder: (folder): Promise<AssetChange> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.removeFolder, folder),
    updateSettings: (assetPath, settings): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.updateSettings, assetPath, settings),
    readMaterials: (): Promise<Record<string, MaterialDef>> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.readMaterials),
    createMaterial: (name, material): Promise<string> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.createMaterial, name, material),
    readPrefabs: (): Promise<Record<string, PrefabDoc>> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.readPrefabs),
    createPrefab: (name, prefab, assetId): Promise<string> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.createPrefab, name, prefab, assetId),
    saveMaterial: (assetPath, material): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.saveMaterial, assetPath, material),
    savePrefab: (assetPath, prefab): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.savePrefab, assetPath, prefab),
    revealInFileManager: (assetPath): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.assets.revealInFileManager, assetPath),
    pathForFile: (file): string => webUtils.getPathForFile(file),
  },
  scripts: {
    build: (): Promise<ScriptBuildResult> => ipcRenderer.invoke(IPC_INVOKE.scripts.build),
    create: (name): Promise<string> => ipcRenderer.invoke(IPC_INVOKE.scripts.create, name),
  },
  build: {
    export: (profileId): Promise<ExportResult> => ipcRenderer.invoke(IPC_INVOKE.build.export, profileId),
    chooseOutputDir: (startIn): Promise<string | null> =>
      ipcRenderer.invoke(IPC_INVOKE.build.chooseOutputDir, startIn),
    onProgress: (listener) => {
      const handler = (_event: unknown, progress: ExportProgress) => listener(progress);
      ipcRenderer.on(IPC_EVENTS.buildProgress, handler);
      return () => ipcRenderer.off(IPC_EVENTS.buildProgress, handler);
    },
    revealOutput: (outputDir): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.build.revealOutput, outputDir),
  },
  preferences: {
    loadLayouts: (): Promise<LayoutPreferences> => ipcRenderer.invoke(IPC_INVOKE.preferences.loadLayouts),
    saveLayouts: (preferences): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.preferences.saveLayouts, preferences),
    loadShortcuts: (): Promise<ShortcutPreferences> =>
      ipcRenderer.invoke(IPC_INVOKE.preferences.loadShortcuts),
    saveShortcuts: (preferences): Promise<void> =>
      ipcRenderer.invoke(IPC_INVOKE.preferences.saveShortcuts, preferences),
  },
};

contextBridge.exposeInMainWorld('studio', bridge);
