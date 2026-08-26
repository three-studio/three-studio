import { join } from 'node:path';
import { BrowserWindow, app, dialog, shell } from 'electron';
import type { WindowRole } from '@three-studio/core';
import { forgetWindow, isDirty } from './ipc';

/**
 * The windows, and the rules that move between them.
 *
 * A launcher that picks a project, and one editor window per open scene, rather
 * than one window switching views. Unity, Unreal and Godot all do this, and the
 * reason is not cosmetic: an editor window owns a GPU device, a physics world
 * and a dock layout, and destroying the window is the only teardown that cannot
 * be forgotten. The single-window design kept that renderer alive across project
 * switches, which made a leak in it permanent.
 *
 * **All editor windows share one project.** The main process serves the asset
 * protocol from a single root, so a second project would have to be a second
 * process; opening one closes the windows of the first, prompt by prompt.
 */

const isDev = !app.isPackaged;

/** One open scene, in one window. */
interface Editor {
  win: BrowserWindow;
  projectPath: string;
  /**
   * The scene it is showing, once its renderer has said which one.
   *
   * Null until then: a window opened without a scene lands on the project's
   * start scene, and only the renderer's `project:open` resolves which that is.
   * `noteScene` fills it in — it is what makes "open a scene that is already
   * open" focus a window rather than build a second one onto the same file.
   */
  sceneId: string | null;
  /** Captured at creation: `closed` fires after the webContents is gone. */
  contentsId: number;
  /** Set once the user has confirmed discarding this window's unsaved work. */
  allowClose: boolean;
}

let launcher: BrowserWindow | null = null;
const editors: Editor[] = [];
/** Set from `before-quit`, so a closing window does not reopen the launcher. */
let quitting = false;
/**
 * True while every editor window is being taken down to open another project.
 *
 * There is a moment with no window at all in the middle of that, because a
 * close may still be cancelled at the unsaved-changes prompt and so has to
 * finish before the replacement is built. Without this flag `window-all-closed`
 * would see that moment and quit the application half way through.
 */
let transitioning = false;

app.on('before-quit', () => {
  quitting = true;
});

/**
 * Says the application is leaving on purpose.
 *
 * `app.exit()` skips `before-quit`, so a deliberate exit still ran the close
 * handlers with `quitting` false — and every headless check ended by opening a
 * launcher window a few milliseconds before the process died. Harmless when the
 * process really does die, and a window left behind on a screen when it does
 * not.
 */
export function beginQuit(): void {
  quitting = true;
}

/** Whether the app is between projects; see `transitioning`. */
export function isTransitioning(): boolean {
  return transitioning;
}

/**
 * Says what happened to a window, in development.
 *
 * Window lifecycle is the one part of this application with no trace anywhere:
 * a window that closed itself and a window the tooling killed look identical,
 * and telling them apart by hand has already cost an afternoon. One line each
 * makes a log answer the question.
 */
function trace(what: string): void {
  if (isDev) console.log(`[windows] ${what} (editors: ${editors.length})`);
}

function editorFor(contents: Electron.WebContents): Editor | undefined {
  return editors.find((entry) => entry.contentsId === contents.id);
}

function editorShowing(sceneId: string): Editor | undefined {
  return editors.find((entry) => entry.sceneId === sceneId);
}

/**
 * True when a scene is open in a window other than the one asking.
 *
 * What stops one window deleting the scene another is editing: the file would
 * go, the window would stay, and its next save would write a scene back that
 * the project no longer lists — invisible in the editor and shipped by nothing.
 */
export function isSceneOpenElsewhere(from: Electron.WebContents, sceneId: string): boolean {
  const showing = editorShowing(sceneId);
  return showing !== undefined && showing.contentsId !== from.id;
}

/** Every editor window, for telling them all that the project has changed. */
export function editorWindows(): readonly BrowserWindow[] {
  return editors.map((entry) => entry.win);
}

/**
 * Records which scene a window settled on, from its own `project:open`.
 *
 * The main process cannot work it out: a window opened without a scene id
 * follows the project's start scene, and resolving that means reading the
 * project file the renderer has just read.
 */
