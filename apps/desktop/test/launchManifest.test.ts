import {
  BUILD_FORMAT_VERSION,
  LAUNCH_SNAPSHOT_VERSION,
  createMaterial,
  createPhysicsMaterial,
  createPhysicsSettings,
  createPrefabDoc,
  createRenderingSettings,
  createStarterScene,
  defaultSettings,
  fixedId,
  prefabJsonOf,
  type AssetEntry,
  type AssetId,
  type AssetKind,
  type LaunchSnapshot,
  type SceneEntry,
  type SceneId,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  launchAssetPath,
  launchManifest,
  launchScenePath,
  type LaunchContents,
} from '../src/main/devices/launchManifest';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The `build.json` a device runs: what is on screen, from the editor's memory,
 * with the rest of the project read from disk. Nothing here touches the disk —
 * the caller reads it and hands over what it found.
 */

function asset(
  id: AssetId,
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
    settings: defaultSettings(registries, kind, path),
    importedPath,
  };
}

function scene(
  id: SceneId,
  name: string,
  path: string,
  shadowedBy: string | null = null,
): SceneEntry {
  return { id, name, path, shadowedBy };
}

const IMPORTED_BRICK = 'assets/textures/.imported/brick.png';
const BRICK = fixedId('asset', 'brick');
const ENTRY = fixedId('scene', 'entry');
const ALPHA = fixedId('scene', 'alpha');
const BETA = fixedId('scene', 'beta');

function snapshot(): LaunchSnapshot {
  const crate = createPrefabDoc('Crate', [], fixedId('entity', 'root'));
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: ENTRY, name: 'Level', scene: createStarterScene() },
    materials: new Map([[fixedId('asset', 'stone'), createMaterial()]]),
    physicsMaterials: new Map([[fixedId('asset', 'ice'), { ...createPhysicsMaterial(), friction: 0 }]]),
    prefabs: new Map([[crate.id, crate]]),
    rendering: { ...createRenderingSettings(), exposure: 1.5 },
    physics: { ...createPhysicsSettings(), gravity: [0, -3, 0] },
    loadingScene: fixedId('scene', 'loading'),
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
    scene(ALPHA, 'Alpha', 'scenes/alpha.scene.json'),
    scene(ENTRY, 'Level', 'scenes/level.scene.json'),
    scene(BETA, 'Beta', 'scenes/sub/beta.scene.json'),
    // A copy made in the Finder: it carries alpha's id, and alpha's file
    // answers to it.
    scene(ALPHA, 'Alpha copy', 'scenes/sub/z-alpha.scene.json', 'scenes/alpha.scene.json'),
  ];

  const ids = (build: { scenes: { id: string }[] }) => build.scenes.map(({ id }) => id);

  it('starts on the entry, under the window’s id and name, at a path that carries its id', () => {
    const build = launchManifest(registries, contents({ scenes: ON_DISK }));
    expect(build.scenes[0]).toEqual({ id: 'entry', name: 'Level', path: 'scenes/entry.json' });
  });

  it('lists every other scene after it, its own file not twice and a shadowed one not at all', () => {
    const build = launchManifest(registries, contents({ scenes: ON_DISK }));
    expect(build.scenes).toEqual([
      { id: 'entry', name: 'Level', path: launchScenePath(ENTRY) },
      { id: 'alpha', name: 'Alpha', path: launchScenePath(ALPHA) },
      { id: 'beta', name: 'Beta', path: launchScenePath(BETA) },
    ]);
  });

  it('starts on the entry even when no file claims its id', () => {
    // A file removed in the Finder under an open window: the entry is answered
    // from memory, so it needs none.
    const withoutItsFile = ON_DISK.filter(({ id }) => id !== 'entry');
    const build = launchManifest(registries, contents({ scenes: withoutItsFile }));
    expect(ids(build)).toEqual(['entry', 'alpha', 'beta']);
  });

  it('lists the entry first when a scene in another folder shares its name', () => {
    // First, so the player — which gives a shared name to the first scene that
    // has it — answers `scenes.current` with the entry, as Play does.
    const build = launchManifest(registries, 
      contents({
        scenes: [
          ...ON_DISK,
          scene(fixedId('scene', 'other'), 'Level', 'scenes/other/level.scene.json'),
        ],
      }),
    );
    expect(ids(build)).toEqual(['entry', 'alpha', 'beta', 'other']);
    expect(build.scenes.find(({ name }) => name === 'Level')?.id).toBe('entry');
  });
});

describe('what else a launch says', () => {
  it('carries the snapshot’s settings, materials, physics materials and prefabs', () => {
    const launched = snapshot();
    const build = launchManifest(registries, contents({ snapshot: launched }));
    expect(build.rendering).toEqual(launched.rendering);
    expect(build.physics).toEqual(launched.physics);
    expect(build.loadingScene).toBe('loading');
    expect(build.materials).toEqual(Object.fromEntries(launched.materials));
    expect(build.physicsMaterials).toEqual(Object.fromEntries(launched.physicsMaterials));
    // Each as the JSON a prefab is written as, which is what a device reads.
    expect(build.prefabs).toEqual(
      Object.fromEntries([...launched.prefabs].map(([id, prefab]) => [id, prefabJsonOf(registries, prefab)])),
    );
  });

  it('lists every asset but the scripts, under its id and its source’s file name', () => {
    const build = launchManifest(registries, 
      contents({
        assets: [
          // Served from its scaled copy, named after its source: the source's
          // extension is what picks the loader.
          asset(BRICK, 'texture', 'assets/textures/brick.png', IMPORTED_BRICK),
          asset(fixedId('asset', 'tree'), 'model', 'assets/models/forest/tree.gltf'),
          asset(fixedId('asset', 'spin'), 'script', 'assets/scripts/Spin.ts'),
        ],
      }),
    );
    // Relative to `build.json`, as every path in it is.
    expect(build.assets).toEqual({
      brick: 'assets/brick/brick.png',
      tree: 'assets/tree/tree.gltf',
    });
    expect(Object.keys(build.assetSettings)).toEqual(['brick', 'tree']);
  });

  it('names the bundle when there is one', () => {
    expect(launchManifest(registries, contents({ scripts: null })).scripts).toBeNull();
    expect(launchManifest(registries, contents({ scripts: 'export {};' })).scripts).toBe('scripts.mjs');
  });

  it('is titled with what it is given, at the current format', () => {
    const build = launchManifest(registries, contents());
    expect(build.title).toBe('My Game');
    expect(build.formatVersion).toBe(BUILD_FORMAT_VERSION);
    expect(build.formatVersion).toBe(8);
  });
});

describe('where a launch serves an asset', () => {
  it('is its id, then its source’s file name, whichever file is served', () => {
    const source = 'assets/textures/brick.png';
    expect(launchAssetPath(asset(BRICK, 'texture', source))).toBe('assets/brick/brick.png');
    expect(launchAssetPath(asset(BRICK, 'texture', source, IMPORTED_BRICK))).toBe(
      'assets/brick/brick.png',
    );
  });
});
