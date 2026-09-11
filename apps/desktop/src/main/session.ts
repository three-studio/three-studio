/*
 * What the main process remembers between calls.
 *
 * Three facts, and they are together because they have the same lifetime — the
 * run of the app — and because more than one module reads each of them. They
 * lived in `ipc.ts` as a `let`, a `Map` and a `Set`, which put them behind an
 * `import { ipcMain } from 'electron'`: nothing could exercise the rules
 * without an Electron process to host them, so nothing did.
 *
 * Named for the app's session, not the import dialog's — `ImportSession` is a
 * buffer over one drop of files and lives in `import/`.
 */

/*
 * ---------------------------------------------------------- the open project
 */

/**
 * The project the renderer is working in, held here rather than passed on
 * every call.
 *
 * A request that could name its own root would be a way around the project
 * sandbox: every path the renderer sends is proved to be inside *this*, and a
 * renderer that chose it would be proving nothing. It was also held a second
 * time by the asset protocol handler, kept in step by hand — one fact, two
 * copies, and the failure of them disagreeing is either an asset that will not
 * load or a scheme still serving a project that has been closed.
 */
let openProjectPath: string | null = null;

/** Called when a project is opened, in whichever window opened it. */
export function adoptProject(projectPath: string): void {
  openProjectPath = projectPath;
}

export function releaseProject(): void {
  openProjectPath = null;
}

/** The open project, or `null`. For a caller that has an answer for `null`. */
export function currentProject(): string | null {
  return openProjectPath;
}

/** The open project, or a refusal. For everything the renderer can reach. */
export function requireProject(): string {
  if (openProjectPath === null) throw new Error('No project is open.');
  return openProjectPath;
}

/*
 * ------------------------------------------------------ unsaved work, per window
 */

/**
 * Which windows hold work that is not on disk, so the close guard warns about
 * the right one.
 *
 * A single boolean was enough while there was one editor window. With two, it
 * names whichever renderer spoke last: the close guard would throw away another
 * window's work, or block this one over a document it does not hold. Keyed by
 * `webContents.id` and purged when the window goes.
 */
const unsavedByWindow = new Map<number, boolean>();

export function setDirty(windowId: number, dirty: boolean): void {
  unsavedByWindow.set(windowId, dirty);
}

export function isDirty(windowId: number): boolean {
  return unsavedByWindow.get(windowId) === true;
}

/** Called when a window is gone, or reloaded onto another scene. */
export function forgetWindow(windowId: number): void {
  unsavedByWindow.delete(windowId);
}

/*
 * -------------------------------------------- folders this session produced
 */

/**
 * The build outputs this run wrote, and the whole of what makes "reveal the
 * output folder" safe.
 *
 * The renderer naming a path and the main process opening it in the file
 * manager is a hole; naming one it was handed back a moment ago is not. A
 * capability token, in the shape a `Set` already is.
 */
const exportedDirs = new Set<string>();

export function noteExport(directory: string): void {
  exportedDirs.add(directory);
}

export function wasExported(directory: string): boolean {
  return exportedDirs.has(directory);
}
