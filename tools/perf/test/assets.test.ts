import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyAssetChange, emptyManifest } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanAssets } from '../../../apps/desktop/src/main/assetScan';
import { writeAssetsProject } from '../generate/projects';
import { builtInRegistries } from '../registries';
import { ipcBytes, jsonBytes } from '../scenarios/assets';

const registries = builtInRegistries();

/*
 * What a mutation carries over IPC, counted as its JSON: the manifest the
 * scan answers, the `AssetChange` a move or a folder rename answers. Counted
 * in UTF-8 bytes, not characters — an asset may be named in any script.
 */

describe('the bytes of what crosses IPC', () => {
  it('counts an AssetChange as its JSON, in UTF-8', () => {
    const change = { ...emptyAssetChange(), moved: [{ from: 'assets/a/é.png', to: 'assets/b/é.png' }] };
    expect(jsonBytes(change)).toBe(Buffer.byteLength(JSON.stringify(change), 'utf8'));
    expect(jsonBytes(change)).toBe(JSON.stringify(change).length + 2);
  });

  it('counts a manifest the same way', () => {
    expect(jsonBytes(emptyManifest())).toBe(JSON.stringify(emptyManifest()).length);
  });
});

describe('the mutations measured in Node, with the main process’s own code', () => {
  let parent = '';
  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'perf-assets-'));
  });
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('answers each one’s bytes and leaves the project as it found it', async () => {
    const project = await writeAssetsProject(parent, { textures: 30, folders: 3 });
    const before = await scanAssets(registries, project);
    const bytes = await ipcBytes(project, {
      asset: 'assets/textures/pack-00/tex-00.png',
      to: 'textures/pack-01',
      folder: 'textures/pack-02',
    });
    expect(bytes.list).toBe(jsonBytes(before));
    expect(bytes.move).toBeGreaterThan(50);
    // A folder of ten moves ten files: its change holds ten entries where a
    // move holds one, beside the same empty lists.
    expect(bytes.renameFolder).toBeGreaterThan(bytes.move * 5);
    expect(bytes.refresh).toBeGreaterThan(bytes.list);
    const after = await scanAssets(registries, project);
    expect(after.assets.map((asset) => [asset.id, asset.path]).sort()).toEqual(
      before.assets.map((asset) => [asset.id, asset.path]).sort(),
    );
  });
});
