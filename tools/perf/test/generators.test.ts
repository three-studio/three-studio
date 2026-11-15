import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CACHE_DIR,
  componentAssets,
  componentsOf,
  decodeScene,
  isAssetId,
  type SceneDoc,
  unwrap,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAssetMeta, scanAssets } from '../../../apps/desktop/src/main/assetScan';
import { readGlb } from '../../../apps/desktop/src/main/glb';
import { openProject, readProject, readSceneFile } from '../../../apps/desktop/src/main/project';
import {
  GEOMETRY,
  TEXTURES,
  geometryCounts,
  texturesCounts,
  type GeometryRecipe,
  type TexturesRecipe,
} from '../generate/glb';
import {
  ASSETS,
  LARGE,
  RENDER,
  assetTextures,
  ballastPaths,
  largeScene,
  renderScene,
  writeAssetsProject,
  writeGeometryProject,
  writeLargeProject,
  writeRenderProject,
  writeScriptedProject,
  writeTexturesProject,
  type ScriptedRecipe,
} from '../generate/projects';
import { builtInRegistries } from '../registries';

const registries = builtInRegistries();

/*
 * The harness's projects, held to what the scenarios assume of them.
 *
 * Each recipe is written at a reduced size and opened by the app's own code:
 * a format change or a renamed factory fails here, in `npm test`, rather than
 * twenty minutes into a run. The full-size recipes are counted without
 * encoding a byte, since writing them is gigabytes and tens of seconds.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UNSIGNED_SHORT = 5123;

const entityCount = (scene: SceneDoc): number => scene.entities.size;

/** The asset references the scenes hold, against the ids the project's scan lists. */
async function references(projectPath: string, scenes: readonly SceneDoc[]): Promise<{ resolved: number; unresolved: string[] }> {
  const known = new Set((await scanAssets(registries, projectPath)).assets.map((asset) => asset.id));
  const named = scenes
    .flatMap((scene) => [...scene.entities.keys()].flatMap((entityId) => componentsOf(registries, scene, entityId)))
    .flatMap((component) => componentAssets(registries, component))
    .filter(isAssetId);
  return {
    resolved: named.filter((assetId) => known.has(assetId)).length,
    unresolved: named.filter((assetId) => !known.has(assetId)),
  };
}

/** The project's start scene, as the editor reads it. */
async function startScene(projectPath: string): Promise<SceneDoc> {
  return unwrap(decodeScene(registries, (await openProject(projectPath)).sceneJson), 'Scene file');
}

describe('the full-size recipes, counted without encoding a byte', () => {
  it('render has 3 004 entities', () => {
    expect(entityCount(renderScene(RENDER))).toBe(3004);
  });

  it('large has 10 003 entities', () => {
    expect(entityCount(largeScene(LARGE))).toBe(10_003);
  });

  it('assets has 3 000 textures of distinct colours, in 30 folders', () => {
    const textures = assetTextures(ASSETS);
    expect(textures).toHaveLength(3000);
    expect(new Set(textures.map((texture) => texture.color)).size).toBe(3000);
    expect(new Set(textures.map((texture) => dirname(texture.path))).size).toBe(30);
  });

  it('geometry has 1 500 meshes, about 15 million triangles, and at least 300 MB of buffers', () => {
    const counts = geometryCounts(GEOMETRY);
    expect(counts.meshes).toBe(1500);
    expect(counts.triangles).toBe(14_700_000);
    expect(counts.binBytes).toBeGreaterThanOrEqual(300 * 1024 * 1024);
  });

  it('textures has 24 images', () => {
    expect(texturesCounts(TEXTURES).images).toBe(24);
  });
});

