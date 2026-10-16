import {
  BUILD_FORMAT_VERSION,
  LAUNCH_SNAPSHOT_VERSION,
  createMaterial,
  createPhysicsSettings,
  createPrefabDoc,
  createRenderingSettings,
  createStarterScene,
  defaultSettings,
  emptyComponentTables,
  type AssetEntry,
  type AssetKind,
  type LaunchSnapshot,
  type SceneEntry,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  launchAssetPath,
  launchManifest,
  type LaunchContents,
} from '../src/main/devices/launchManifest';

/*
 * The `build.json` a device runs: what is on screen, from the editor's memory,
 * with the rest of the project read from disk. Nothing here touches the disk —
 * the caller reads it and hands over what it found.
 */

function asset(
  id: string,
  kind: AssetKind,
  path: string,
  importedPath: string | null = null,
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
    settings: defaultSettings(kind, path),
    importedPath,
  };
}

function scene(
  id: string,
  name: string,
  path: string,
  shadowedBy: string | null = null,
): SceneEntry {
  return { id, name, path, shadowedBy };
}

const IMPORTED_BRICK = 'assets/textures/.imported/brick.png';

function snapshot(): LaunchSnapshot {
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: 'entry', name: 'Level', scene: createStarterScene() },
    materials: { stone: createMaterial() },
    prefabs: { crate: createPrefabDoc('Crate', [], emptyComponentTables(), '') },
    rendering: { ...createRenderingSettings(), exposure: 1.5 },
    physics: { ...createPhysicsSettings(), gravity: [0, -3, 0] },
    loadingScene: 'loading',
  };
}

function contents(overrides: Partial<LaunchContents> = {}): LaunchContents {
  return {
    snapshot: snapshot(),
    scenes: [],
    assets: [],
    title: 'My Game',
    scripts: null,
    ...overrides,
  };
}

describe('the scenes a launch lists', () => {
  const ON_DISK = [
    scene('alpha', 'Alpha', 'scenes/alpha.scene.json'),
    scene('entry', 'Level', 'scenes/level.scene.json'),
    scene('beta', 'Beta', 'scenes/sub/beta.scene.json'),
    // A copy made in the Finder: it carries alpha's id, and alpha's file
    // answers to it.
    scene('alpha', 'Alpha copy', 'scenes/sub/z-alpha.scene.json', 'scenes/alpha.scene.json'),
  ];

  it('starts on the entry, under the window’s id and name', () => {
    const build = launchManifest(contents({ scenes: ON_DISK }));
    expect(build.scenes[0]).toBe('entry');
    expect(build.sceneNames?.['Level']).toBe('entry');
  });

  it('lists every other scene after it, its own file not twice and a shadowed one not at all', () => {
    const build = launchManifest(contents({ scenes: ON_DISK }));
    expect(build.scenes).toEqual(['entry', 'alpha', 'beta']);
    expect(build.sceneNames).toEqual({ Level: 'entry', Alpha: 'alpha', Beta: 'beta' });
  });

  it('starts on the entry even when no file claims its id', () => {
    // A file removed in the Finder under an open window: the entry is answered
    // from memory, so it needs none.
    const withoutItsFile = ON_DISK.filter(({ id }) => id !== 'entry');
    const build = launchManifest(contents({ scenes: withoutItsFile }));
    expect(build.scenes).toEqual(['entry', 'alpha', 'beta']);
    expect(build.sceneNames?.['Level']).toBe('entry');
  });

  it('leaves the entry its name when a scene in another folder shares it', () => {
    const build = launchManifest(
      contents({ scenes: [...ON_DISK, scene('other', 'Level', 'scenes/other/level.scene.json')] }),
    );
    expect(build.scenes).toEqual(['entry', 'alpha', 'beta', 'other']);
    expect(build.sceneNames?.['Level']).toBe('entry');
  });
});

describe('what else a launch says', () => {
  it('carries the snapshot’s settings, materials and prefabs', () => {
    const launched = snapshot();
    const build = launchManifest(contents({ snapshot: launched }));
    expect(build.rendering).toEqual(launched.rendering);
    expect(build.forceWebGL).toBe(launched.rendering.forceWebGL);
    expect(build.physics).toEqual(launched.physics);
    expect(build.loadingScene).toBe('loading');
    expect(build.materials).toEqual(launched.materials);
    expect(build.prefabs).toEqual(launched.prefabs);
  });

  it('lists every asset but the scripts, under its id and its source’s file name', () => {
    const build = launchManifest(
      contents({
        assets: [
          // Served from its scaled copy, named after its source: the source's
          // extension is what picks the loader.
          asset('brick', 'texture', 'assets/textures/brick.png', IMPORTED_BRICK),
          asset('tree', 'model', 'assets/models/forest/tree.gltf'),
          asset('spin', 'script', 'assets/scripts/Spin.ts'),
        ],
      }),
    );
    expect(build.assets).toEqual({ brick: 'brick/brick.png', tree: 'tree/tree.gltf' });
    expect(Object.keys(build.assetSettings ?? {})).toEqual(['brick', 'tree']);
  });

  it('names the bundle when there is one', () => {
    expect(launchManifest(contents({ scripts: null })).scripts).toBeNull();
    expect(launchManifest(contents({ scripts: 'export {};' })).scripts).toBe('scripts.mjs');
  });

  it('is titled with what it is given, at the current format', () => {
    const build = launchManifest(contents());
    expect(build.title).toBe('My Game');
    expect(build.formatVersion).toBe(BUILD_FORMAT_VERSION);
    expect(build.formatVersion).toBe(6);
  });
});

describe('where a launch serves an asset', () => {
  it('is its id, then its source’s file name, whichever file is served', () => {
    const source = 'assets/textures/brick.png';
    expect(launchAssetPath(asset('brick', 'texture', source))).toBe('brick/brick.png');
    expect(launchAssetPath(asset('brick', 'texture', source, IMPORTED_BRICK))).toBe('brick/brick.png');
  });
});
