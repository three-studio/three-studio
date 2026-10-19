/*
 * What the windows do, decided apart from doing it.
 *
 * `windows.ts` is all policy and it had no test, because every rule in it was
 * written inside a `BrowserWindow` callback: focusing the window that already
 * shows a scene, going back to the picker when the last editor closes but not
 * while a project switch is half done, reloading a window onto another scene.
 * None of that needs a window — it needs the list of them, which is data.
 *
 * So the rules take that list and answer with a plan, and `windows.ts` is what
 * carries the plan out. The plan hands back the caller's own entry rather than
 * an id to look up again, which is why every function here is generic: a test
 * passes three fields, and `windows.ts` gets its `Editor` back with its window
 * still attached.
 */

/** One open scene, as the rules need to see it: an `Editor` without its window. */
export interface OpenScene {
  projectPath: string;
  /** `null` until the renderer reports which scene it settled on. */
  sceneId: string | null;
  contentsId: number;
}

function showing<T extends OpenScene>(editors: readonly T[], sceneId: string): T | undefined {
  return editors.find((entry) => entry.sceneId === sceneId);
}

/**
 * True when a scene is open in a window other than the one asking.
 *
 * What stops one window deleting the scene another is editing: the file would
 * go, the window would stay, and its next save would write a scene back that
 * the project no longer lists — invisible in the editor and shipped by nothing.
 */
export function isSceneOpenElsewhere(
  editors: readonly OpenScene[],
  fromId: number,
  sceneId: string,
): boolean {
  const open = showing(editors, sceneId);
  return open !== undefined && open.contentsId !== fromId;
}

/**
 * What opening a project comes to.
 *
 * `replace` is the case that costs something: all editor windows share one
 * project, because the main process serves the asset protocol from a single
 * root. Another project means every window goes first, and any of them may
 * still say no at its unsaved-changes prompt — so `replace` is a decision to
 * try, not a promise that it worked.
 */
export type OpenPlan<T> =
  | { do: 'focus'; entry: T }
  | { do: 'build' }
  | { do: 'replace' };

export function planOpenEditor<T extends OpenScene>(
  editors: readonly T[],
  projectPath: string,
  sceneId?: string,
): OpenPlan<T> {
  const open = editors[0];
  if (open === undefined) return { do: 'build' };
  if (open.projectPath !== projectPath) return { do: 'replace' };

  // The same project. Never a second window onto the same scene: two documents
  // over one file means whichever saves last silently wins. With no scene named
  // there is nothing to look up — the project is already open, so the window
  // that has it is the answer.
  const already = sceneId === undefined ? open : showing(editors, sceneId);
  return already ? { do: 'focus', entry: already } : { do: 'build' };
}

/**
 * What "Open in New Window" comes to.
 *
 * `nothing` when no project is open: this is reached from inside an editor, so
 * there is no project to name and nothing to open a second window onto.
 */
export type ScenePlan<T> =
  | { do: 'focus'; entry: T }
  | { do: 'build'; projectPath: string }
  | { do: 'nothing' };

export function planSceneWindow<T extends OpenScene>(
  editors: readonly T[],
  sceneId: string,
): ScenePlan<T> {
  const open = editors[0];
  if (open === undefined) return { do: 'nothing' };

  const already = showing(editors, sceneId);
  return already ? { do: 'focus', entry: already } : { do: 'build', projectPath: open.projectPath };
}

/**
 * What pointing a window at another scene comes to.
 *
 * `nothing` for a window this list does not know, which is a message from a
 * renderer whose window has already gone. `focus` when another window has that
 * scene — one file edited in two documents is the failure this exists to
 * prevent, and it is worth more than honouring the request literally. A window
 * asked to switch to the scene it is already on reloads, which is what
 * "reload this scene" would mean anyway.
 */
export type SwitchPlan<T> = { do: 'focus'; entry: T } | { do: 'reload'; entry: T } | { do: 'nothing' };

export function planSwitchScene<T extends OpenScene>(
  editors: readonly T[],
  fromId: number,
  sceneId: string,
): SwitchPlan<T> {
  const entry = editors.find((candidate) => candidate.contentsId === fromId);
  if (entry === undefined) return { do: 'nothing' };

  const already = showing(editors, sceneId);
  if (already && already.contentsId !== entry.contentsId) return { do: 'focus', entry: already };
  return { do: 'reload', entry };
}

/**
 * True when no editor is left and nothing is on its way to make one.
 *
 * One condition, two consequences, and that is why it is named once: the last
 * editor closing answers it by opening the picker — closing the last scene is
 * leaving the project, not leaving the editor — and the picker closing answers
 * it by quitting, because there is nothing left to come back to.
 *
 * Both flags are exclusions, and both were bugs before they were flags. A quit
 * already under way would otherwise open a window a few milliseconds before the
 * process died; a project switch has a moment with no window at all in the
 * middle of it, because a close may still be cancelled and so has to finish
 * before the replacement is built.
 */
export function leftWithNothing(
  editorCount: number,
  flags: { quitting: boolean; transitioning: boolean },
): boolean {
  return editorCount === 0 && !flags.quitting && !flags.transitioning;
}

/** A window's place on screen, in points, as Electron gives bounds and work areas. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a window opened beside another goes: one step down and to the right,
 * so a second scene does not land exactly on the first and look like nothing
 * happened.
 *
 * No larger than what the screen has left from there. An editor window asks
 * for more than a laptop's screen holds, so the first one fills it, and the
 * system puts a window that does not fit back on the screen: on a 1512×949
 * work area the second came out exactly over the first, the one thing the
 * step is for. Back at the work area's corner, at the size beside, once a step
 * would leave less than the window's minimum — a cascade cannot go on for ever.
 *
 * @param area The work area of the screen `beside` is on.
 */
export function placeBeside(
  beside: Box,
  area: Box,
  minimum: { width: number; height: number },
  step = 32,
): Box {
  const x = beside.x + step;
  const y = beside.y + step;
  const width = Math.min(beside.width, area.x + area.width - x);
  const height = Math.min(beside.height, area.y + area.height - y);
  if (width >= minimum.width && height >= minimum.height) return { x, y, width, height };

  return {
    x: area.x,
    y: area.y,
    width: Math.min(beside.width, area.width),
    height: Math.min(beside.height, area.height),
  };
}

/**
 * Whether unsaved work has to be confirmed away before it is.
 *
 * The smoke harness drives the real application with no one to answer a modal,
 * so it says so and the prompt is skipped. It is the one way past this, and it
 * is named here rather than written out at each of the two places that ask.
 */
export function needsDiscardPrompt(dirty: boolean, smokeTest: boolean): boolean {
  return dirty && !smokeTest;
}

/**
 * Whether a link a window tried to open goes to the system browser.
 *
 * Web links only. `shell.openExternal` gives a link to whatever the system
 * says handles its scheme — a `file:` link to a `.command` file runs it in
 * Terminal on macOS — and links reach it from `window.open` and from a
 * navigation, both of which a project's own script can make. Everything the
 * editor opens on purpose is `http:` or `https:`; another scheme would have to
 * be let through here, on purpose too.
 */
export function opensInBrowser(url: string): boolean {
  const protocol = URL.parse(url)?.protocol;
  return protocol === 'http:' || protocol === 'https:';
}
