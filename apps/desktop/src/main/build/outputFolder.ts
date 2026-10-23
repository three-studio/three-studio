import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { ASSETS_DIR, BUILD_LAYOUT, CACHE_DIR, SCENES_DIR } from '@three-studio/core';
import { AssetError } from '../assetFiles';

/*
 * Which folder an export may write into, and what in it is the export's.
 *
 * The folder is chosen in a file picker and nothing stood between the choice
 * and the first `rm`. Picking the project itself emptied its `assets/` and
 * `scenes/` — the export cleared the build's folders of those names, which
 * were the project's. Picking a site that already had its own `assets/`
 * emptied that. Neither was a crash; both were the author's files gone.
 */

/**
 * The names an export owns at the top of its folder.
 *
 * Everything else in the folder belongs to the author — a repository's `.git`,
 * its README, a `CNAME` — and the export neither writes, deletes nor lists it.
 */
export const BUILD_ROOTS: readonly string[] = [
  BUILD_LAYOUT.page,
  BUILD_LAYOUT.icon,
  BUILD_LAYOUT.files,
  BUILD_LAYOUT.player,
  BUILD_LAYOUT.game,
];

/**
 * A directory as the file system knows it, rather than as it is spelled.
 *
 * Paths cannot answer "is this the project?": a symlink, a different case on a
 * case-insensitive volume, or a trailing `..` all name one folder several ways.
 * The device and inode a `stat` reports are the folder itself.
 */
async function identityOf(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? `${info.dev}:${info.ino}` : null;
  } catch {
    return null;
  }
}

/**
 * The folder, or the deepest part of it that exists, and every folder above.
 *
 * A folder that does not exist yet is still *inside* something: choosing
 * `assets/build` in the project creates it there.
 */
async function identitiesAbove(path: string): Promise<string[]> {
  const found: string[] = [];
  let current = resolve(path);
  for (;;) {
    const identity = await identityOf(current);
    if (identity !== null) found.push(identity);
    const parent = dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

/**
 * Why an export must not write into this folder, or `null` when it may.
 *
 * Asked before anything is written — the folder itself is not even created —
 * so a refusal leaves the disk exactly as it was.
 *
 * @param home Passed in for the tests; the user's home folder otherwise.
 */
export async function outputFolderProblem(
  outputDir: string,
  projectPath: string,
  home: string = homedir(),
): Promise<string | null> {
  const target = resolve(outputDir);
  const self = await identityOf(target);

  if (self !== null && self === (await identityOf(projectPath))) {
    return (
      'The output folder is the project itself, and an export there would replace the ' +
      "project's own assets/ and scenes/ with the build's. Choose a folder of its own."
    );
  }

  // Inside one of these, the editor takes the build for part of the project:
  // the next scan adopts its files as assets, or its scenes as scenes.
  const above = await identitiesAbove(target);
  for (const folder of [ASSETS_DIR, SCENES_DIR, CACHE_DIR]) {
    const identity = await identityOf(join(projectPath, folder));
    if (identity !== null && above.includes(identity)) {
      return (
        `The output folder is inside the project's ${folder}/, where the editor would take ` +
        'the build for part of the project. Choose a folder outside it.'
      );
    }
  }

  if (self !== null && (self === (await identityOf(home)) || parse(target).root === target)) {
    return 'Choose a folder of its own for the build, not your home folder or the top of a disk.';
  }
  return null;
}

/**
 * Whether a folder holds a build an export made, which it may then replace.
 *
 * Read off the manifest, which every export since builds were versioned has
 * written with a `formatVersion` — under `game/`, or at the top of the folder
 * before format 7, so a folder exported by an earlier version is still one.
 * A folder some other tool filled with an `index.html` has no such file, and
 * is not ours to empty.
 */
async function isBuildFolder(outputDir: string): Promise<boolean> {
  for (const manifest of [BUILD_LAYOUT.manifest, 'build.json']) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(outputDir, ...manifest.split('/')), 'utf8'),
      );
      const version = (parsed as { formatVersion?: unknown } | null)?.formatVersion;
      if (typeof version === 'number') return true;
    } catch {
      // Not this one; the other, or none.
    }
  }
  return false;
}

/**
 * The names an export would replace in a folder that is not one of its builds.
 *
 * Compared without case, as the volumes this runs on mostly compare them:
 * `Assets/` is the folder an export writing `assets/` would empty.
 */
async function takenNames(outputDir: string, owned: readonly string[]): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch {
    return [];
  }
  if (entries.length === 0 || (await isBuildFolder(outputDir))) return [];
  const wanted = new Set(owned.map((name) => name.toLowerCase()));
  return entries.filter((entry) => wanted.has(entry.toLowerCase())).sort();
}

/**
 * Folders an export is writing into right now, by identity.
 *
 * Two windows can ask for an export of the same profile, and two exports into
 * one folder interleave their deletes and copies into a folder that is neither.
 */
const busy = new Set<string>();

/**
 * Checks the folder, creates it, and holds it for one export.
 *
 * In that order, and the order is the point: every refusal that can be decided
 * without writing is decided first, so a refused export leaves nothing behind —
 * not even an empty folder inside the project.
 *
 * @param owned Every name the export will write at the top of the folder.
 * @returns What releases the folder, which the caller runs however the export ends.
 */
export async function claimOutputFolder(
  outputDir: string,
  projectPath: string,
  owned: readonly string[],
  home?: string,
): Promise<() => void> {
  const problem = await outputFolderProblem(outputDir, projectPath, home);
  if (problem !== null) throw new AssetError(problem);

  const taken = await takenNames(outputDir, owned);
  if (taken.length > 0) {
    throw new AssetError(
      `This folder already holds ${taken.join(', ')}, which an export would replace, and ` +
        'nothing in it says an export put them there. Choose an empty folder, or move them out first.',
    );
  }

  await mkdir(outputDir, { recursive: true });
  const identity = await identityOf(outputDir);
  if (identity === null) throw new AssetError(`${outputDir} could not be created as a folder.`);
  // Checked and taken with nothing awaited in between, so two exports that got
  // this far together cannot both take it.
  if (busy.has(identity)) {
    throw new AssetError('An export into this folder is already running. Wait for it to finish.');
  }
  busy.add(identity);
  return () => {
    busy.delete(identity);
  };
}
