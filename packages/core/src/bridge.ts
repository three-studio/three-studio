import type { AssetImportResult, AssetManifest, AssetSettings } from './assets/schema';
import type { ImportPlanItem, ImportSessionState } from './assets/import/session';
import type { LayoutPreferences } from './preferences/schema';
import type {
  OpenProject,
  ProjectFile,
  ProjectSettings,
  ProjectSummary,
  SceneEntry,
} from './project/schema';
import type { PrefabDoc } from './scene/prefab';
import type { MaterialDef } from './scene/schema';

/**
 * Contract for the Electron preload bridge.
 *
 * Lives in @three-studio/core so the preload script and the editor UI compile against
 * exactly the same shape. It is types only — no runtime code crosses here.
 *
 * The surface stays deliberately small: the renderer is sandboxed with no file
 * system access, and every method added here widens what a malicious project
 * file or user script could reach.
 */
export type Platform = 'darwin' | 'win32' | 'linux';

/**
 * Which of the two windows this renderer is.
 *
 * The launcher picks a project; the editor edits one. They are separate windows
 * rather than two views of the same one, so the role has to arrive before React
 * mounts — it comes through the preload's `process.argv`, not over IPC, because
 * a round trip would render the wrong shell for a frame.
 */
export type WindowRole = 'launcher' | 'editor';

/**
 * What a call that changed the scene registry hands back.
 *
 * The project as well as the path: every one of them rewrites `project.json`,
 * and the window showing it has to see the result without a second round trip
 * during which the two disagree.
 */
export interface SceneChange {
  project: ProjectFile;
  /** The scene the call produced or changed. */
  scene: SceneEntry;
}

export interface ProjectApi {
  /**
   * Opens a project in the editor window, and closes the launcher.
   *
   * The launcher does not open the project itself: the window that will edit it
   * does, once it exists. Reading a project into a renderer that is about to be
   * destroyed would be work thrown away, and would leave the main process
   * serving assets for a project nobody has open.
   */
  launch: (projectPath: string) => Promise<void>;
  /**
   * Native picker for a project folder. Resolves `null` when dismissed.
   *
   * Distinct from `browseAndOpen`, which also opens what it picked: the
   * launcher only needs the path, and hands it to `launch`.
   */
  browseForProject: () => Promise<string | null>;
  listRecent: () => Promise<ProjectSummary[]>;
  /** Native directory picker. Resolves `null` when the user cancels. */
  pickDirectory: () => Promise<string | null>;
  create: (input: { name: string; directory: string }) => Promise<OpenProject>;
  /** @param sceneId A scene of the project, instead of its start scene. */
  open: (projectPath: string, sceneId?: string | null) => Promise<OpenProject>;
  /**
   * Reloads this window on another scene, unsaved-changes prompt included.
   *
   * Resolves `false` when the user cancelled at that prompt. A reload rather
   * than a swap in place: see ADR-12, and `switchScene` in `windows.ts`.
   */
  switchScene: (sceneId: string) => Promise<boolean>;
  /**
   * Opens a scene of this project in a window of its own.
   *
   * Focuses the window that already has it rather than showing one scene
   * twice: two documents over one file means whichever saves last wins.
   */
  openSceneWindow: (sceneId: string) => Promise<void>;
  /** Native file picker scoped to project files, then opens it. */
  browseAndOpen: () => Promise<OpenProject | null>;
  saveScene: (input: {
    projectPath: string;
    scenePath: string;
    contents: string;
  }) => Promise<void>;
  /** Reads a scene of the open project, for a game moving to the next one. */
  readScene: (scenePath: string) => Promise<string>;

