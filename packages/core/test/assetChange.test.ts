import {
  applyAssetChange,
  emptyAssetChange,
  emptyManifest,
  type AssetChange,
  type AssetEntry,
  type AssetManifest,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The manifest follows a mutation instead of being rebuilt by one.
 *
 * A full scan after every mutation cost 196 ms on three thousand assets — 130 ms
 * of walking and stat-ing, plus a 1.2 MB manifest crossing the process boundary —
 * for a rename that touched one file. This is the arithmetic that replaces it,
 * and it is pure: the main process says what it did, and this says what the
 * manifest looks like afterwards.
 */

function asset(path: string, id = path): AssetEntry {
  const inside = path.slice('assets/'.length);
  const cut = inside.lastIndexOf('/');
  return {
    id,
    name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
    kind: 'texture',
    path,
    folder: cut === -1 ? '' : inside.slice(0, cut),
    sizeBytes: 1,
    modifiedAt: 0,
    importedAt: 0,
    hash: 'h',
    settings: { kind: 'texture' } as AssetEntry['settings'],
  };
}

function manifestOf(paths: string[], folders: string[] = []): AssetManifest {
  return { ...emptyManifest(), assets: paths.map((p) => asset(p)), folders };
}

const change = (over: Partial<AssetChange>): AssetChange => ({ ...emptyAssetChange(), ...over });

describe('an asset that moved', () => {
  it('keeps its identity and takes its folder from its new path', () => {
    const before = manifestOf(['assets/textures/a.png'], ['textures', 'sprites']);

    const after = applyAssetChange(
      before,
      change({ moved: [{ from: 'assets/textures/a.png', to: 'assets/sprites/a.png' }] }),
    );

    const moved = after.assets[0]!;
    // The sidecar travels with the file, so the id is the one thing that must
    // not change — every scene reference is made of it.
    expect(moved.id).toBe('assets/textures/a.png');
    expect(moved.path).toBe('assets/sprites/a.png');
    expect(moved.folder).toBe('sprites');
  });

  it('lands at the top level with an empty folder, not with "assets"', () => {
    const after = applyAssetChange(
      manifestOf(['assets/textures/a.png']),
      change({ moved: [{ from: 'assets/textures/a.png', to: 'assets/a.png' }] }),
    );

    // `AssetEntry.folder` is relative to `assets/`, and `''` is what the panel
    // reads as the root. `'assets'` would be a folder that does not exist.
    expect(after.assets[0]?.folder).toBe('');
  });

  it('leaves the order alone, so nothing jumps under the reader', () => {
    const before = manifestOf(['assets/a.png', 'assets/b.png', 'assets/c.png']);

    const after = applyAssetChange(
      before,
      change({ moved: [{ from: 'assets/a.png', to: 'assets/sub/a.png' }] }),
    );

    expect(after.assets.map((entry) => entry.id)).toEqual([
      'assets/a.png',
      'assets/b.png',
      'assets/c.png',
    ]);
  });

  it('ignores a move naming an asset the manifest does not hold', () => {
    const before = manifestOf(['assets/a.png']);

    const after = applyAssetChange(
      before,
      change({ moved: [{ from: 'assets/gone.png', to: 'assets/sub/gone.png' }] }),
    );

    // Inserting it would mean inventing an id, a hash and a size. The manifest
    // is a cache of the disk, and a scan is what fills a gap in it.
    expect(after.assets).toHaveLength(1);
  });
});

describe('an asset that went', () => {
  it('takes its companions with it, because the change names them', () => {
    const before = manifestOf([
      'assets/models/tree/tree.gltf',
      'assets/models/tree/tree.bin',
      'assets/textures/bark.png',
    ]);

    const after = applyAssetChange(
      before,
      change({
        removed: ['assets/models/tree/tree.gltf', 'assets/models/tree/tree.bin'],
        removedFolders: ['models/tree'],
      }),
    );

    expect(after.assets.map((entry) => entry.path)).toEqual(['assets/textures/bark.png']);
    expect(after.folders).not.toContain('models/tree');
  });
});

describe('folders', () => {
  it('adds one without duplicating a folder already known', () => {
    const before = manifestOf([], ['textures']);

    const after = applyAssetChange(before, change({ addedFolders: ['textures', 'sprites'] }));

    expect(after.folders).toEqual(['sprites', 'textures']);
  });

  it('keeps them sorted, which is the order the scan produces', () => {
    const before = manifestOf([], ['b']);

    const after = applyAssetChange(before, change({ addedFolders: ['a', 'c'] }));

    // `scanAssets` sorts `folders` before returning, so a manifest that followed
    // a change instead of being rebuilt has to arrive in the same order or the
    // folder tree reorders itself the next time anything scans.
    expect(after.folders).toEqual(['a', 'b', 'c']);
  });
});

describe('an empty change', () => {
  it('gives back the same manifest, which is what makes it safe to always apply', () => {
    const before = manifestOf(['assets/a.png'], ['textures']);

    const after = applyAssetChange(before, emptyAssetChange());

    expect(after.assets).toEqual(before.assets);
    expect(after.folders).toEqual(before.folders);
  });
});
