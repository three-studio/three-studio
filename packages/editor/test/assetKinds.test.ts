import { defaultSettings, type AssetEntry, type AssetKind } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { assetKindMime } from '../src/assets/assetDrag';
import { filterAndSortAssets } from '../src/state/assetStore';

/*
 * A kind is matched against what a browser and a person type, and both lower
 * the case: a drag's formats come back lowercased, and the search lowers the
 * query. Every kind was one lowercase word until `physicsMaterial`.
 */

function asset(id: string, kind: AssetKind, path: string): AssetEntry {
  return {
    id,
    name: path.slice(path.lastIndexOf('/') + 1, path.indexOf('.')),
    kind,
    path,
    folder: '',
    sizeBytes: 1,
    modifiedAt: 1,
    importedAt: 1,
    hash: 'h',
    settings: defaultSettings(kind, path),
    importedPath: null,
  };
}

describe('an asset kind of two words', () => {
  it('a kind of two words survives a drag and a search', () => {
    const mime = assetKindMime('physicsMaterial');
    expect(mime).toBe(mime.toLowerCase());

    const ice = asset('pm-ice', 'physicsMaterial', 'assets/physics-materials/Ice.physics-material.json');
    const stone = asset('mat-stone', 'material', 'assets/materials/Stone.material.json');
    const found = filterAndSortAssets({
      manifest: { version: 1, assets: [ice, stone], folders: [] },
      query: 't:physicsmaterial',
      kindFilter: 'all',
      folder: '',
      sortKey: 'name',
      sortAscending: true,
    });

    expect(found.map((entry) => entry.id)).toEqual(['pm-ice']);
  });
});
