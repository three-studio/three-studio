import {
  BUILD_FORMAT_VERSION,
  createPhysicsSettings,
  createRenderingSettings,
  defaultSettings,
  type AssetEntry,
  type AssetKind,
  type AssetSettings,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { assembleManifest, type ManifestContents, type ShippedAsset } from '../src/main/build/manifest';

/*
 * The assembly is what an export and a device launch have in common: two
 * callers deciding what ships, one function deciding what `build.json` says
 * about it. Pinned here without a disk, since nothing it does needs one.
 */

function asset(
  id: string,
  kind: AssetKind,
  path: string,
  settings: AssetSettings = defaultSettings(kind, path),
): AssetEntry {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return {
    id,
    name: file.slice(0, file.lastIndexOf('.')),
    kind,
    path,
    folder: '',
    sizeBytes: 1,
    modifiedAt: 1,
    importedAt: 1,
    hash: 'h',
    settings,
    importedPath: null,
  };
}

function contents(overrides: Partial<ManifestContents> = {}): ManifestContents {
  return {
    title: 'Game',
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    scenes: [{ id: 'main', name: 'Main', path: 'scenes/main.json' }],
    loadingScene: null,
    assets: [],
    materials: {},
    prefabs: {},
    scripts: null,
    ...overrides,
  };
}

describe('assembling build.json', () => {
  it('writes the same bytes whatever order the project was read in', () => {
    // The tables used to follow the order the scan met the files in, which is
    // the order the volume lists a folder in: the same project exported on two
    // machines showed a diff in a build that had not changed.
    const a = { entry: asset('tex-a', 'texture', 'assets/textures/a.png'), path: 'textures/a.1.png' };
    const b = { entry: asset('tex-b', 'texture', 'assets/textures/b.png'), path: 'textures/b.2.png' };
    const material = (color: string) => ({ color }) as never;

    const one = assembleManifest(
      contents({
        assets: [a, b],
        materials: { 'mat-a': material('#a'), 'mat-b': material('#b') },
        prefabs: { 'pre-a': {} as never, 'pre-b': {} as never },
      }),
    );
    const other = assembleManifest(
      contents({
        assets: [b, a],
        materials: { 'mat-b': material('#b'), 'mat-a': material('#a') },
        prefabs: { 'pre-b': {} as never, 'pre-a': {} as never },
      }),
    );
    expect(JSON.stringify(other)).toBe(JSON.stringify(one));
  });

  it('describes each shipped asset at the path it was given', () => {
    const texture = defaultSettings('texture', 'brick.png');
    const gain = { ...defaultSettings('texture', 'gain.jpg'), encoding: 'ultrahdr' } as AssetSettings;
    const shipped: ShippedAsset[] = [
      { entry: asset('brick', 'texture', 'assets/textures/brick.png', texture), path: 'textures/brick.1.png' },
      { entry: asset('gain', 'texture', 'assets/textures/gain.jpg', gain), path: 'textures/gain.2.jpg' },
      { entry: asset('beep', 'audio', 'assets/audio/beep.wav'), path: 'audio/beep.3.wav' },
    ];

    const build = assembleManifest(contents({ assets: shipped }));

    expect(build.assets).toEqual({
      brick: 'textures/brick.1.png',
      gain: 'textures/gain.2.jpg',
      beep: 'audio/beep.3.wav',
    });
    // Only the image whose file name does not say how it stores light.
    expect(build.textureEncodings).toEqual({ gain: 'ultrahdr' });
    expect(build.assetSettings).toEqual({
      brick: texture,
      gain,
      beep: shipped[2]!.entry.settings,
    });
  });

  it('carries the rendering settings whole, and nothing beside them', () => {
    // `forceWebGL` used to be repeated at the top for a player older than
    // `rendering`. This file only ever travels with its own player, so a field
    // kept for an older reader is a field nobody reads.
    const rendering = { ...createRenderingSettings(), forceWebGL: true };
    const build = assembleManifest(contents({ rendering }));
    expect(build.rendering).toEqual(rendering);
    expect(Object.keys(build)).not.toContain('forceWebGL');
  });

  it('lists the scenes in the order given, the entry first, each with its path', () => {
    // A name shared with another scene stays in the list: which one answers to
    // it is the player's to decide, and the entry comes first.
    const scenes = [
      { id: 'b', name: 'Level', path: 'scenes/level.2.json' },
      { id: 'a', name: 'Level', path: 'scenes/level.1.json' },
      { id: 'c', name: '__proto__', path: 'scenes/proto.3.json' },
    ];
    const build = assembleManifest(contents({ scenes }));
    expect(build.scenes).toEqual(scenes);
    expect(Object.keys(build)).not.toContain('sceneNames');
  });

  it('passes the rest through, and says which format it is', () => {
    const build = assembleManifest(
      contents({ title: 'Mine', loadingScene: 'loading', scripts: 'scripts/bundle.1a2b3c4d.mjs' }),
    );
    expect(build.title).toBe('Mine');
    expect(build.loadingScene).toBe('loading');
    expect(build.scripts).toBe('scripts/bundle.1a2b3c4d.mjs');
    expect(build.formatVersion).toBe(BUILD_FORMAT_VERSION);
  });
});