export function noteScene(contents: Electron.WebContents, sceneId: string): void {
  const entry = editorFor(contents);
  if (entry) entry.sceneId = sceneId;
}

interface WindowOptions {
  role: WindowRole;
  projectPath?: string;
  /** Id of the scene the window opens on; see `sceneQuery`. */
  sceneId?: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable?: boolean;
}

/**
 * The scene travels in the URL, while the role and the project travel in argv.
 *
 * `webContents.reload()` replays the same `additionalArguments`, so argv can
 * only carry what is fixed for the life of the window. Role and project are;
 * the scene is exactly the thing that changes. A query string survives a reload
 * and can be replaced without one — see ADR-12 and ADR-14.
 */
function sceneQuery(sceneId: string | undefined): Record<string, string> {
  return sceneId === undefined ? {} : { scene: sceneId };
}

function loadShell(win: BrowserWindow, sceneId: string | undefined): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const query = new URLSearchParams(sceneQuery(sceneId)).toString();

  if (isDev && devServerUrl) {
    void win.loadURL(query === '' ? devServerUrl : `${devServerUrl}?${query}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: sceneQuery(sceneId),
    });
  }
}

function createWindow(options: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    resizable: options.resizable ?? true,
    show: false,
    backgroundColor: '#1b1b1b',
    autoHideMenuBar: true,
    // The editor draws its own menu bar, so the native chrome is reduced to the
    // traffic lights on macOS.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Editor state is worthless if the GPU process throttles in the background
      // while a build or a bake is running.
      backgroundThrottling: false,
      // Read by the preload before the first render; see `WindowRole`.
      additionalArguments: [
        `--studio-role=${options.role}`,
        ...(options.projectPath === undefined ? [] : [`--studio-project=${options.projectPath}`]),
      ],
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    // Renderer logs are invisible from the terminal otherwise, which makes
    // "the window is blank" impossible to diagnose without opening devtools.
    win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
      console.log(`[renderer:${level}] ${message}  (${sourceId}:${lineNumber})`);
    });
    win.webContents.on('did-fail-load', (_e, code, description, url) => {
      console.error(`[renderer] failed to load ${url}: ${description} (${code})`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] process gone:', details.reason);
    });
  }

  // Nothing in this app should navigate away or open a window: project assets
  // and user scripts are served through dedicated custom protocols instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  loadShell(win, options.sceneId);
  return win;
}

export function openLauncher(): BrowserWindow {
  if (launcher) {
    launcher.focus();
    return launcher;
  }

  const win = createWindow({
    role: 'launcher',
    width: 940,
    height: 600,
    minWidth: 860,
    minHeight: 560,
    // A picker has one job and one good size. Letting it be stretched only ever
    // produces a worse version of itself.
    resizable: false,
  });
  launcher = win;

  trace('launcher opened');

  win.on('closed', () => {
    launcher = null;
    trace('launcher closed');
    // Closing the picker quits, on every platform including macOS, where the
    // convention would be to stay resident. Asked for explicitly: there is
    // nothing left to come back to, and an app with no window and no dock menu
    // reads as a hang.
    if (editors.length === 0 && !quitting && !transitioning) app.quit();
  });

  return win;
}

/**
 * Opens a project, on one scene, in one window.
 *
 * Three cases, and they are what makes a set of windows behave like a set
 * rather than a pile: the scene is already open somewhere, so focus it; another
 * project is open, so take its windows down first; or there is a window to
 * build.
 */
export function openEditor(projectPath: string, sceneId?: string): BrowserWindow | null {
  const open = editors[0];

  if (open?.projectPath === projectPath) {
    // The same project. Never a second window onto the same scene: two
    // documents over one file means whichever saves last silently wins.
    const showing = sceneId === undefined ? open : editorShowing(sceneId);
    if (showing) {
      showing.win.focus();
      return showing.win;
    }
  } else if (open) {
    // Another project. Every window has to go, and any of them may still say
    // no at its unsaved-changes prompt — so nothing is built until they have
    // all actually gone.
    if (!closeAllEditors()) return null;
  }

  return createEditor(projectPath, sceneId);
}

/**
 * Opens a scene of the project already open, in a window of its own.
 *
 * What "Open in New Window" reaches. Focuses the window that has it rather than
 * building a second one onto the same file.
 */
export function openSceneWindow(sceneId: string): BrowserWindow | null {
  const open = editors[0];
  if (!open) return null;

  const showing = editorShowing(sceneId);
  if (showing) {
    showing.win.focus();
    return showing.win;
  }
  return createEditor(open.projectPath, sceneId);
}

function createEditor(projectPath: string, sceneId?: string): BrowserWindow {
  const win = createWindow({
    role: 'editor',
    projectPath,
    sceneId,
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 680,
  });
  // Captured now: `closed` fires after the webContents is gone, and the
  // unsaved-state table has to be purged by the id it was filled under.
  const entry: Editor = {
    win,
    projectPath,
    sceneId: sceneId ?? null,
    contentsId: win.webContents.id,
    allowClose: false,
  };
  editors.push(entry);

  // Offset from the window it was opened beside, so a second scene does not
  // land exactly on top of the first and look like nothing happened.
  const beside = editors.at(-2)?.win.getBounds();
  if (beside) win.setPosition(beside.x + 32, beside.y + 32);
  trace(`editor opened on ${sceneId ?? 'the start scene'}`);

  win.on('close', (event) => {
    if (entry.allowClose || !isDirty(entry.contentsId) || process.env['STUDIO_SMOKE']) return;
    event.preventDefault();

    if (confirmDiscard(win, 'Closing now discards them.')) {
      entry.allowClose = true;
      win.close();
    }
  });

  win.on('closed', () => {
    const index = editors.indexOf(entry);
    if (index >= 0) editors.splice(index, 1);
    forgetWindow(entry.contentsId);
    trace(`editor closed on ${entry.sceneId ?? 'the start scene'}`);

    // Back to the picker rather than out of the app: closing the last scene is
    // leaving the project, not leaving the editor. Not during a project switch,
    // which builds its own window once every old one has gone.
    if (editors.length === 0 && !quitting && !transitioning) openLauncher();
  });

  launcher?.close();
  return win;
}

/** @returns `false` when a window said no at its unsaved-changes prompt. */
function closeAllEditors(): boolean {
  transitioning = true;
  try {
    for (const entry of [...editors]) {
      entry.win.close();
      // Still here: cancelled. Everything already closed stays closed — the
      // alternative is reopening windows the user has watched disappear.
      if (!entry.win.isDestroyed()) return false;
    }
    return true;
  } finally {
    transitioning = false;
  }
}

/**
 * Points a window at another scene by reloading it.
 *
 * A reload rather than a swap inside the running renderer: that path is
 * `replaceScene`, which is what prefab mode and leaving Play already use, and
 * it carries two open bugs — the unsaved flag is overwritten and the undo
 * history is destroyed. A reload gives a fresh document, a fresh history and a
 * teardown nobody can forget to write. See ADR-12; the cost is about a second
 * of empty window, and it is accepted.
 *
 * @param from The window asking. With several open, "the editor" is not a
 *   thing — the one that asked is the one that moves.
 * @returns `false` when the user cancelled at the unsaved-changes prompt.
 */
export function switchScene(from: Electron.WebContents, sceneId: string): boolean {
  const entry = editorFor(from);
  if (!entry) return false;

  // Already open elsewhere: bring that window forward rather than show one
  // scene in two windows, which is the same file edited twice.
  const showing = editorShowing(sceneId);
  if (showing && showing !== entry) {
    showing.win.focus();
    return true;
  }

  if (isDirty(entry.contentsId) && !process.env['STUDIO_SMOKE']) {
    if (!confirmDiscard(entry.win, 'Opening another scene now discards them.')) return false;
  }

  // The window keeps its unsaved flag until the new renderer reports one of its
  // own, and the old value would then guard a document that no longer exists.
  forgetWindow(entry.contentsId);
  entry.sceneId = sceneId;
  loadShell(entry.win, sceneId);
  return true;
}

/** The one prompt that stands between unsaved work and losing it. */
function confirmDiscard(win: BrowserWindow, detail: string): boolean {
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Cancel', 'Discard Changes'],
    defaultId: 0,
    cancelId: 0,
    message: 'This scene has unsaved changes.',
    detail,
  });
  return choice === 1;
}
