import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  CACHE_DIR,
  SCENES_DIR,
  createNewScene,
  deserializeScene,
  serializeScene,
  type AssetMeta,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { scanAssets } from '../src/main/assetScan';
import { discoverScenes } from '../src/main/project';

/*
 * `.studio/*.index.json` remembers what a file held so the next walk does not
 * have to open it again. Everything below is about the one property that makes
 * that safe: the index is never a source of truth. It answers only for a file
 * whose mtime and size are exactly what they were when it was read, it declines
 * everything else, and it can be deleted at any moment without losing anything.
 *
 * The measurements that motivated it, on 3000 assets and 20 scenes of 3000
 * entities each (24 MB of scene JSON): `scanAssets` 391 ms with no index, 111 ms
 * warm, 120 ms after renaming one file; `discoverScenes` 78 ms and under 1 ms.
 * `assets:list` runs after every mutation, from fourteen places in the editor,
 * which is why the warm number is the one that matters.
 */

async function projectWith(assets: number, scenes: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-index-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });
  await mkdir(join(root, ASSETS_DIR, 'textures'), { recursive: true });

  for (let i = 0; i < scenes; i++) {
    await writeFile(
      join(root, SCENES_DIR, `Level${i}.scene.json`),
      serializeScene(createNewScene(`Level${i}`)),
      'utf8',
    );
  }
  for (let i = 0; i < assets; i++) {
    await writeFile(join(root, ASSETS_DIR, 'textures', `t${i}.png`), `pixels ${i}`, 'utf8');
  }
  return root;
}

/** Ids by asset name, which is what every scene in the project references. */
async function assetIds(root: string): Promise<Record<string, string>> {
  const manifest = await scanAssets(root);
  return Object.fromEntries(manifest.assets.map((asset) => [asset.name, asset.id]));
}

function indexFile(root: string, name: string): string {
  return join(root, CACHE_DIR, name);
}

