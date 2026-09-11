import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, relative } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_SUFFIX,
  assetDisplayName,
  emptyAssetChange,
  safeFileName,
  type AssetChange,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { AssetError, toPosix, uniqueFolderName } from './assetFiles';
import { companionsOf } from './assetScan';

/*
 * Moving, deleting and renaming what is in `assets/`.
 *
 * Every one of these writes to disk and none of them reads a sidecar to decide
 * what to do, which is the line between this and `assetScan`.
 *
 * **Each one returns an `AssetChange` describing what it did**, so that the
 * renderer's manifest can follow the mutation instead of being rebuilt by a full
 * scan after it. That scan cost 196 ms on a project of three thousand assets,
 * from fourteen call sites, for changes that usually touch one file.
 *
 * It is said here rather than worked out on the other side because this is the
 * only side that can: deleting a model takes the companion files named *inside*
 * it, moving one carries them along and may make a folder for them, and both
 * prune whatever they emptied. A renderer predicting any of that would be a
 * second copy of rules that live on disk.
 *
 * The change is also where a caller reads the path an operation settled on — the
 * `to` of a move, the one entry in `addedFolders` of a create — rather than a
 * separate return value that could disagree with it.
 */

/** Every asset file and folder under a directory, in the manifest's two frames. */
async function contentsOf(
  projectPath: string,
  folder: string,
): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];

  const walk = async (relativeFolder: string): Promise<void> => {
    const directory = resolveInside(projectPath, posix.join(ASSETS_DIR, relativeFolder));
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const inside = posix.join(relativeFolder, entry.name);
      if (entry.isDirectory()) {
        folders.push(inside);
        await walk(inside);
      } else if (!entry.name.endsWith(ASSET_META_SUFFIX)) {
        // Sidecars are not assets and never appear in the manifest. Anything
        // else is offered: a path the manifest does not hold is ignored when the
        // change is applied, so guessing at kinds here would buy nothing.
        files.push(posix.join(ASSETS_DIR, inside));
      }
    }
  };

  await walk(folder);
  return { files, folders };
}

export async function removeAsset(projectPath: string, assetPath: string): Promise<AssetChange> {
  const target = resolveInside(projectPath, assetPath);

  // Read before deleting: the companions are named inside the file, so once it
  // is gone there is nothing left to ask. Otherwise a deleted model leaves its
  // buffer and its textures behind, and the next scan adopts the textures as
  // assets of their own.
  const companions = await companionsOf(target);

  await rm(target, { force: true });
  await rm(`${target}${ASSET_META_SUFFIX}`, { force: true });

  const removed = [assetPath];
  for (const companion of companions) {
    const relativePath = posix.join(posix.dirname(assetPath), companion);
    const file = resolveInside(projectPath, relativePath);
    await rm(file, { force: true });
    await rm(`${file}${ASSET_META_SUFFIX}`, { force: true });
    removed.push(relativePath);
  }

  return {
    ...emptyAssetChange(),
    removed,
    removedFolders: await pruneEmptyFolders(projectPath, dirname(target)),
  };
}

/**
 * Removes directories a delete or a move emptied, up to `assets/` itself.
 *
 * A multi-file model owns its folder, so taking the model out leaves the folder
 * behind — and an empty folder in the browser reads as a place something used
 * to be, which is exactly the confusion to avoid.
 */
async function pruneEmptyFolders(projectPath: string, from: string): Promise<string[]> {
  const root = join(projectPath, ASSETS_DIR);
  const pruned: string[] = [];
  let directory = from;

  while (directory.startsWith(root) && directory !== root) {
    try {
      if ((await readdir(directory)).length > 0) return pruned;
      // `rmdir`, not `rm`: `rm` refuses a directory unless it is told to
      // recurse, and this threw `EISDIR` straight into the catch below on every
      // call — so nothing was ever pruned, and the empty folders this exists to
      // clear away stayed in the browser looking like places something was.
      await rmdir(directory);
      pruned.push(toPosix(relative(root, directory)));
    } catch {
      return pruned;
    }
    directory = dirname(directory);
  }
  return pruned;
}

