import { describe, expect, it } from 'vitest';
import { isTslMaterial } from '../src/assets/schema';
import { assetKindForFile, defaultSettings } from '../src/assets/import';

describe('assetKindForFile', () => {
  it('classifies by extension', () => {
    expect(assetKindForFile('tree.glb')).toBe('model');
    expect(assetKindForFile('scene.gltf')).toBe('model');
    expect(assetKindForFile('brick.PNG')).toBe('texture');
    expect(assetKindForFile('sky.hdr')).toBe('texture');
    expect(assetKindForFile('water.wgsl')).toBe('shader');
    expect(assetKindForFile('Rotator.ts')).toBe('script');
  });

  it('prefers the compound suffix over the plain extension', () => {
    // A TSL material is a TypeScript module, so extension alone cannot tell it
    // apart from a behaviour script.
    expect(assetKindForFile('holo.material.ts')).toBe('material');
    expect(assetKindForFile('holo.material.json')).toBe('material');
    expect(assetKindForFile('holo.ts')).toBe('script');
  });

  it('ignores sidecars and unknown types', () => {
    // Sidecars are metadata about assets, never assets themselves; treating one
    // as an asset would give it its own sidecar, recursively.
    expect(assetKindForFile('tree.glb.meta.json')).toBeUndefined();
    expect(assetKindForFile('notes.txt')).toBeUndefined();
    expect(assetKindForFile('README')).toBeUndefined();
  });
});

describe('defaultSettings', () => {
  it('tags TSL materials as authored code, presets as data', () => {
    expect(defaultSettings('material', 'holo.material.ts')).toEqual({
      kind: 'material',
      authoring: 'tsl',
    });
    expect(defaultSettings('material', 'stone.material.json')).toEqual({
      kind: 'material',
      authoring: 'preset',
    });
  });

  it('assumes an imported texture is a base-colour map', () => {
    // Normal, roughness and metalness maps must be retagged to linear by hand;
    // guessing from the file name would be wrong more often than not.
    expect(defaultSettings('texture')).toMatchObject({ colorSpace: 'srgb' });
  });

  it('defaults shaders to the render stage', () => {
    expect(defaultSettings('shader')).toEqual({ kind: 'shader', stage: 'render' });
  });
});

describe('isTslMaterial', () => {
  it('recognises only the module forms', () => {
    expect(isTslMaterial('a.material.ts')).toBe(true);
    expect(isTslMaterial('a.material.js')).toBe(true);
    expect(isTslMaterial('a.material.json')).toBe(false);
  });
});
