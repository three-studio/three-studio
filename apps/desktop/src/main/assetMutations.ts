import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, relative } from 'node:path';
import { ASSETS_DIR, ASSET_META_SUFFIX, assetDisplayName } from '@three-studio/core';
import { resolveInside } from './paths';
import { AssetError, toPosix, uniqueFolderName } from './assetFiles';
import { companionsOf } from './assetScan';

/*
 * Moving, deleting and renaming what is in `assets/`.
 *
 * Every one of these writes to disk and none of them reads a sidecar to decide
 * what to do, which is the line between this and `assetScan`.
 */

export async function removeAsset(projectPath: string, assetPath: string): Promise<void> {
  const target = resolveInside(projectPath, assetPath);

  // Read before deleting: the companions are named inside the file, so once it
  // is gone there is nothing left to ask. Otherwise a deleted model leaves its
  // buffer and its textures behind, and the next scan adopts the textures as
  // assets of their own.
  const companions = await companionsOf(target);

  await rm(target, { force: true });
  await rm(`${target}${ASSET_META_SUFFIX}`, { force: true });

  for (const companion of companions) {
    const file = resolveInside(projectPath, posix.join(posix.dirname(assetPath), companion));
    await rm(file, { force: true });
    await rm(`${file}${ASSET_META_SUFFIX}`, { force: true });
  }

  await pruneEmptyFolders(projectPath, dirname(target));
}

/**
 * Removes directories a delete or a move emptied, up to `assets/` itself.
 *
 * A multi-file model owns its folder, so taking the model out leaves the folder
 * behind — and an empty folder in the browser reads as a place something used
 * to be, which is exactly the confusion to avoid.
 */
async function pruneEmptyFolders(projectPath: string, from: string): Promise<void> {
  const root = join(projectPath, ASSETS_DIR);
  let directory = from;

  while (directory.startsWith(root) && directory !== root) {
    try {
      if ((await readdir(directory)).length > 0) return;
      // `rmdir`, not `rm`: `rm` refuses a directory unless it is told to
      // recurse, and this threw `EISDIR` straight into the catch below on every
      // call — so nothing was ever pruned, and the empty folders this exists to
      // clear away stayed in the browser looking like places something was.
      await rmdir(directory);
    } catch {
      return;
    }
    directory = dirname(directory);
  }
}

/** Moves an asset (and its sidecar) into another folder under `assets/`. */
export async function moveAsset(
  projectPath: string,
  assetPath: string,
  targetFolder: string,
): Promise<string> {
  const source = resolveInside(projectPath, assetPath);
  const fileName = basename(assetPath);

  // A model whose companions are named from inside it cannot be separated from
  // them, and they cannot be renamed. It keeps a folder of its own wherever it
  // goes — the same rule the import follows, so the layout stays predictable.
  const companions = await companionsOf(source);
  const base = posix.join(ASSETS_DIR, targetFolder);
  let directory = base;

  if (companions.length > 0) {
    const wanted = posix.join(base, assetDisplayName(fileName));
    directory =
      resolveInside(projectPath, wanted) === dirname(source)
        ? wanted
        : posix.join(
            base,
            await uniqueFolderName(projectPath, base, assetDisplayName(fileName)),
          );
  }

  const destinationDir = resolveInside(projectPath, directory);
  await mkdir(destinationDir, { recursive: true });

  const destination = join(destinationDir, fileName);
  if (destination === source) return assetPath;

  await rename(source, destination);
  // The sidecar carries the id, so it has to travel with the file or the asset
  // would be adopted again under a new id and every reference would break.
  await rename(`${source}${ASSET_META_SUFFIX}`, `${destination}${ASSET_META_SUFFIX}`).catch(
    () => undefined,
  );

  for (const companion of companions) {
    const from = join(dirname(source), ...companion.split('/'));
    const to = join(destinationDir, ...companion.split('/'));
    try {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      await rename(`${from}${ASSET_META_SUFFIX}`, `${to}${ASSET_META_SUFFIX}`).catch(
        () => undefined,
      );
    } catch {
      // Already missing. The model is the thing being moved; a companion that
      // was not there before is not this operation's to report.
    }
  }

  await pruneEmptyFolders(projectPath, dirname(source));

  return toPosix(relative(projectPath, destination));
}

const ILLEGAL_IN_NAME = /[/\\:*?"<>|]/g;

/**
 * Creates a folder under `assets/`, returning the path it actually got.
 *
 * The leaf goes through `uniqueFolderName`, so asking twice for `New Folder`
 * gives a second folder rather than silently doing nothing — and the caller can
 * navigate into whatever was created rather than into what it asked for.
 */
export async function createAssetFolder(projectPath: string, folder: string): Promise<string> {
  const parent = posix.dirname(folder);
  const base = parent === '.' ? '' : parent;
  const leaf = posix.basename(folder).trim().replace(ILLEGAL_IN_NAME, '-');
  if (leaf === '') throw new AssetError('A folder needs a name.');

  const directory = posix.join(ASSETS_DIR, base);
  await mkdir(join(projectPath, directory), { recursive: true });

  const name = await uniqueFolderName(projectPath, directory, leaf);
  const created = posix.join(base, name);
  await mkdir(resolveInside(projectPath, posix.join(ASSETS_DIR, created)));
  return created;
}

/**
 * Renames a folder under `assets/`, returning its new path.
 *
 * Nothing else has to be rewritten. An asset's id lives in the `.meta.json`
 * beside it and scenes only ever reference ids, so renaming the directory
 * carries every identity with it — see the note on `AssetMeta`. What does go
 * stale is the manifest, which the caller re-reads.
 */
export async function renameAssetFolder(
  projectPath: string,
  folder: string,
  name: string,
): Promise<string> {
  if (folder === '') throw new AssetError('The assets folder itself cannot be renamed.');

  const safe = name.trim().replace(ILLEGAL_IN_NAME, '-');
  if (safe === '') throw new AssetError('A folder needs a name.');

  const parent = posix.dirname(folder);
  const target = parent === '.' ? safe : posix.join(parent, safe);
  if (target === folder) return folder;

  const source = resolveInside(projectPath, posix.join(ASSETS_DIR, folder));
  const destination = resolveInside(projectPath, posix.join(ASSETS_DIR, target));

  // A rename that only changes case is the same directory on a case-insensitive
  // volume, so the collision check would refuse `props` -> `Props` on the very
  // machine most of this is developed on.
  if (target.toLowerCase() !== folder.toLowerCase()) {
    try {
      await stat(destination);
      throw new AssetError(`A folder named ${safe} is already there.`);
    } catch (cause) {
      if (cause instanceof AssetError) throw cause;
    }
  }

  await rename(source, destination);
  return target;
}

/**
 * Removes a folder under `assets/`. Refuses anything that is not empty.
 *
 * Deleting assets destroys their ids, and an id is what every scene reference
 * is — so emptying a folder is a separate, deliberate act, taken one asset at a
 * time where the usage of each is reported.
 */
export async function removeAssetFolder(projectPath: string, folder: string): Promise<void> {
  if (folder === '') throw new AssetError('The assets folder itself cannot be removed.');

  const directory = resolveInside(projectPath, posix.join(ASSETS_DIR, folder));
  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new AssetError(`${folder} is not empty.`);
  }

  // `rmdir` rather than `rm`: it refuses a directory with anything in it, so
  // the check above is backed by the syscall rather than trusted on its own.
  //
  // Deliberately not `pruneEmptyFolders` afterwards: that exists so a move does
  // not leave a hole behind. Here the author named one folder, and watching its
  // parent vanish along with it is not what they asked for.
  await rmdir(directory);
}
