import {
  assertDefined,
  createEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  createRenderingSettings,
  fixedId,
  modelType,
  type AssetId,
  type LightComponent,
  type MaterialDef,
  type MeshComponent,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { AssetCache } from '@three-studio/runtime/assets/AssetCache';
import { NULL_ASSET_RESOLVER, type AssetResolver } from '@three-studio/runtime/assets/AssetResolver';
import { CameraClaims } from '@three-studio/runtime/world/cameras';
import { SunService } from '@three-studio/runtime/world/sun';
import { World } from '@three-studio/runtime/world/World';
import { Mesh, type Object3D } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { serveModels, stubImages } from '../../runtime/test/assetFixtures';
import { withoutPhysics } from '../../runtime/test/registries';
import { digestProjection, type ProjectionDigest } from '../../runtime/test/sceneDigest';
import { EDITOR_OVERLAYS, createEditorProjection, type EditorProjection } from '../src/viewport/editorProjection';
import { builtInRegistries } from './registries';
import { StudioTime } from '@three-studio/runtime/time/StudioTime';

/*
 * The edit view and Play project the same document, and this is what says so.
 *
 * Three modes read one `SceneDoc` — the edit view, Play, and an exported build
 * — and until this file nothing compared any two of them. That is how a project
 * asking for 4096 shadow maps got 4096 in the viewport, 2048 the moment Play was
 * pressed, and 2048 in the build: three answers, no test that could hold them up
 * against each other. That one is fixed; this is what stops the next.
 *
 * **What it does not cover, and cannot:**
 *
 * - *Pixels.* Nothing is drawn here. Two scenes that digest identically can
 *   still render differently if the renderer is configured differently.
 * - *The renderer's own state* — tone mapping, exposure, pixel ratio, MSAA. The
 *   guarantee there is at the type level instead, and it is the stronger one:
 *   `createRenderer` and `SceneBinder` take the same `RenderingSettings`, from
 *   one producer per mode, so a mode cannot answer for itself without `tsc`
 *   naming it. A type cannot be skipped the way a test can.
 * - *Timing.* A glTF or a texture arrives whenever it arrives; `whenLoaded` is
 *   awaited on both sides so this compares two settled scenes, not two races.
 * - *The exported build.* It runs no world here. `apps/desktop/test/exportBuild.test.ts`
 *   covers the half that can be checked without a browser: that `build.json`
 *   carries `rendering` at all, so the player has the same numbers to read.
 *
 * It runs under `environment: 'node'` like every other test in the repo:
 * `three/webgpu` imports and its objects construct, and neither side asks for a
 * device. What must never appear is a `WebGPURenderer`.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Asset id of the shared material the fifth cube is linked to. */
const BRASS = fixedId('asset', 'material-brass');

const materials: ReadonlyMap<AssetId, MaterialDef> = new Map([[BRASS, createMaterial('#b58a3c')]]);

/** One window's registries, as both modes are handed them. */
const registries = builtInRegistries();

/**
 * A scene holding one of everything the two modes could disagree about.
 *
 * The counts are not arbitrary. **Four** identical cubes, because
 * `MIN_BATCH_SIZE` is 4 and three of them would form no batch at all — the
 * batching half of this test would then be comparing two scenes that both
 * declined to batch. A fifth cube linked to a shared material sits outside that
 * batch, which is what proves the batch is a group rather than "every mesh".
 * And the spot casts, so `shadowCasters` is non-empty and the batch has to give
 * up per-instance culling: a flag with a reason behind it rather than a default.
 */
function fixture(): SceneDoc {
  const spot = createLightEntity('spot');
  const light = spot.components[0] as LightComponent;
  light.castShadow = true;

  const cubes = [0, 1, 2, 3].map(() => createMeshEntity('box'));

  const linked = createMeshEntity('box');
  (linked.components[0] as MeshComponent).materialId = BRASS;

  const scene = sceneWith([spot, ...cubes, linked]);
  scene.environment = {
    ...scene.environment,
    background: '#101418',
    backgroundIntensity: 0.8,
    environmentIntensity: 1.4,
    fogEnabled: true,
    fogMode: 'exponential',
    fogColor: '#223344',
    fogDensity: 0.02,
  };
  return scene;
}

/**
 * Project settings a build would carry; 4096 is the shadow map size the modes
 * once disagreed on.
 */
function settings(overrides: Partial<RenderingSettings> = {}): RenderingSettings {
  return { ...createRenderingSettings(), shadowMapSize: 4096, ...overrides };
}

/** The window's loaded files, which the viewport hands to Play as it draws from them itself. */
function windowAssets(resolver: AssetResolver = NULL_ASSET_RESOLVER): AssetCache {
  return new AssetCache(registries, { resolver, idleBudgetBytes: 0 });
}

/** The edit view's projection, with no canvas and no device under it. */
async function projected(scene: SceneDoc, rendering: RenderingSettings, assets: AssetCache): Promise<EditorProjection> {
  const projection = createEditorProjection({
    document: scene,
    registries,
    assets,
    rendering,
    materials,
    cameras: new CameraClaims(),
    sun: new SunService(),
    time: new StudioTime(),
  });
  // What `World.play` awaits on its own side. The two have to be read at the
  // same point in their lives, or a fixture holding a model would compare a
  // finished scene against one still waiting for a glTF.
  await projection.binder.whenLoaded();
  return projection;
}

/** What the edit view holds. */
async function editView(scene: SceneDoc, rendering: RenderingSettings, assets = windowAssets()): Promise<ProjectionDigest> {
  const projection = await projected(scene, rendering, assets);
  const digest = digestProjection(projection.scene, projection.binder);
  projection.binder.dispose();
  return digest;
}

/** The game Play runs: the real `World` rather than a stand-in for it. */
function game(scene: SceneDoc, rendering: RenderingSettings, assets: AssetCache): Promise<World> {
  return World.play({
    time: new StudioTime(),
    document: scene,
    registries: withoutPhysics(registries),
    assets,
    rendering,
    materials,
  });
}

/** What Play holds. */
async function play(scene: SceneDoc, rendering: RenderingSettings, assets = windowAssets()): Promise<ProjectionDigest> {
  const world = await game(scene, rendering, assets);
  const digest = digestProjection(world.scene, world.binder);
  world.dispose();
  return digest;
}

/** The first mesh under an entity's container. */
function meshUnder(object: Object3D | undefined): Mesh {
  const meshes: Mesh[] = [];
  object?.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child);
  });
  return assertDefined(meshes[0], 'a mesh');
}