  /*
   * The scene registry. Every one of these writes `project.json` and the files
   * on disk together, which is why none of it happens in the renderer: a scene
   * added to the list but never written, or written but never listed, is a
   * project that fails to open later rather than now.
   *
   * Names are unique within a project and are what a script addresses, so a
   * name already taken is refused rather than made unique — see `sceneName`.
   */
  /** Creates an empty scene with the root `Scene` entity. */
  createScene: (name: string) => Promise<SceneChange>;
  /** Copies a scene under a new name, with its own document id. */
  duplicateScene: (sceneId: string, name: string) => Promise<SceneChange>;
  /** Changes the label. Moves no file and rewrites no reference; see ADR-15. */
  renameScene: (sceneId: string, name: string) => Promise<SceneChange>;
  /** Refused for the last scene: a project without one cannot be opened. */
  deleteScene: (sceneId: string) => Promise<ProjectFile>;
  setStartScene: (sceneId: string) => Promise<ProjectFile>;
  /** Drops a project from the recents list without touching the files. */
  forget: (projectPath: string) => Promise<void>;
  /** Clears the main process's notion of the open project. */
  close: () => Promise<void>;
  /** Lets the main process warn before closing with unsaved work. */
  setDirty: (dirty: boolean) => void;
  /**
   * Merges a patch into the project's settings and returns the saved file.
   *
   * A patch rather than the whole object: a dialog holds a copy from the
   * moment it opened, and an export running behind it writes the folder it
   * used into the same file. Sending the whole thing back would undo that.
   */
  updateSettings: (patch: Partial<ProjectSettings>) => Promise<ProjectFile>;
  /**
   * Fires when another window changed the project file. Returns an unsubscribe.
   *
   * Every window holds a copy of the project, taken when it opened. Without
   * this, a scene created, renamed or deleted in one window is invisible in
   * every other one — a stale scene menu, and a title showing a name nobody
   * uses any more.
   */
  onProjectChanged: (listener: (project: ProjectFile) => void) => () => void;
}

export interface BuildApi {
  /**
   * Produces a build from a saved profile, into the folder that profile names.
   *
   * The destination is part of the profile rather than something asked for at
   * the last moment: a build should be reproducible from what is on disk, and
   * the dialog should say where the files are going before it goes there.
   */
  export: (profileId?: string) => Promise<ExportResult>;
  /** Native folder picker. `null` when dismissed. */
  chooseOutputDir: (startIn?: string | null) => Promise<string | null>;
  /** Phase updates while an export runs. Returns an unsubscribe. */
  onProgress: (listener: (progress: ExportProgress) => void) => () => void;
  /**
   * Opens a finished build in the OS file browser.
   *
   * Only a folder this session has exported to: the renderer must not be able
   * to name an arbitrary path and have the main process open it.
   */
  revealOutput: (outputDir: string) => Promise<void>;
}

export interface ExportProgress {
  /** `0..1`. */
  fraction: number;
  step: string;
}

export interface ExportResult {
  outputDir: string;
  sceneCount: number;
  assetCount: number;
  scriptCount: number;
  /** Non-fatal: assets a scene references that are no longer in the project. */
  warnings: string[];
}

