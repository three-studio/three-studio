import {
  createLightEntity,
  createMaterial,
  createMeshEntity,
  createRenderingSettings,
  type LightComponent,
  type MaterialDef,
  type MeshComponent,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { NULL_ASSET_RESOLVER } from '@three-studio/runtime/assets/AssetResolver';
import { Engine } from '@three-studio/runtime/Engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { digestProjection, type ProjectionDigest } from '../../runtime/test/sceneDigest';
import { EDITOR_OVERLAYS, createEditorProjection } from '../src/viewport/editorProjection';

/*
 * The Scene view and Play project the same document, and this is what says so.
 *
 * Three modes read one `SceneDoc` — the Scene view, Play, and an exported build
 * — and until this file nothing compared any two of them. That is how a project
 * asking for 4096 shadow maps got 4096 in the viewport, 2048 the moment Play was
 * pressed, and 2048 in the build: three answers, no test that could hold them up
 * against each other. T-009 fixed that one; this is what stops the next.
 *
 * **What it does not cover, and cannot:**
 *
 * - *Pixels.* Nothing is drawn here. Two scenes that digest identically can
 *   still render differently if the renderer is configured differently.
 * - *The renderer's own state* — tone mapping, exposure, pixel ratio, MSAA. The
 *   guarantee there is at the type level instead, and it is the stronger one:
 *   since T-009 `createRenderer` and `SceneBinder` take the same
 *   `RenderingSettings`, from one producer per mode, so a mode cannot answer for
 *   itself without `tsc` naming it. A type cannot be skipped the way a test can.
 * - *Timing.* A glTF or a texture arrives whenever it arrives; `whenLoaded` is
 *   awaited on both sides so this compares two settled scenes, not two races.
 * - *The exported build.* It runs no engine here. `apps/desktop/test/exportWeb.test.ts`
 *   covers the half that can be checked without a browser: that `build.json`
 *   carries `rendering` at all, so the player has the same numbers to read.
 *
 * It runs under `environment: 'node'` like every other test in the repo:
 * `three/webgpu` imports and its objects construct, and neither side asks for a
 * device. What must never appear is a `WebGPURenderer`.
 */

/**
 * The one browser dependency between here and a running `Engine`.
 *
 * `Input` registers listeners on `window`, on `document` and on the element it
 * is handed; nothing on this path reads anything back off them. Physics is off,
 * which skips Rapier, and omitting `audioContext` is a game with no audio — so
 * this object is the whole of the browser `Engine.create` needs.
 */
const eventTarget = { addEventListener() {}, removeEventListener() {} };

beforeAll(() => {
  Object.assign(globalThis, { window: eventTarget, document: eventTarget });
});

afterAll(() => {
  // Taken back down: three decides at module load whether it is in a browser,
  // and a `window` left behind is a global this file wrote for another file to
  // find.
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

/** Asset id of the shared material the fifth cube is linked to. */
const BRASS = 'material-brass';

const materials: Record<string, MaterialDef> = { [BRASS]: createMaterial('#b58a3c') };

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

/** Project settings a build would carry; 4096 is the divergence T-009 closed. */
function settings(overrides: Partial<RenderingSettings> = {}): RenderingSettings {
  return { ...createRenderingSettings(), shadowMapSize: 4096, ...overrides };
}

/** What the Scene view holds, with no canvas and no device under it. */
async function sceneView(
  scene: SceneDoc,
  rendering: RenderingSettings,
): Promise<ProjectionDigest> {
  const projection = createEditorProjection({
    scene,
    resolver: NULL_ASSET_RESOLVER,
    rendering,
    materials,
  });
  // What `Engine.create` awaits on its own side. Nothing in these fixtures
  // loads, so it settles at once — but the two have to be read at the same
  // point in their lives, or a fixture that ever gains a model would compare a
  // finished scene against one still waiting for a glTF.
  await projection.binder.whenLoaded();

  const digest = digestProjection(projection.scene, projection.binder);
  projection.binder.dispose();
  return digest;
}

/** What Play holds, from the real `Engine` rather than from a stand-in for it. */
async function play(scene: SceneDoc, rendering: RenderingSettings): Promise<ProjectionDigest> {
  const engine = await Engine.create({
    scene,
    resolver: NULL_ASSET_RESOLVER,
    rendering,
    materials,
    domElement: eventTarget as unknown as HTMLElement,
    enablePhysics: false,
  });
  const digest = digestProjection(engine.scene, engine.binder);
  engine.dispose();
  return digest;
}

describe('the Scene view and Play project a scene the same way', () => {
  it('differ by the editor overlays and by nothing else', async () => {
    const scene = fixture();
    const rendering = settings();

    const view = await sceneView(scene, rendering);
    const running = await play(scene, rendering);

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
    const view = await sceneView(sceneWith([createMeshEntity('box')]), settings());

    expect(view.lights).toEqual([]);
    expect(view.overlays).toContain('FallbackLighting');
  });

  it('fails that comparison the moment the two disagree about batching', async () => {
    const scene = fixture();

    // The disagreement T-008 made impossible to express: the viewport batching
    // while the game does not. It used to be two defaults written separately in
    // two files, one of them commented as the opposite of what it did — they
    // agreed by accident, and nothing would have said so when they stopped.
    const view = await sceneView(scene, settings({ batching: true }));
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