describe('the edit view and Play project a scene the same way', () => {
  it('differ by the editor overlays and by nothing else', async () => {
    const scene = fixture();
    const rendering = settings();
    // One cache for both, as the viewport hands its own to Play.
    const assets = windowAssets();

    const view = await editView(scene, rendering, assets);
    const running = await play(scene, rendering, assets);

    // The overlays are the whole of the editor's addition, and they are stated
    // rather than discovered — that is what `EDITOR_OVERLAYS` is for. In order,
    // because `createEditorProjection` adds them in that order and a list whose
    // order nothing checks is a list that drifts.
    expect(view.overlays).toEqual([...EDITOR_OVERLAYS]);
    expect(running.overlays).toEqual([]);

    // And then everything else, in one comparison. A field added to the digest
    // is covered by this the day it is added; a field added to a projection and
    // not to the digest is not, which is why the digest names what it reads.
    expect({ ...view, overlays: [] }).toEqual(running);
  });

  it('keeps the editor’s fallback lighting out of the projection', async () => {
    // A scene with no light of its own — the case the fallback exists for, so
    // that an author's first cube is not a black square. Both halves matter:
    // the pair is an overlay, and the projection holds no light at all. A build
    // has no such pair, so a light that leaked into `binder.root` here would be
    // a scene that looked lit in the editor and unlit once exported.
    const view = await editView(sceneWith([createMeshEntity('box')]), settings());

    expect(view.lights).toEqual([]);
    expect(view.overlays).toContain('FallbackLighting');
  });

  it('fails that comparison the moment the two disagree about batching', async () => {
    const scene = fixture();

    // The disagreement one setting now makes impossible to express: the
    // viewport batching while the game does not. It used to be two defaults
    // written separately in two files, one of them commented as the opposite of
    // what it did — they agreed by accident, and nothing would have said so
    // when they stopped.
    const view = await editView(scene, settings({ batching: true }));
    const running = await play(scene, settings({ batching: false }));

    expect({ ...view, overlays: [] }).not.toEqual(running);

    // And this is what the author would have been looking at. One `BatchedMesh`
    // holding the four identical cubes, which are hidden because the batch
    // draws them — leaving it and the fifth cube visible. Per-instance culling
    // is off because the spot casts a shadow; see `MeshBatcher.createBatch`.
    expect(view.draws.filter((draw) => draw.batch !== null)).toEqual([
      {
        // No entity: a batch belongs to the group, not to any one member.
        entityId: '',
        // Three's own answer for a `BatchedMesh`; see `DrawDigest.type`.
        type: 'Mesh',
        geometry: expect.any(String) as string,
        material: expect.any(String) as string,
        castShadow: true,
        receiveShadow: true,
        visible: true,
        batch: {
          members: 4,
          perObjectFrustumCulled: false,
          sortObjects: false,
          frustumCulled: false,
        },
      },
    ]);
    expect(view.draws.filter((draw) => draw.visible)).toHaveLength(2);

    // Against five meshes, each drawing itself.
    expect(running.draws.filter((draw) => draw.batch !== null)).toEqual([]);
    expect(running.draws.filter((draw) => draw.visible)).toHaveLength(5);
  });
});

describe('the edit view and Play draw from the window’s one cache', () => {
  it('hold one model twice, drawing its geometry once and materials of their own', async () => {
    stubImages();
    const server = await serveModels();
    const CHAIR = fixedId('asset', 'chair');
    const assets = windowAssets({ url: (id) => (id === CHAIR ? server.url('chair.gltf') : null) });
    const chair = createEntity('Chair', [{ ...modelType.create(), assetId: CHAIR }]);
    const scene = sceneWith([chair]);

    const projection = await projected(scene, settings(), assets);
    const world = await game(scene, settings(), assets);

    // Play parses nothing the edit view already holds …
    expect(server.requests('chair.gltf')).toBe(1);
    expect(assets.stats).toEqual({ entries: 1, held: 2, idleBytes: 0 });
    const edited = meshUnder(projection.binder.getObject(chair.entity.id));
    const played = meshUnder(world.binder.getObject(chair.entity.id));
    expect(played.geometry).toBe(edited.geometry);
    // … and a script tinting the game's materials tints none of the edit view's.
    expect(played.material).not.toBe(edited.material);

    world.dispose();
    expect(assets.stats.held).toBe(1);
    projection.binder.dispose();
    expect(assets.stats.held).toBe(0);
  });
});
