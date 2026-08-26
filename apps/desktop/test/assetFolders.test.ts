import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS_DIR } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  createAssetFolder,
  removeAsset,
  removeAssetFolder,
  renameAssetFolder,
  scanAssets,
} from '../src/main/assets';

/*
 * Folders are the one part of `assets/` the author edits directly, and the two
 * risky operations are here: a rename that has to carry every sidecar with it,
 * and a delete that must never be the thing that destroys an id.
 */

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-folders-'));
  await mkdir(join(root, ASSETS_DIR), { recursive: true });
  return root;
}

/** A file in `assets/<folder>` that the scan will adopt and give an id. */
async function writeAsset(root: string, folder: string, name: string): Promise<void> {
  const directory = join(root, ASSETS_DIR, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), 'bytes', 'utf8');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('createAssetFolder', () => {
  it('creates nested folders in one call', async () => {
    const root = await project();
    const created = await createAssetFolder(root, 'models/props/crates');

    expect(created).toBe('models/props/crates');
    expect(await exists(join(root, ASSETS_DIR, 'models/props/crates'))).toBe(true);
  });

  it('suffixes the leaf rather than silently doing nothing', async () => {
    const root = await project();
    await createAssetFolder(root, 'New Folder');

    expect(await createAssetFolder(root, 'New Folder')).toBe('New Folder-1');
  });

  it('refuses a name that is only whitespace', async () => {
    const root = await project();
    await expect(createAssetFolder(root, '   ')).rejects.toThrow(/needs a name/);
  });

  it('refuses to climb out of the project', async () => {
    const root = await project();
    await expect(createAssetFolder(root, '../../escaped')).rejects.toThrow(/outside the project/);
  });
});

describe('renameAssetFolder', () => {
  it('carries every asset id with it', async () => {
    const root = await project();
    await writeAsset(root, 'models', 'tree.glb');
    await writeAsset(root, 'models/props', 'crate.glb');
    const before = await scanAssets(root);

    expect(await renameAssetFolder(root, 'models', 'meshes')).toBe('meshes');

    const after = await scanAssets(root);
    // The whole point: an id lives in the sidecar beside its file, so moving
    // the directory moves the identity. Anything else and every scene
    // referencing these assets would come back empty.
    expect(after.assets.map((asset) => asset.id).sort()).toEqual(
      before.assets.map((asset) => asset.id).sort(),
    );
    expect(after.assets.map((asset) => asset.folder).sort()).toEqual(['meshes', 'meshes/props']);
  });

  it('renames a folder nested under another', async () => {
    const root = await project();
    await createAssetFolder(root, 'models/props');

    expect(await renameAssetFolder(root, 'models/props', 'furniture')).toBe('models/furniture');
  });

  it('refuses to rename the assets folder itself', async () => {
    const root = await project();
    await expect(renameAssetFolder(root, '', 'stuff')).rejects.toThrow(/cannot be renamed/);
  });

  it('refuses a name already taken by a sibling', async () => {
    const root = await project();
    await createAssetFolder(root, 'models');
    await createAssetFolder(root, 'textures');

    await expect(renameAssetFolder(root, 'models', 'textures')).rejects.toThrow(/already there/);
  });

  it('allows a rename that only changes case', async () => {
    const root = await project();
    await createAssetFolder(root, 'props');

    // On a case-insensitive volume the destination "already exists" — it is the
    // source. Refusing here would make `props` -> `Props` impossible on macOS.
    expect(await renameAssetFolder(root, 'props', 'Props')).toBe('Props');
    expect(await readdir(join(root, ASSETS_DIR))).toEqual(['Props']);
  });

  it('replaces the characters a path cannot carry', async () => {
    const root = await project();
    await createAssetFolder(root, 'models');

    expect(await renameAssetFolder(root, 'models', 'a/b')).toBe('a-b');
  });

  it('is a no-op when the name does not change', async () => {
    const root = await project();
    await createAssetFolder(root, 'models');

    expect(await renameAssetFolder(root, 'models', 'models')).toBe('models');
    expect(await exists(join(root, ASSETS_DIR, 'models'))).toBe(true);
  });
});

describe('removeAssetFolder', () => {
  it('removes an empty folder', async () => {
    const root = await project();
    await createAssetFolder(root, 'models/props');

    await removeAssetFolder(root, 'models/props');

    expect(await exists(join(root, ASSETS_DIR, 'models/props'))).toBe(false);
    // Not the parent as well: the author named one folder.
    expect(await exists(join(root, ASSETS_DIR, 'models'))).toBe(true);
  });

  it('refuses a folder holding an asset', async () => {
    const root = await project();
    await writeAsset(root, 'models', 'tree.glb');

    await expect(removeAssetFolder(root, 'models')).rejects.toThrow(/not empty/);
    expect(await exists(join(root, ASSETS_DIR, 'models/tree.glb'))).toBe(true);
  });

  it('refuses a folder holding another folder', async () => {
    const root = await project();
    await createAssetFolder(root, 'models/props');

    await expect(removeAssetFolder(root, 'models')).rejects.toThrow(/not empty/);
  });

  it('refuses to remove the assets folder itself', async () => {
    const root = await project();
    await expect(removeAssetFolder(root, '')).rejects.toThrow(/cannot be removed/);
    expect(await exists(join(root, ASSETS_DIR))).toBe(true);
  });
});

describe('deleting an asset', () => {
  it('takes the folders it emptied with it', async () => {
    const root = await project();
    await writeAsset(root, 'models/props', 'crate.glb');
    const [asset] = (await scanAssets(root)).assets;

    await removeAsset(root, asset.path);

    // `pruneEmptyFolders` used to call `rm` without `recursive`, which throws
    // `EISDIR` on a directory — straight into its own catch, so it silently
    // pruned nothing and every deleted asset left its folder behind.
    expect(await exists(join(root, ASSETS_DIR, 'models/props'))).toBe(false);
    expect(await exists(join(root, ASSETS_DIR, 'models'))).toBe(false);
    expect(await exists(join(root, ASSETS_DIR))).toBe(true);
  });

  it('leaves a folder that still holds something', async () => {
    const root = await project();
    await writeAsset(root, 'models', 'crate.glb');
    await writeAsset(root, 'models', 'tree.glb');
    const crate = (await scanAssets(root)).assets.find((asset) => asset.name === 'crate');

    await removeAsset(root, crate!.path);

    expect(await exists(join(root, ASSETS_DIR, 'models'))).toBe(true);
  });
});