describe('an index that is never a source of truth', () => {
  it('gives the same answer warm as it did cold', async () => {
    const root = await projectWith(4, 3);

    const first = await scanAssets(root);
    const second = await scanAssets(root);
    expect(second).toEqual(first);

    const scenes = await discoverScenes(root);
    expect(await discoverScenes(root)).toEqual(scenes);
  });

  /*
   * The whole safety argument in one test. `.studio/` is declared disposable
   * and gitignored, so this is a thing people will actually do — and an id is
   * what every scene in the project references, so "rebuilds" has to mean the
   * same ids, not merely a manifest of the same shape.
   */
  it('rebuilds everything after .studio is deleted, losing nothing', async () => {
    const root = await projectWith(6, 3);
    const ids = await assetIds(root);
    const scenes = await discoverScenes(root);
    expect(Object.keys(ids)).toHaveLength(6);

    await rm(join(root, CACHE_DIR), { recursive: true, force: true });

    expect(await assetIds(root)).toEqual(ids);
    expect(await discoverScenes(root)).toEqual(scenes);
  });

  it('ignores an index it cannot parse, and writes a good one over it', async () => {
    const root = await projectWith(3, 2);
    const ids = await assetIds(root);

    await writeFile(indexFile(root, 'assets.index.json'), '{ "entries": ', 'utf8');
    await writeFile(indexFile(root, 'scenes.index.json'), 'not json at all', 'utf8');

    expect(await assetIds(root)).toEqual(ids);
    expect((await discoverScenes(root)).map((scene) => scene.name)).toEqual(['Level0', 'Level1']);
    // And it is usable again rather than left broken.
    const written = JSON.parse(await readFile(indexFile(root, 'assets.index.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(written.entries)).toHaveLength(3);
  });

  /*
   * `readAssetMeta` merges `defaultSettings` into what it returns, so the same
   * bytes produce a different value in a build that added a setting. An index
   * that survived that upgrade would serve the old shape for ever, which is why
   * `builtBy` names the app version as well as the sidecar format version.
   */
  it('throws away values another build computed', async () => {
    const root = await projectWith(2, 0);
    await scanAssets(root);

    const path = indexFile(root, 'assets.index.json');
    const stale = JSON.parse(await readFile(path, 'utf8')) as {
      builtBy: string;
      entries: Record<string, { v: AssetMeta }>;
    };
    stale.builtBy = 'some-older-build:meta1';
    // Poisoned, so that serving from it would be visible rather than plausible.
    for (const entry of Object.values(stale.entries)) entry.v = { ...entry.v, id: 'an-id-from-the-past' };
    await writeFile(path, JSON.stringify(stale), 'utf8');

    const manifest = await scanAssets(root);
    expect(manifest.assets.map((asset) => asset.id)).not.toContain('an-id-from-the-past');
  });

  it('drops a file that is gone rather than remembering it for ever', async () => {
    const root = await projectWith(3, 0);
    await scanAssets(root);
    await rm(join(root, ASSETS_DIR, 'textures', 't1.png'), { force: true });

    const manifest = await scanAssets(root);
    expect(manifest.assets.map((asset) => asset.name).sort()).toEqual(['t0', 't2']);
    const written = JSON.parse(await readFile(indexFile(root, 'assets.index.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(written.entries)).toHaveLength(2);
  });
});

describe('what the index declines to answer for', () => {
  /*
   * The task's own warning: the cache avoids a read, it must not avoid a
   * repair. A sidecar an older build wrote is upgraded in place by
   * `readOrCreateMeta`, and a warm index must not stand in the way of that.
   */
  it('still upgrades a sidecar an older build wrote', async () => {
    const root = await projectWith(1, 0);
    const ids = await assetIds(root);
    const file = join(root, ASSETS_DIR, 'textures', 't0.png');

    // Rolled back to format 1 under a warm index, exactly as opening a project
    // last touched by an older build would present it.
    await writeFile(
      `${file}${ASSET_META_SUFFIX}`,
      JSON.stringify({ version: 1, id: ids['t0'], kind: 'texture', importedAt: 1, hash: 'h' }),
      'utf8',
    );

    await scanAssets(root);
    const meta = JSON.parse(await readFile(`${file}${ASSET_META_SUFFIX}`, 'utf8')) as AssetMeta;
    expect(meta.version).toBe(ASSET_META_VERSION);
    // Upgraded, not replaced: the id is what scenes reference.
    expect(meta.id).toBe(ids['t0']);
  });

  it('re-reads a sidecar something else edited', async () => {
    const root = await projectWith(1, 0);
    await scanAssets(root);
    const file = join(root, ASSETS_DIR, 'textures', 't0.png');

    const meta = JSON.parse(await readFile(`${file}${ASSET_META_SUFFIX}`, 'utf8')) as AssetMeta;
    await writeFile(
      `${file}${ASSET_META_SUFFIX}`,
      JSON.stringify({ ...meta, settings: { ...meta.settings, srgb: false } }, null, 2),
      'utf8',
    );

    const manifest = await scanAssets(root);
    expect(manifest.assets[0]?.settings).toMatchObject({ srgb: false });
  });

  it('re-reads a scene whose id changed on disk', async () => {
    const root = await projectWith(0, 1);
    const before = await discoverScenes(root);
    const file = join(root, SCENES_DIR, 'Level0.scene.json');

    const replacement = createNewScene('Level0');
    await writeFile(file, serializeScene(replacement), 'utf8');

    const after = await discoverScenes(root);
    expect(after[0]?.id).toBe(replacement.id);
    expect(after[0]?.id).not.toBe(before[0]?.id);
  });

  /*
   * A file replaced by one of exactly the same length within the same clock
   * tick is the one thing mtime and size cannot see. The stamp is only as fine
   * as the file system's timestamps — nanoseconds on APFS and ext4 — so this
   * pins the platforms we ship on rather than a promise we cannot keep
   * everywhere. If it ever fails, `.studio/` is disposable: that is the fix.
   */
  it('sees a replacement of exactly the same size, because the timestamp moves', async () => {
    const root = await projectWith(0, 1);
    const file = join(root, SCENES_DIR, 'Level0.scene.json');
    const before = await discoverScenes(root);
    const sizeBefore = (await stat(file)).size;

    // The same document with its id reversed: same length, so the file is byte
    // for byte the same size and only the timestamp can tell them apart.
    const swapped = before[0]!.id.split('').reverse().join('');
    const original = deserializeScene(await readFile(file, 'utf8'));
    await writeFile(file, serializeScene({ ...original, id: swapped }), 'utf8');
    expect((await stat(file)).size).toBe(sizeBefore);

    expect((await discoverScenes(root))[0]?.id).toBe(swapped);
  });
});

describe('scanning concurrently with an index', () => {
  /*
   * `exportBuild` starts three scans at once. `upgradeContracts.test.ts` pins
   * that they agree on ids when no sidecars exist; this pins that adding a
   * shared cache underneath them does not change the answer — three writers of
   * one index file, through a temporary file and a rename like every other
   * write to a project, so a reader gets one of them whole.
   */
  it('agrees with itself, warm or cold', async () => {
    const root = await projectWith(12, 0);

    const cold = await Promise.all([scanAssets(root), scanAssets(root), scanAssets(root)]);
    const signature = (manifest: { assets: { name: string; id: string }[] }) =>
      manifest.assets.map((asset) => `${asset.name}:${asset.id}`).sort().join(',');

    expect(signature(cold[1])).toBe(signature(cold[0]));
    expect(signature(cold[2])).toBe(signature(cold[0]));

    const warm = await Promise.all([scanAssets(root), scanAssets(root), scanAssets(root)]);
    expect(signature(warm[0])).toBe(signature(cold[0]));
    expect(signature(warm[2])).toBe(signature(cold[0]));
  });

  it('survives a rename the way the editor does one', async () => {
    const root = await projectWith(5, 0);
    const ids = await assetIds(root);
    const from = join(root, ASSETS_DIR, 'textures', 't2.png');
    const to = join(root, ASSETS_DIR, 'textures', 'renamed.png');

    await rename(from, to);
    await rename(`${from}${ASSET_META_SUFFIX}`, `${to}${ASSET_META_SUFFIX}`);

    const after = await assetIds(root);
    // The id follows the file, which is the whole reason a sidecar exists.
    expect(after['renamed']).toBe(ids['t2']);
    expect(after['t2']).toBeUndefined();
    expect(after['t0']).toBe(ids['t0']);
  });
});
