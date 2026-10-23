/*
 * A path inside a build, and the one place it is decided what may be one.
 *
 * Almost no file in a build is named by the exporter: an asset by its place in
 * the project, a scene by the id in its file, a model's side files by the
 * model, the player's chunks by Vite. Each name used to go straight into
 * `join(outputDir, …)`, so a scene file carrying `"id": "../../x"` wrote outside
 * the folder, and two names one volume stores as one file overwrote each other
 * without a word. Every path a build holds now passes through `toBuildPath`.
 */

declare const buildPathBrand: unique symbol;

/** A path a build may hold: relative, `/`-separated, NFC. Only `toBuildPath` makes one. */
export type BuildPath = string & { readonly [buildPathBrand]: true };

export class BuildPathError extends Error {
  constructor(path: string, reason: string) {
    super(`"${path}" cannot be part of a build: ${reason}.`);
    this.name = 'BuildPathError';
  }
}

/** The device names Windows reserves in every folder, with an extension or without. */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// The C0 controls and DEL: nothing a file name holds on purpose, and NUL cuts a
// path short where Node hands it to the system.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The path as one a build may hold, or a `BuildPathError` saying why not.
 *
 * **NFC**, because names travel: a file written decomposed on a Mac is
 * committed composed (git's `core.precomposeunicode`), and a host on Linux
 * compares bytes — so `café.png` listed one way and published the other is a
 * 404 that works on the author's machine.
 *
 * **Refused rather than repaired.** A `..` segment or a backslash means the
 * name came from somewhere that should not be naming files, and quietly fixing
 * it would hide where.
 *
 * **Windows' rules too**, though the export may run on a Mac: a build is a
 * folder that travels, and a repository holding `con.png` or `name.` cannot be
 * checked out on a PC at all.
 */
export function toBuildPath(raw: string): BuildPath {
  const path = raw.normalize('NFC');
  if (path === '') throw new BuildPathError(raw, 'it is empty');
  if (path.startsWith('/')) throw new BuildPathError(raw, 'it is absolute');
  if (path.includes('\\')) throw new BuildPathError(raw, 'it holds a backslash');
  if (CONTROL.test(path)) throw new BuildPathError(raw, 'it holds a control character');

  for (const segment of path.split('/')) {
    if (segment === '') throw new BuildPathError(raw, 'it holds an empty folder name');
    if (segment === '.' || segment === '..') {
      throw new BuildPathError(raw, `"${segment}" is not a name a build can hold`);
    }
    if (WINDOWS_DEVICE.test(segment)) {
      throw new BuildPathError(raw, `Windows reserves the name "${segment}"`);
    }
    if (/[. ]$/.test(segment)) {
      throw new BuildPathError(raw, `Windows drops the dot or space "${segment}" ends with`);
    }
  }
  return path as BuildPath;
}

/**
 * What two paths share when a volume would store them as one file.
 *
 * APFS and NTFS, as nearly everyone formats them, ignore case, so `Brick.png`
 * and `brick.png` are one file there — and the host the build is published on
 * usually tells them apart. A build holding both loses one to the other on the
 * author's disk and serves a 404 for the survivor's twin.
 */
export function foldKey(path: BuildPath): string {
  return path.toLowerCase();
}
