import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSETS_DIR } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { moveAsset, removeAsset, scanAssets } from '../src/main/assets';
import { ImportSession } from '../src/main/import/ImportSession';

/*
 * A `.gltf` or `.obj` is not one file, and every operation that treats it as
 * one leaves the model broken: the geometry lives in a `.bin` the scene never
 * names, and the materials in a `.mtl` nothing tracks.
 */

/**
 * Stages a file and imports it with the settings the session staged.
 *
 * Through the session rather than around it: the companion walk is what these
 * tests are about, and it happens when the file is staged.
 */
async function importAssets(root: string, sources: readonly string[]) {
  const session = await ImportSession.open(root, sources, '');
  return session.commit(
    session.state().files.map((file) => ({
      fileId: file.id,
      folder: '',
      fileName: file.fileName,
      settings: file.settings!,
    })),
  );
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-companions-'));
  await mkdir(join(root, ASSETS_DIR), { recursive: true });
  return root;
}

/** A glTF with an external buffer and an image one folder down. */
async function writeGltf(directory: string): Promise<string> {
  await mkdir(join(directory, 'maps'), { recursive: true });
  await writeFile(join(directory, 'Tri.bin'), 'buffer', 'utf8');
  await writeFile(join(directory, 'maps', 'albedo.png'), 'image', 'utf8');
  const file = join(directory, 'Tri.gltf');
  await writeFile(
    file,
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'Tri.bin' }],
      images: [{ uri: 'maps/albedo.png' }],
    }),
    'utf8',
  );
  return file;
}

/** An OBJ whose material library sits in a sub-folder, with a texture beside it. */
async function writeObj(directory: string): Promise<string> {
  await mkdir(join(directory, 'mats'), { recursive: true });
  await writeFile(join(directory, 'mats', 'wood.png'), 'image', 'utf8');
  await writeFile(
    join(directory, 'mats', 'Crate.mtl'),
    'newmtl Crate\nmap_Kd wood.png\n',
    'utf8',
  );
  const file = join(directory, 'Crate.obj');
  await writeFile(file, 'mtllib mats/Crate.mtl\nv 0 0 0\n', 'utf8');
  return file;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path);
      else if (!entry.name.endsWith('.meta.json')) out.push(path);
    }
  };
  await walk(root, '');
  return out.sort();
}

describe('importing a model that comes with other files', () => {
  it('brings the buffer and the images, in the folders the model names them by', async () => {
    const source = await mkdtemp(join(tmpdir(), 'studio-source-'));
    const root = await project();

    const result = await importAssets(root, [await writeGltf(source)]);
    expect(result.imported).toHaveLength(1);

    const files = await listFiles(join(root, ASSETS_DIR));
    expect(files).toEqual([
      'models/Tri/Tri.bin',
      'models/Tri/Tri.gltf',
      'models/Tri/maps/albedo.png',
    ]);
  });

  it('follows an .mtl into its own folder, and its textures relative to it', async () => {
    const source = await mkdtemp(join(tmpdir(), 'studio-source-'));
    const root = await project();

    await importAssets(root, [await writeObj(source)]);

    // `map_Kd wood.png` inside `mats/Crate.mtl` means `mats/wood.png` — the
    // path is relative to the library, not to the model that names it.
    expect(await listFiles(join(root, ASSETS_DIR))).toEqual([
      'models/Crate/Crate.obj',
      'models/Crate/mats/Crate.mtl',
      'models/Crate/mats/wood.png',
    ]);
  });
});

describe('moving and deleting such a model', () => {
  it('takes its companions along when it moves', async () => {
    const source = await mkdtemp(join(tmpdir(), 'studio-source-'));
    const root = await project();
    const { imported } = await importAssets(root, [await writeGltf(source)]);

    const moved = await moveAsset(root, imported[0]!.path, 'props');

    // Moving the `.gltf` alone leaves the geometry behind: the model loads to
    // an empty scene, and nothing says why.
    const files = await listFiles(join(root, ASSETS_DIR));
    expect(files).toContain('props/Tri/Tri.gltf');
    expect(files).toContain('props/Tri/Tri.bin');
    expect(files).toContain('props/Tri/maps/albedo.png');
    expect(files).not.toContain('models/Tri/Tri.bin');
    expect(moved).toBe(`${ASSETS_DIR}/props/Tri/Tri.gltf`);

    // The id travels with the sidecar, so every scene reference still resolves.
    const manifest = await scanAssets(root);
    expect(manifest.assets.find((asset) => asset.kind === 'model')?.id).toBe(imported[0]!.id);
  });

  it('takes its companions with it when it is deleted', async () => {
    const source = await mkdtemp(join(tmpdir(), 'studio-source-'));
    const root = await project();
    const { imported } = await importAssets(root, [await writeGltf(source)]);

    await removeAsset(root, imported[0]!.path);

    // Otherwise a deleted model leaves its buffer and its textures behind, and
    // the textures come back as assets of their own on the next scan.
    expect(await listFiles(join(root, ASSETS_DIR))).toEqual([]);
    expect((await scanAssets(root)).assets).toEqual([]);
  });
});

describe('what the model imports as', () => {
  it('reports the model, not its parts', async () => {
    const source = await mkdtemp(join(tmpdir(), 'studio-source-'));
    const root = await project();
    const { imported } = await importAssets(root, [await writeGltf(source)]);

    // One entry in the browser, as Unity shows one Model asset — the buffer is
    // not something anyone places in a scene.
    expect(imported.map((asset) => asset.name)).toEqual(['Tri']);
    const manifest = await scanAssets(root);
    expect(manifest.assets.filter((asset) => asset.kind === 'model')).toHaveLength(1);
    expect(await readFile(join(root, imported[0]!.path), 'utf8')).toContain('Tri.bin');
  });
});
