import type { AssetImportResult, AssetKind, AssetManifest, AssetSettings } from './assets/schema';
import type { ImportPlanItem, ImportSessionState } from './assets/import/session';
import type { LayoutPreferences, ShortcutPreferences } from './preferences/schema';
import type {
  OpenProject,
  ProjectContents,
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
 * What a call that changed the scenes of a project hands back.
 *
 * The whole list as well as the one scene: the list is the `scenes/` directory
 * now, which a renderer cannot read, so a window learns what its own write did
 * to the project the same way it learns what another window's did.
 */
export interface SceneChange extends ProjectContents {
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
   * than a swap in place: see `switchScene` in `windows.ts`.
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
   * The five things that can be done to the scenes of a project. None of it
   * happens in the renderer, because all of it is file operations under
   * `scenes/` — and that directory is the list, so a renderer that could write
   * there could add a scene to a project it cannot read.
   *
   * Names are unique within a project and are what a script addresses, so a
   * name already taken is refused rather than made unique — see `sceneName`.
   */
  /** Creates an empty scene with the root `Scene` entity. */
  createScene: (name: string) => Promise<SceneChange>;
  /** Copies a scene under a new name, with its own document id. */
  duplicateScene: (sceneId: string, name: string) => Promise<SceneChange>;
  /**
   * Renames a scene, which moves its file: the file name is the name.
   *
   * Rewrites no reference — those are ids — but the window showing
   * the scene has to take the new path out of the result, or its next save
   * would write the file back under the name it had.
   */
  renameScene: (sceneId: string, name: string) => Promise<SceneChange>;
  /** Refused for the last scene: a project without one cannot be opened. */
  deleteScene: (sceneId: string) => Promise<ProjectContents>;
  setStartScene: (sceneId: string) => Promise<ProjectContents>;
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
   * Fires when another window changed the project. Returns an unsubscribe.
   *
   * Every window holds a copy of the project and of its scene list, taken when
   * it opened. Without this, a scene created, renamed or deleted in one window
   * is invisible in every other one — a stale scene menu, and a title showing a
   * name nobody uses any more.
   */
  onProjectChanged: (listener: (contents: ProjectContents) => void) => () => void;
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

/**
 * What a build weighs, in bytes, and where the weight is.
 *
 * The first thing an author looks at after an export, and the one thing the
 * result could not answer: it counted scenes, assets and scripts, and never
 * counted bytes.
 *
 * Every file the export wrote falls in exactly one row, so the parts sum to
 * `total`. That is what makes a breakdown worth reading — a set of numbers that
 * nearly add up sends the reader looking for the rest.
 */
export interface BuildSize {
  /**
   * Every byte the export wrote, minus the list of what it wrote: that one is
   * written last and cannot appear in its own list. See `files.json`.
   */
  total: number;
  /**
   * The page, the engine bundle and the build's own manifest — what a build
   * carries whatever is in it.
   *
   * Also where anything the rows below do not claim lands, so the parts always
   * sum to the total rather than nearly summing to it.
   */
  player: number;
  scenes: number;
  /** The compiled behaviour bundle. */
  scripts: number;
  /**
   * What shipped out of `assets/`, by kind rather than by the three that
   * usually matter. Read off the importers' own directories, so a kind added
   * there arrives here with nothing to edit.
   */
  assets: Record<AssetKind, number>;
}

export interface ExportResult {
  outputDir: string;
  sceneCount: number;
  assetCount: number;
  scriptCount: number;
  size: BuildSize;
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
  /** Remapped key bindings, stored beside the layouts. */
  loadShortcuts: () => Promise<ShortcutPreferences>;
  saveShortcuts: (preferences: ShortcutPreferences) => Promise<void>;
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
   * editor window that changes. An id rather than a path so that
   * renaming a scene cannot invalidate an open window.
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

/*
 * The wiring, derived from the type above.
 *
 * The *type* of the bridge has always been here, and the file says why. The
 * wiring was not: forty-seven channel names were string literals written twice,
 * once in `ipc.ts` and once in the preload, and nothing tied a handler's
 * signature to the member it answers for. A typo was `No handler registered` at
 * run time rather than a red squiggle, and neither side could tell you that a
 * member had no handler at all.
 *
 * What follows is three small mapped types and one table. The table is the only
 * place a channel name is written; the mapped types are what make a missing
 * handler a compile error in `ipc.ts`.
 */

/**
 * The members of a namespace that cross as a call and a reply.
 *
 * Everything returning a promise. The four that do not are deliberate and each
 * has its reason: `setDirty` is fire-and-forget, `onProjectChanged` and
 * `onProgress` are subscriptions, and `pathForFile` never leaves the renderer —
 * `webUtils.getPathForFile` is synchronous and local.
 */
type Invocable<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: T[K];
};

/**
 * The bridge's namespaces: everything on it that is not one of the five values.
 *
 * Named as an exclusion rather than as a shape, and that is not a taste. An
 * `interface` has no implicit index signature, so `ProjectApi extends
 * Record<string, …>` is **false** — the obvious filter selects nothing, every
 * mapped type below collapses to `{}`, and every check in this file passes
 * vacuously. It was written that way first and caught by deleting a channel and
 * watching the build stay green.
 *
 * Excluding instead means a member added to `StudioBridge` is assumed to be an
 * API until someone says otherwise, and does not compile until it has channels
 * and a handler. That is the direction to fail in.
 */
type ApiGroups = Omit<
  StudioBridge,
  'platform' | 'windowRole' | 'projectPath' | 'sceneId' | 'versions'
>;

/** One channel name per invocable member, and the compiler counts them. */
export type InvokeChannels = {
  [G in keyof ApiGroups]: { [M in keyof Invocable<ApiGroups[G]>]: string };
};

/**
 * Every request/reply channel, once.
 *
 * `satisfies` rather than an annotation so the literal strings survive for a
 * reader, while the check stays total: a member added to an API above does not
 * compile until it has a channel here, and a channel here that names no member
 * does not compile either.
 *
 * The names are not derived from the members — `revealInFileManager` answers on
 * `assets:reveal` — because they are a wire format. Renaming a method should
 * not be able to rename a channel by accident.
 */
export const IPC_INVOKE = {
  project: {
    listRecent: 'project:listRecent',
    pickDirectory: 'project:pickDirectory',
    create: 'project:create',
    open: 'project:open',
    switchScene: 'project:switchScene',
    openSceneWindow: 'project:openSceneWindow',
    browseAndOpen: 'project:browseAndOpen',
    launch: 'project:launch',
    browseForProject: 'project:browseForProject',
    saveScene: 'project:saveScene',
    readScene: 'project:readScene',
    createScene: 'project:createScene',
    duplicateScene: 'project:duplicateScene',
    renameScene: 'project:renameScene',
    deleteScene: 'project:deleteScene',
    setStartScene: 'project:setStartScene',
    forget: 'project:forget',
    close: 'project:close',
    updateSettings: 'project:updateSettings',
  },
  assets: {
    list: 'assets:list',
    openImport: 'assets:openImport',
    browseAndOpenImport: 'assets:browseAndOpenImport',
    commitImport: 'assets:commitImport',
    cancelImport: 'assets:cancelImport',
    remove: 'assets:remove',
    move: 'assets:move',
    createFolder: 'assets:createFolder',
    renameFolder: 'assets:renameFolder',
    removeFolder: 'assets:removeFolder',
    updateSettings: 'assets:updateSettings',
    readMaterials: 'assets:readMaterials',
    createMaterial: 'assets:createMaterial',
    readPrefabs: 'assets:readPrefabs',
    createPrefab: 'assets:createPrefab',
    saveMaterial: 'assets:saveMaterial',
    savePrefab: 'assets:savePrefab',
    revealInFileManager: 'assets:reveal',
  },
  scripts: {
    build: 'scripts:build',
    create: 'scripts:create',
  },
  build: {
    export: 'build:export',
    chooseOutputDir: 'build:chooseOutputDir',
    revealOutput: 'build:revealOutput',
  },
  preferences: {
    loadLayouts: 'prefs:loadLayouts',
    saveLayouts: 'prefs:saveLayouts',
    loadShortcuts: 'prefs:loadShortcuts',
    saveShortcuts: 'prefs:saveShortcuts',
  },
} as const satisfies InvokeChannels;

/**
 * The three channels that are not a call and a reply.
 *
 * Two are the main process talking first — a project that changed under another
 * window, and an export reporting progress — and one is the renderer telling
 * and not asking. They are listed rather than derived because there are three
 * of them and no shape to derive from.
 */
export const IPC_EVENTS = {
  projectChanged: 'project:changed',
  buildProgress: 'build:progress',
  setDirty: 'project:setDirty',
} as const;

/**
 * What the main process must provide, one function per invocable member.
 *
 * Total: leave one out and this does not compile; add a member to an API above
 * and this does not compile until it has a handler. The event comes first
 * because a handler often needs to know which window asked — which scene to
 * switch, which dialog to parent — and `ipcMain.handle` hands it over anyway.
 *
 * `Event` is a parameter so that `core` names no Electron type. It is
 * `IpcMainInvokeEvent` at the one call site.
 */
export type BridgeHandlers<Event> = {
  [G in keyof ApiGroups]: {
    [M in keyof Invocable<ApiGroups[G]>]: Handler<Invocable<ApiGroups[G]>[M], Event>;
  };
};

/** A handler may answer a promise or the value itself; `ipcMain` awaits either. */
type Handler<F, Event> = F extends (...args: infer A) => infer R
  ? (event: Event, ...args: A) => R | Awaited<R>
  : never;

declare global {
  interface Window {
    readonly studio: StudioBridge;
  }
}
