import {
  createMaterial,
  createPhysicsMaterial,
  defaultSettings,
  emptyAssetChange,
  type AssetEntry,
  type AssetKind,
} from '@three-studio/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAssetStore } from '../src/state/assetStore';

/*
 * A delete is the one asset change this window makes without reading the
 * project again, so the tables read before it are this window's to keep in step:
 * Play, a launch and the Inspector read them.
 */

function asset(id: string, kind: AssetKind, path: string): AssetEntry {
  return {
    id,
    name: path.slice(path.lastIndexOf('/') + 1, path.indexOf('.')),
    kind,
    path,
    folder: path.slice('assets/'.length, path.lastIndexOf('/')),
    sizeBytes: 1,
    modifiedAt: 1,
    importedAt: 1,
    hash: 'h',
    settings: defaultSettings(kind, path),
    importedPath: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useAssetStore.getState().clear();
});

describe('deleting an asset', () => {
  it('a deleted asset leaves the table it was read into, so nothing is built with it any more', async () => {
    const rubber = asset('pm-rubber', 'physicsMaterial', 'assets/physics-materials/Rubber.physics-material.json');
    const ice = asset('pm-ice', 'physicsMaterial', 'assets/physics-materials/Ice.physics-material.json');
    const stone = asset('mat-stone', 'material', 'assets/materials/Stone.material.json');
    useAssetStore.setState({
      manifest: { version: 1, assets: [rubber, ice, stone], folders: ['materials', 'physics-materials'] },
      materials: { 'mat-stone': createMaterial() },
      physicsMaterials: { 'pm-rubber': createPhysicsMaterial(), 'pm-ice': createPhysicsMaterial() },
    });
    vi.stubGlobal('window', {
      studio: { assets: { remove: async (path: string) => ({ ...emptyAssetChange(), removed: [path] }) } },
    });

    await useAssetStore.getState().remove(rubber.path);
    expect(useAssetStore.getState().physicsMaterials).toEqual({ 'pm-ice': createPhysicsMaterial() });
    expect(useAssetStore.getState().materials).toEqual({ 'mat-stone': createMaterial() });

    await useAssetStore.getState().remove(stone.path);
    expect(useAssetStore.getState().materials).toEqual({});
    expect(useAssetStore.getState().manifest.assets.map((entry) => entry.id)).toEqual(['pm-ice']);
  });
});