describe('each recipe at a reduced size, opened by the app', () => {
  let parent = '';
  beforeAll(async () => {
    parent = await mkdtemp(join(tmpdir(), 'perf-generators-'));
  });
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it('render', async () => {
    const path = await writeRenderProject(parent, { props: 60, columns: 10 });
    const scene = await startScene(path);
    expect(entityCount(scene)).toBe(64);
    expect(await references(path, [scene])).toEqual({ resolved: 0, unresolved: [] });
  });

  it('large', async () => {
    const path = await writeLargeProject(parent, { groups: 12, columns: 4, childrenPerGroup: 9 });
    const scene = await startScene(path);
    expect(entityCount(scene)).toBe(123);
    // The groups are what scenario 2 selects: ten entities each, children included.
    expect(scene.rootOrder.filter((id) => scene.entities.get(id)?.children.length === 9)).toHaveLength(12);
  });

  it('assets', async () => {
    const path = await writeAssetsProject(parent, { textures: 30, folders: 3 });
    await startScene(path);
    const manifest = await scanAssets(registries, path);
    expect(manifest.assets.filter((asset) => asset.kind === 'texture')).toHaveLength(30);
    expect(manifest.folders).toEqual(expect.arrayContaining(['textures/pack-00', 'textures/pack-01', 'textures/pack-02']));
  });

  it(
    'geometry, loaded as written: 16-bit indices, no compression, and a marker where the copy would be',
    async () => {
      // Above the 2 MB under which the scan does not open a model at all, so
      // the rules that rewrite one before the editor sees it are the ones in
      // play: a change to them fails here first.
      const recipe: GeometryRecipe = { groups: 2, meshesPerGroup: 6, gridSide: 71, materials: 8 };
      const path = await writeGeometryProject(parent, recipe);
      const scene = await startScene(path);
      expect(entityCount(scene)).toBe(3);
      expect((await references(path, [scene])).resolved).toBe(1);

      const model = (await scanAssets(registries, path)).assets.find((asset) => asset.kind === 'model');
      if (!model) throw new Error('the model is not in the manifest');
      expect(model.sizeBytes).toBeGreaterThan(2 * 1024 * 1024);
      expect(model.importedPath).toBeNull();

      const meta = await readAssetMeta(registries, join(path, model.path));
      expect(meta?.settings).toMatchObject({ kind: 'model', compressGeometry: false });
      expect(await readdir(join(path, CACHE_DIR, 'imported', model.id))).toEqual([
        expect.stringMatching(/\.glb\.none$/),
      ]);

      const glb = readGlb(await readFile(join(path, model.path)));
      if (!glb) throw new Error('readGlb could not read the model back');
      expect(glb.json.meshes).toHaveLength(geometryCounts(recipe).meshes);
      expect(glb.bin.length).toBe(geometryCounts(recipe).binBytes);
      const indices = (glb.json.meshes ?? []).map((mesh) => mesh.primitives?.[0]?.indices);
      expect(indices.map((at) => (at === undefined ? undefined : glb.json.accessors?.[at]?.componentType))).toEqual(
        indices.map(() => UNSIGNED_SHORT),
      );
    },
    30_000,
  );

  it('textures', async () => {
    const recipe: TexturesRecipe = { primitives: 2, imageSide: 64 };
    const path = await writeTexturesProject(parent, recipe);
    const scene = await startScene(path);
    expect((await references(path, [scene])).resolved).toBe(1);

    const model = (await scanAssets(registries, path)).assets.find((asset) => asset.kind === 'model');
    if (!model) throw new Error('the model is not in the manifest');
    const glb = readGlb(await readFile(join(path, model.path)));
    if (!glb) throw new Error('readGlb could not read the model back');
    const images = glb.json.images ?? [];
    expect(images).toHaveLength(texturesCounts(recipe).images);
    for (const image of images) {
      const view = image.bufferView === undefined ? undefined : glb.json.bufferViews?.[image.bufferView];
      if (!view) throw new Error('an image without its view');
      const at = view.byteOffset ?? 0;
      expect(image.mimeType).toBe('image/png');
      expect(glb.bin.subarray(at, at + PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    }
  });

  it('scripted: four scenes, A first, no loading scene, every script found', async () => {
    const recipe: ScriptedRecipe = {
      props: 10,
      ballast: 3,
      heavy: { props: 20, columns: 5 },
      heavyImages: { primitives: 1, imageSide: 64 },
    };
    const path = await writeScriptedProject(parent, recipe);
    const opened = await openProject(path);
    expect(opened.scenes.map((scene) => scene.name).sort()).toEqual(['A', 'B', 'Heavy', 'Loading']);
    expect(opened.scenes.find((scene) => scene.id === opened.sceneId)?.name).toBe('A');
    expect((await readProject(path)).settings.loadingScene).toBeNull();

    const scenes = new Map<string, SceneDoc>();
    for (const entry of opened.scenes) {
      scenes.set(entry.name, unwrap(decodeScene(registries, await readSceneFile(path, entry.path)), 'Scene file'));
    }
    const counts = Object.fromEntries([...scenes].map(([name, scene]) => [name, entityCount(scene)]));
    // A: the props, a sun, a camera, the Director and one entity per ballast
    // script; B the same without the ballast; Loading a cube, a sun and a camera;
    // Heavy the field and its model.
    expect(counts).toEqual({ A: 16, B: 13, Loading: 3, Heavy: 25 });

    const manifest = await scanAssets(registries, path);
    expect(manifest.assets.filter((asset) => asset.kind === 'script')).toHaveLength(2 + recipe.ballast);
    expect(ballastPaths(recipe).every((ballast) => manifest.assets.some((asset) => asset.path === ballast))).toBe(true);
    // A Director in A and in B, the ballast in A, the Spinner in Loading, the
    // model in Heavy.
    expect(await references(path, [...scenes.values()])).toEqual({ resolved: 4 + recipe.ballast, unresolved: [] });
  });
});