export interface AssetApi {
  /** Rebuilt by scanning `assets/`; the sidecars are the source of truth. */
  list: () => Promise<AssetManifest>;
  /**
   * Reads what was dropped and stages it, **without writing anything**.
   *
   * The first half of every import. Folders are walked, each file is matched to
   * an importer, hashed and checked against what the project already has, and
   * the result is held in memory until `commitImport` or `cancelImport`.
   */
  openImport: (
    sourcePaths: readonly string[],
    folder?: string,
  ) => Promise<ImportSessionState>;
  /** Native file picker, then the same staging. */
  browseAndOpenImport: (folder?: string) => Promise<ImportSessionState>;
  /** Copies the staged files in and writes their sidecars. Ends the session. */
  commitImport: (
    sessionId: string,
    plan: readonly ImportPlanItem[],
  ) => Promise<AssetImportResult>;
  /** Drops the session. Nothing was written, so there is nothing to undo. */
  cancelImport: (sessionId: string) => Promise<void>;
  /** Deletes the file and its sidecar. Takes a project-relative path. */
  remove: (assetPath: string) => Promise<void>;
  /** Moves an asset and its sidecar; returns the new project-relative path. */
  move: (assetPath: string, targetFolder: string) => Promise<string>;
  /** Creates a folder under `assets/`; returns the path it actually got. */
  createFolder: (folder: string) => Promise<string>;
  /**
   * Renames a folder under `assets/`; returns its new path.
   *
   * Safe for references: ids live in the sidecars, which move with their files.
   */
  renameFolder: (folder: string, name: string) => Promise<string>;
  /** Removes a folder under `assets/`. Rejects one that is not empty. */
  removeFolder: (folder: string) => Promise<void>;
  updateSettings: (assetPath: string, settings: AssetSettings) => Promise<void>;
  /**
   * Every preset material in the project, by asset id.
   *
   * Read in one go rather than per reference: the binder builds a mesh
   * synchronously, so a material it has to await would render untextured for a
   * frame. They are a few hundred bytes each.
   */
  readMaterials: () => Promise<Record<string, MaterialDef>>;
  /** Writes a new material asset and returns its id. */
  createMaterial: (name: string, material: MaterialDef) => Promise<string>;
  /** Every prefab in the project, by asset id. Read in one go, like materials. */
  readPrefabs: () => Promise<Record<string, PrefabDoc>>;
  /** Writes a new prefab asset and returns its id. */
  createPrefab: (name: string, prefab: PrefabDoc, assetId?: string) => Promise<string>;
  /** Overwrites an existing material asset, by project-relative path. */
  saveMaterial: (assetPath: string, material: MaterialDef) => Promise<void>;
  savePrefab: (assetPath: string, prefab: PrefabDoc) => Promise<void>;
  /** Opens the containing folder in the OS file browser. */
  revealInFileManager: (assetPath: string) => Promise<void>;
  /**
   * Absolute path of a dropped `File`.
   *
   * `File.path` was removed from Electron's renderer; this is the supported
   * replacement and the only way an OS drag-and-drop can name a real file.
   */
  pathForFile: (file: File) => string;
}

export interface ScriptBuildResult {
  /** ES module source, imported by the renderer as a blob. */
  code: string;
  errors: string[];
  warnings: string[];
  scriptCount: number;
  /**
   * No script source changed since the last build, so the classes already
   * registered still match the code on disk and need not be re-imported.
   */
  unchanged?: boolean;
}

export interface ScriptApi {
  /** Compiles every script in the project into one module. */
  build: () => Promise<ScriptBuildResult>;
  /** Creates a script file from a template and returns its asset path. */
  create: (name: string) => Promise<string>;
}

export interface PreferencesApi {
  /** Window layouts, stored in the app's data directory. */
  loadLayouts: () => Promise<LayoutPreferences>;
  saveLayouts: (preferences: LayoutPreferences) => Promise<void>;
}

export interface StudioBridge {
  readonly platform: Platform;
  /** Which window this is. Known before the first render; see `WindowRole`. */
  readonly windowRole: WindowRole;
  /** The project this window edits. Always null in the launcher. */
  readonly projectPath: string | null;
  /**
   * Id of the scene this window opens on, from the URL rather than from argv.
   *
   * Null falls back to the project's start scene. It is in the URL because
   * `reload()` replays argv verbatim, and the scene is the one thing about an
   * editor window that changes — see ADR-12. An id rather than a path so that
   * renaming a scene cannot invalidate an open window — ADR-15.
   */
  readonly sceneId: string | null;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
  readonly project: ProjectApi;
  readonly assets: AssetApi;
  readonly scripts: ScriptApi;
  readonly build: BuildApi;
  readonly preferences: PreferencesApi;
}

declare global {
  interface Window {
    readonly studio: StudioBridge;
  }
}
