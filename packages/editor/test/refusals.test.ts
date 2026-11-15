import {
  PREFAB_FORMAT_VERSION,
  PROJECT_FORMAT_VERSION,
  SCENE_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  createPhysicsSettings,
  createRenderingSettings,
  defaultSettings,
  emptyManifest,
  fixedId,
  formatDiagnostics,
  jsonOf,
  prefabJsonOf,
  serializeScene,
  versionRefusal,
  type AssetEntry,
  type AssetId,
  type OpenProject,
  type RefusedFile,
} from '@three-studio/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { useAssetStore } from '../src/state/assetStore';
import { brokenRows } from '../src/state/brokenReport';
import { useProjectStore } from '../src/state/projectStore';
import { reportRefusals } from '../src/state/refusalReport';
import { useToastStore } from '../src/state/toastStore';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * What a project holds that this build cannot read is said when it opens. A
 * project file or the scene being opened stops the window, which says why on
 * its page; any other file — a scene the menu cannot list, a prefab the library
 * leaves out — is named in the Console, one entry per file with every fault,
 * and counted in one warning, since a toast is never the only way to read it.
 */

const BOSS: RefusedFile = {
  path: 'scenes/Boss.scene.json',
  diagnostics: [{ code: 'field.invalid', message: 'is not JSON (Unexpected end of input)', path: [] }],
};
const CRATE: RefusedFile = {
  path: 'assets/prefabs/Crate.prefab.json',
  diagnostics: [{ code: 'field.unexpected', message: 'is no field this build reads', path: ['id'] }],
};

afterEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the files a project holds that this build refuses', () => {
  it('are each written to the Console, every fault with it, and counted in one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportRefusals([BOSS, CRATE]);

    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      formatDiagnostics(BOSS.path, BOSS.diagnostics),
      formatDiagnostics(CRATE.path, CRATE.diagnostics),
    ]);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'warning', title: '2 files could not be read' });
    expect(toasts[0]?.description).toContain(BOSS.path);
    expect(toasts[0]?.description).toContain(CRATE.path);
  });

  it('say nothing when there are none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportRefusals([]);

    expect(warn).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

/** A project opened on the scene `sceneJson`, as the main process answers. */
function opened(sceneJson: string): OpenProject {
  const sceneId = fixedId('scene', 'main');
  return {
    summary: { name: 'Refusals', path: '/projects/refusals', lastOpenedAt: 1 },
    project: {
      version: PROJECT_FORMAT_VERSION,
      name: 'Refusals',
      engineVersion: '0.6.0',
      startScene: sceneId,
      settings: {
        loadingScene: null,
        rendering: createRenderingSettings(),
        physics: createPhysicsSettings(),
        build: createBuildProfiles('Refusals'),
      },
    },
    scenes: [{ id: sceneId, name: 'main', path: 'scenes/main.scene.json', shadowedBy: null }],
    refusedScenes: [],
    sceneId,
    scenePath: 'scenes/main.scene.json',
    sceneJson,
  };
}

describe('a scene this build refuses, opened', () => {
  it('puts the window on its page, naming the file and every fault, and opens nothing', () => {
    useProjectStore.setState({ summary: null, error: null });
    const older = JSON.stringify({ ...JSON.parse(serializeScene(registries, createEmptyScene())), version: SCENE_FORMAT_VERSION - 1 });

    useProjectStore.getState().adopt(registries, opened(older));

    expect(useProjectStore.getState().error).toBe(
      formatDiagnostics('scenes/main.scene.json', versionRefusal(SCENE_FORMAT_VERSION - 1, SCENE_FORMAT_VERSION).diagnostics),
    );
    expect(useProjectStore.getState().summary).toBeNull();
  });
});

/** A prefab asset entry, as the main process's scan lists one. */
function prefabAsset(id: AssetId, path: string): AssetEntry {
  return {
    id,
    name: path.slice(path.lastIndexOf('/') + 1, path.indexOf('.')),
    kind: 'prefab',
    path,
    folder: 'prefabs',
    sizeBytes: 1,
    modifiedAt: 1,
    importedAt: 1,
    hash: 'h',
    settings: defaultSettings(registries, 'prefab', path),
    importedPath: null,
  };
}

describe('a prefab this build refuses', () => {
  it('is left out of the library, and its file and faults are kept to be reported', async () => {
    const TREE = fixedId('asset', 'tree');
    const OLD = fixedId('asset', 'old');
    const trunk = createMeshEntity('cylinder');
    const tree = jsonOf(prefabJsonOf(registries, { ...prefabWith('Tree', [trunk], trunk.entity.id), id: TREE }));
    const old = JSON.stringify({ ...JSON.parse(tree), version: PREFAB_FORMAT_VERSION - 1 });
    vi.stubGlobal('window', {
      studio: {
        assets: {
          list: async () => ({
            ...emptyManifest(),
            assets: [prefabAsset(TREE, 'assets/prefabs/Tree.prefab.json'), prefabAsset(OLD, 'assets/prefabs/Old.prefab.json')],
          }),
          readMaterials: async () => ({}),
          readPhysicsMaterials: async () => ({}),
          readPrefabs: async () => ({ [TREE]: tree, [OLD]: old }),
        },
      },
    });

    await useAssetStore.getState().refresh(registries);

    expect([...useAssetStore.getState().prefabs.keys()]).toEqual([TREE]);
    expect(useAssetStore.getState().refusedPrefabs).toEqual(
      new Map([
        [
          OLD,
          {
            path: 'assets/prefabs/Old.prefab.json',
            diagnostics: versionRefusal(PREFAB_FORMAT_VERSION - 1, PREFAB_FORMAT_VERSION).diagnostics,
          },
        ],
      ]),
    );
  });

  it('marks the rows that place it, in words of their own: the file is there', () => {
    const OLD = fixedId('asset', 'old');
    const placed = createEntity('Old Tree', [createPrefabInstance(OLD)]);
    const elsewhere = createEntity('Lamp');
    const scene = sceneWith([placed, elsewhere]);

    const marks = brokenRows(registries, scene, new Set([OLD]), new Map([[OLD, CRATE]]));

    expect(marks).toEqual(new Map([[placed.entity.id, [`Its prefab could not be read: ${CRATE.path}`]]]));
  });
});