/** Moves an asset (and its sidecar) into another folder under `assets/`. */
export async function moveAsset(
  projectPath: string,
  assetPath: string,
  targetFolder: string,
): Promise<AssetChange> {
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
  // Already there. An empty change rather than a no-op with a path attached:
  // nothing moved, so the manifest has nothing to follow.
  if (destination === source) return emptyAssetChange();

  const addedFolders = directory === base ? [] : [directory.slice(ASSETS_DIR.length + 1)];
  const moved = [{ from: assetPath, to: toPosix(relative(projectPath, destination)) }];

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
      moved.push({
        from: toPosix(relative(projectPath, from)),
        to: toPosix(relative(projectPath, to)),
      });
    } catch {
      // Already missing. The model is the thing being moved; a companion that
      // was not there before is not this operation's to report.
    }
  }

  return {
    ...emptyAssetChange(),
    moved,
    addedFolders,
    removedFolders: await pruneEmptyFolders(projectPath, dirname(source)),
  };
}


/**
 * Creates a folder under `assets/`, returning the path it actually got.
 *
 * The leaf goes through `uniqueFolderName`, so asking twice for `New Folder`
 * gives a second folder rather than silently doing nothing — and the caller can
 * navigate into whatever was created rather than into what it asked for.
 */
export async function createAssetFolder(projectPath: string, folder: string): Promise<AssetChange> {
  const parent = posix.dirname(folder);
  const base = parent === '.' ? '' : parent;
  const leaf = safeFileName(posix.basename(folder));
  if (leaf === '') throw new AssetError('A folder needs a name.');

  const directory = posix.join(ASSETS_DIR, base);
  await mkdir(join(projectPath, directory), { recursive: true });

  const name = await uniqueFolderName(projectPath, directory, leaf);
  const created = posix.join(base, name);
  await mkdir(resolveInside(projectPath, posix.join(ASSETS_DIR, created)));

  // Every segment, not just the leaf: `mkdir` was recursive above, so asking for
  // `props/crates/small` may have made three folders. A segment the manifest
  // already knows is dropped when the change is applied.
  const segments = created.split('/');
  return {
    ...emptyAssetChange(),
    addedFolders: segments.map((_, index) => segments.slice(0, index + 1).join('/')),
  };
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
): Promise<AssetChange> {
  if (folder === '') throw new AssetError('The assets folder itself cannot be renamed.');

  const safe = safeFileName(name);
  if (safe === '') throw new AssetError('A folder needs a name.');

  const parent = posix.dirname(folder);
  const target = parent === '.' ? safe : posix.join(parent, safe);
  if (target === folder) return emptyAssetChange();

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

  // Listed before the rename, while the paths in the manifest are still the
  // paths on disk. Bounded by the folder rather than by the project: a rename of
  // a hundred files reads a hundred entries, not three thousand.
  const { files, folders } = await contentsOf(projectPath, folder);
  await rename(source, destination);

  const retarget = (path: string, from: string, to: string): string =>
    `${to}${path.slice(from.length)}`;

  return {
    ...emptyAssetChange(),
    moved: files.map((file) => ({
      from: file,
      to: retarget(file, `${ASSETS_DIR}/${folder}`, `${ASSETS_DIR}/${target}`),
    })),
    addedFolders: [target, ...folders.map((sub) => retarget(sub, folder, target))],
    removedFolders: [folder, ...folders],
  };
}

/**
 * Removes a folder under `assets/`. Refuses anything that is not empty.
 *
 * Deleting assets destroys their ids, and an id is what every scene reference
 * is — so emptying a folder is a separate, deliberate act, taken one asset at a
 * time where the usage of each is reported.
 */
export async function removeAssetFolder(projectPath: string, folder: string): Promise<AssetChange> {
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
  return { ...emptyAssetChange(), removedFolders: [folder] };
}
