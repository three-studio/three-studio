import {
  createComponent,
  createEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  type LightComponent,
  type MaterialDef,
  type MeshComponent,
} from '@three-studio/core';
import {
  Color,
  Group,
  Layers,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { ModelCache } from '../src/assets/ModelCache';
import { SceneBinder } from '../src/SceneBinder';
import type { AssetResolver } from '../src/assets/AssetResolver';

/*
 * The binder had no tests at all, which is why five of the twelve bugs in
 * `docs/refonte-scene/CONSTAT.md` live in it.
 *
 * It is testable under Node without a GPU: `three/webgpu` imports and its
 * objects construct, and the binder only ever builds scene-graph objects. What
 * must never appear here is a `WebGPURenderer` — that one asks for a real
 * device.
 */

/** Disposed after each test, so a leak in one does not show up in the next. */
const live: SceneBinder[] = [];

function binderWith(resolver: AssetResolver = { url: () => null }): SceneBinder {
  const binder = new SceneBinder(resolver);
  live.push(binder);
  return binder;
}

afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
  vi.restoreAllMocks();
});

/** The `Mesh` a mesh component produced, under the entity's container. */
function meshOf(binder: SceneBinder, entityId: string): Mesh {
  const found = binder.getObject(entityId)?.children.find((child) => child instanceof Mesh);
  if (!(found instanceof Mesh)) throw new Error(`no mesh bound for ${entityId}`);
  return found;
}

/** A cube rendering a material asset rather than its own embedded one. */
function meshLinkedTo(materialId: string) {
  const entity = createMeshEntity('box');
  (entity.components[0] as MeshComponent).materialId = materialId;
  return entity;
}

describe('binding a scene', () => {
  it('gives every entity a container, and every identical mesh one geometry', () => {
    const one = createMeshEntity('box');
    const two = createMeshEntity('box');
    const binder = binderWith();

    binder.sync(sceneWith([one, two]));

    expect(binder.getObject(one.entity.id)).toBeDefined();
    expect(binder.getObject(two.entity.id)).toBeDefined();
    expect(binder.root.children).toHaveLength(2);
    // Two boxes of the same size are one set of buffers — the pool is what
    // makes a thousand instances of a prefab affordable. An embedded material
    // is private to its mesh, so nothing is pooled on that side.
    expect(binder.poolSizes).toEqual({ geometries: 1, materials: 0 });
  });

  it('rebuilds nothing when a sync brings the same components back', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const binder = binderWith();

    binder.sync(scene);
    const first = meshOf(binder, cube.entity.id);
    // Ten syncs of a document nothing touched, as a drag on another entity
    // produces. The list of an entity's components is now built fresh on every
    // read, so comparing its *identity* would differ every time and rebuild the
    // whole scene once per frame — B9's leak, through a new door. The elements
    // still carry immer's identity, and that is what the check uses.
    for (let step = 0; step < 10; step++) binder.sync(scene);

    expect(meshOf(binder, cube.entity.id)).toBe(first);
    expect(binder.poolSizes).toEqual({ geometries: 1, materials: 0 });
  });

  it('drops the binding of an entity the document no longer has', () => {
    const cube = createMeshEntity('box');
    const binder = binderWith();

    binder.sync(sceneWith([cube]));
    binder.sync(sceneWith([]));

    expect(binder.getObject(cube.entity.id)).toBeUndefined();
    expect(binder.root.children).toHaveLength(0);
    expect(binder.poolSizes.geometries).toBe(0);
  });
});

/*
 * B5 — the worst of the twelve. Three meshes named the same material asset, and
 * one texture change gave each of them its own copy, each replacement freeing
 * the one the previous mesh had just adopted. Written in the shape it must have
 * once phase 5 lands, not in the shape of the bug.
 */
describe('a material asset shared by several meshes', () => {
  const withColorMap = (): MaterialDef => ({ ...createMaterial(), colorMap: 'tex-1' });

  it('stays one material when a texture slot changes', () => {
    const meshes = [meshLinkedTo('mat-1'), meshLinkedTo('mat-1'), meshLinkedTo('mat-1')];
    const scene = sceneWith(meshes);
    const binder = binderWith();

    binder.setMaterialLibrary({ 'mat-1': createMaterial() });
    binder.sync(scene);
    expect(binder.poolSizes.materials).toBe(1);

    // Assigning a texture is what no patch can absorb: a node material with a
    // new texture slot is a new shader pipeline, so the pool has to replace its
    // entry — once, not once per mesh.
    binder.setMaterialLibrary({ 'mat-1': withColorMap() });
    binder.sync(scene);

    const rendered = meshes.map((entity) => meshOf(binder, entity.entity.id).material as Material);
    expect(binder.poolSizes.materials).toBe(1);
    // The one that matters: N-1 of these are currently holding a material the
    // pool has already handed to the retire queue.
    expect(new Set(rendered).size).toBe(1);
  });
});

/*
 * B8 — a glTF that lands after its entity was deleted. `attachModel` guards
 * against an *edit* with a generation counter, but a removed binding keeps its
 * generation, so the guard passes and the model is attached to a container
 * nothing walks any more.
 */
describe('a model that arrives late', () => {
  it('is thrown away when its entity went while it was loading', async () => {
    const entity = createEntity('Crate', [{ ...createComponent('model'), assetId: 'crate' }]);
    const model = new Group();

    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(model);
    });
    vi.spyOn(ModelCache.prototype, 'loadModel').mockReturnValue(inFlight);

    const binder = binderWith({ url: () => 'file:///crate.glb' });
    binder.sync(sceneWith([entity]));
    binder.sync(sceneWith([]));

    land();
    await binder.whenLoaded();

    // Attached to a detached container, pushed into a `binding.objects` nobody
    // reads: neither `dispose()` nor anything else will ever free it.
    expect(model.parent).toBeNull();
  });
});

/*
 * B9 — a light allocates a shadow map render target, `shadowMapSize` squared and
 * up to 4096, that only `light.entity.entity.dispose()` frees. Every change to a component
 * array rebuilt the object, so dragging an intensity slider allocated one per
 * frame and abandoned the last.
 */
describe('editing a light', () => {
  /** Counts `dispose` on whatever the binder builds for this entity.entity. */
  function watch(binder: SceneBinder, entityId: string): { disposed: number; light: Object3D } {
    const light = binder.getObject(entityId)?.children.find((child) => 'isLight' in child);
    if (!light) throw new Error('no light bound');
    const counter = { disposed: 0, light };
    const original = (light as unknown as { dispose: () => void }).dispose.bind(light);
    (light as unknown as { dispose: () => void }).dispose = () => {
      counter.disposed += 1;
      original();
    };
    return counter;
  }

  it('keeps the same object across twenty scalar edits', () => {
    const entity = createLightEntity('point');
    const binder = binderWith();
    binder.sync(sceneWith([entity]));

    const watched = watch(binder, entity.entity.id);

    for (let step = 1; step <= 20; step++) {
      // A new component array each time, exactly as immer produces on a drag.
      const edited = structuredClone(entity);
      (edited.components[0] as LightComponent).intensity = step;
      binder.sync(sceneWith([edited]));
    }

    // One light, patched twenty times — not twenty lights and nineteen orphaned
    // shadow maps.
    expect(binder.getObject(entity.entity.id)?.children.find((child) => 'isLight' in child)).toBe(
      watched.light,
    );
    expect(watched.disposed).toBe(0);
    expect((watched.light as unknown as { intensity: number }).intensity).toBe(20);
  });

  it('does not try to dispose a camera, which has no dispose', () => {
    const entity = createEntity('Camera', [createComponent('camera')]);
    const binder = binderWith();
    binder.sync(sceneWith([entity]));

    // Adding cameras to `disposables` alongside lights threw
    // `disposable.dispose is not a function` on the first Stop: three gives a
    // camera no such method, and it owns nothing on the GPU to free.
    binder.sync(sceneWith([]));
    expect(() => binder.beginFrame()).not.toThrow();
  });

  it('rebuilds when the kind changes, because that is a different class', () => {
    const entity = createLightEntity('point');
    const binder = binderWith();
    binder.sync(sceneWith([entity]));
    const first = binder.getObject(entity.entity.id)?.children.find((child) => 'isLight' in child);

    const edited = structuredClone(entity);
    (edited.components[0] as LightComponent).kind = 'spot';
    binder.sync(sceneWith([edited]));

    expect(binder.getObject(entity.entity.id)?.children.find((child) => 'isLight' in child)).not.toBe(first);
  });

  it('frees the light when its entity goes', () => {
    const entity = createLightEntity('directional');
    const binder = binderWith();
    binder.sync(sceneWith([entity]));
    const watched = watch(binder, entity.entity.id);

    binder.sync(sceneWith([]));
    // Retired, not freed: a buffer the in-flight frame may still be encoding.
    expect(watched.disposed).toBe(0);
    binder.beginFrame();
    expect(watched.disposed).toBe(1);
  });
});

/*
 * B6 — the retire queue is a frame-scale idea, and `sync` is neither once per
 * frame nor guaranteed to happen.
 */
describe('when retired objects are freed', () => {
  it('waits for a frame boundary rather than the next sync', () => {
    const cube = createMeshEntity('box');
    const binder = binderWith();
    binder.sync(sceneWith([cube]));
    expect(binder.poolSizes.geometries).toBe(1);

    binder.sync(sceneWith([]));
    binder.sync(sceneWith([]));
    // Two syncs in a row with no render between them is what `assetStore.refresh`
    // does — it fires two listeners back to back. Freeing on the second would
    // release a buffer the frame in flight is still encoding.
    expect(binder.poolSizes.geometries).toBe(0);

    binder.beginFrame();
    expect(binder.poolSizes.geometries).toBe(0);
  });
});

/** Identical cubes on a row: `MIN_BATCH_SIZE` of them form exactly one batch. */
function cubes(count: number, shadows = false) {
  return Array.from({ length: count }, (_, i) => {
    const cube = createMeshEntity('box');
    cube.entity.transform.position = [i % 2, 0.5, Math.floor(i / 2)];
    (cube.components[0] as MeshComponent).castShadow = shadows;
    (cube.components[0] as MeshComponent).receiveShadow = shadows;
    return cube;
  });
}

/** Off by default on the binder; the editor turns it on, so these must too. */
function batching(resolver: AssetResolver = { url: () => null }): SceneBinder {
  const binder = binderWith(resolver);
  binder.batching = true;
  return binder;
}

/**
 * The `BatchedMesh` objects the binder put in the graph.
 *
 * Typed structurally rather than by importing `BatchedMesh`: what these tests
 * assert is the configuration the batcher chose, and naming the class here would
 * only add an import that the assertions never use.
 */
interface Batch extends Object3D {
  material: Material;
  geometry: BufferGeometry;
  perObjectFrustumCulled: boolean;
  frustumCulled: boolean;
  sortObjects: boolean;
  instanceCount: number;
  maxInstanceCount: number;
  getMatrixAt(instanceId: number, matrix: Matrix4): Matrix4;
  setMatrixAt(instanceId: number, matrix: Matrix4): unknown;
  onBeforeRender(
    renderer: unknown,
    scene: unknown,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
  ): void;
  /** How many instances the last `onBeforeRender` decided to draw. */
  _multiDrawCount: number;
}

function batchesOf(binder: SceneBinder): Batch[] {
  const found: Batch[] = [];
  binder.root.traverse((object) => {
    if ('isBatchedMesh' in object) found.push(object as unknown as Batch);
  });
  return found;
}

/** The one batch a scene produced, which is what every case here builds. */
function batchOf(binder: SceneBinder): Batch {
  const found = batchesOf(binder);
  if (found.length !== 1) throw new Error(`expected one batch, found ${found.length}`);
  return found[0]!;
}

/** Where a batch actually draws one of its instances. */
function drawnAt(batch: Batch, slot: number): number[] {
  const matrix = new Matrix4();
  batch.getMatrixAt(slot, matrix);
  return new Vector3().setFromMatrixPosition(matrix).toArray();
}

/**
 * How many instances a batch would draw for this camera.
 *
 * `onBeforeRender` is where a `BatchedMesh` decides its multi-draw list, and it
 * needs nothing from the renderer or the scene — a camera, the geometry and the
 * material are the whole of what it reads. Which is what makes the decision
 * testable under Node, and the count it lands on is only readable on the object
 * itself.
 */
function instancesDrawnFor(batch: Batch, camera: Camera): number {
  batch.onBeforeRender(null, null, camera, batch.geometry, batch.material);
  return batch._multiDrawCount;
}

/**
 * The slot a batch holds an entity in, asked the only way a click can ask it.
 *
 * There is no index from entity to slot — `resolveBatchHit` is the one direction
 * that exists, because it is the one a raycast needs.
 */
function slotFor(binder: SceneBinder, batch: Batch, entityId: string): number | undefined {
  for (let slot = 0; slot < batch.maxInstanceCount; slot++) {
    if (binder.resolveBatchHit(batch, slot) === entityId) return slot;
  }
  return undefined;
}

/** The batch a group of cubes formed, told apart by the flag in their key. */
function batchFor(binder: SceneBinder, shadows: boolean): Batch {
  const found = batchesOf(binder).find((batch) => batch.castShadow === shadows);
  if (!found) throw new Error(`no batch with castShadow=${shadows}`);
  return found;
}

/** The same cubes, with one of them no longer casting or taking a shadow. */
function withoutShadows(field: ReturnType<typeof cubes>, index: number) {
  return field.map((cube, at) => {
    if (at !== index) return cube;
    const moved = structuredClone(cube);
    (moved.components[0] as MeshComponent).castShadow = false;
    (moved.components[0] as MeshComponent).receiveShadow = false;
    return moved;
  });
}

/** A camera pointing away from everything these tests build. */
function cameraLookingAway(): Camera {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, -1000);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return camera;
}

/*
 * A `BatchedMesh` keeps one multi-draw list for the whole frame and rebuilds it
 * in `onBeforeRender` — once per camera. The six faces of a point light's shadow
 * map each overwrite it, and the last one decides what the colour pass draws.
 * With a light above four cubes the list came out empty and every cube vanished.
 */
describe('batching a scene that casts shadows', () => {
  const fourCubes = () => cubes(4, true);

  it('culls per instance while nothing casts a shadow', () => {
    const binder = batching();
    binder.sync(sceneWith(fourCubes()));

    // The case the batch was built for: a large static field, one draw, and
    // instances outside the view skipped.
    expect(batchesOf(binder)).toHaveLength(1);
    expect(batchesOf(binder)[0]?.perObjectFrustumCulled).toBe(true);
  });

  it('gives up per-instance culling once a light casts a shadow', () => {
    const field = fourCubes();
    const light = createLightEntity('point');
    (light.components[0] as LightComponent).castShadow = true;

    const binder = batching();
    binder.sync(sceneWith([...field, light]));

    expect(batchesOf(binder)[0]?.perObjectFrustumCulled).toBe(false);
  });

  it('changes its mind when the light stops casting', () => {
    const field = fourCubes();
    const light = createLightEntity('point');
    (light.components[0] as LightComponent).castShadow = true;

    const binder = batching();
    binder.sync(sceneWith([...field, light]));
    expect(batchesOf(binder)[0]?.perObjectFrustumCulled).toBe(false);

    const off = structuredClone(light);
    (off.components[0] as LightComponent).castShadow = false;
    binder.sync(sceneWith([...field, off]));

    // Decided every sync: adding or editing a light changes the answer without
    // changing any batch's membership.
    expect(batchesOf(binder)[0]?.perObjectFrustumCulled).toBe(true);
  });

  it('forgets a shadow caster that was deleted', () => {
    const field = fourCubes();
    const light = createLightEntity('point');
    (light.components[0] as LightComponent).castShadow = true;

    const binder = batching();
    binder.sync(sceneWith([...field, light]));
    binder.sync(sceneWith(field));

    expect(batchesOf(binder)[0]?.perObjectFrustumCulled).toBe(true);
  });
});

/*
 * A batch is kept or thrown away on one question — "are these the same meshes?"
 * — and that question is blind to everything that changes around them. What
 * they point at, where they have moved to, and what three cached about them the
 * first time it drew them. Every case below is one of those blind spots.
 */
describe('what a batch has to notice', () => {
  it('follows a shared material that was replaced under it', () => {
    const linked = [0, 1, 2, 3].map(() => meshLinkedTo('rock'));
    const binder = batching();
    const flat = createMaterial('#ffffff');

    binder.setMaterialLibrary({ rock: flat });
    binder.sync(sceneWith(linked));
    expect(batchOf(binder).material).toBe(meshOf(binder, linked[0]!.entity.id).material);

    // A texture slot, not a uniform: a node material with a different slot is a
    // different shader, so the pool swaps the object rather than patching it.
    // The asset id does not change, so neither does `batchKey` — and the meshes
    // survive every patch, so the group looks identical. Nothing in the regroup
    // could see this but the material itself.
    const textured: MaterialDef = { ...flat, colorMap: 'gravel' };
    const invalidated = binder.setMaterialLibrary({ rock: textured });
    binder.sync(sceneWith(linked), invalidated);

    // The old material is in the retire queue by now, and `beginFrame` will free
    // it. A batch still pointing at it draws with a destroyed pipeline.
    expect(batchOf(binder).material).toBe(meshOf(binder, linked[0]!.entity.id).material);
  });

  it('does not cull itself against bounds three computed once and cached', () => {
    const binder = batching();
    binder.sync(sceneWith(cubes(4)));

    /*
     * `setMatrixAt` writes the matrix texture and nothing else — not
     * `boundingSphere`, not `boundingBox`. `Frustum.intersectsObject` computes
     * the sphere the first time it needs one and keeps it for good, so a batch
     * whose instances then move is culled against where they used to be. Under
     * physics that means the whole field vanishing at once.
     *
     * The culling worth having is per instance, which recomputes bounds every
     * frame; the object-level test only ever repeated it, badly.
     */
    expect(batchOf(binder).frustumCulled).toBe(false);
  });

  it('moves the batched children of an entity that moved', () => {
    const parent = createEntity('Crates', []);
    const children = cubes(4).map((cube) => {
      cube.entity.parent = parent.entity.id;
      return cube;
    });
    parent.entity.children = children.map((cube) => cube.entity.id);

    const binder = batching();
    binder.sync(sceneWith([parent, ...children]));
    expect(drawnAt(batchOf(binder), 0)).toEqual([0, 0.5, 0]);

    // A transform patch names the entity it touched and nothing below it —
    // `affectedEntities` reads the id out of the patch path. The children's
    // world matrices do follow, but only the named entity's own slots were
    // written, so the batch kept drawing them where they were.
    const moved = structuredClone(parent);
    moved.entity.transform.position = [10, 0, 0];
    binder.sync(sceneWith([moved, ...children]), new Set([parent.entity.id]));

    expect(drawnAt(batchOf(binder), 0)).toEqual([10, 0.5, 0]);
  });

  it('leaves the multi-draw list alone once it is built', () => {
    const binder = batching();
    binder.sync(sceneWith(cubes(4)));

    /*
     * `onBeforeRender` returns early only when visibility, per-instance culling
     * and sorting are all off (`BatchedMesh.js:1522`). Sorting is on by default,
     * so it rebuilt the list for every camera — including the six faces of a
     * point light's shadow map, which is the whole of B15. Front-to-back order
     * buys nothing for the opaque geometry this batches.
     */
    expect(batchOf(binder).sortObjects).toBe(false);
  });

  it('draws everything again when a shadow takes per-instance culling away', () => {
    const field = cubes(4);
    const binder = batching();
    binder.sync(sceneWith(field));

    const batch = batchOf(binder);
    const away = cameraLookingAway();
    expect(instancesDrawnFor(batch, away)).toBe(0);

    // Culling off, so all four must come back — and the flag alone cannot say
    // so: with sorting off as well, `onBeforeRender` returns before it looks at
    // it, and the empty list from the culled pass would stand for good.
    const light = createLightEntity('point');
    (light.components[0] as LightComponent).castShadow = true;
    binder.sync(sceneWith([...field, light]));

    expect(batch.perObjectFrustumCulled).toBe(false);
    expect(instancesDrawnFor(batch, away)).toBe(4);
  });

  it('hands a member to another batch without drawing it twice', () => {
    /*
     * Two batches that already exist, and a mesh that moves from one to the
     * other — `castShadow` is in `batchKey`, so flipping it is enough.
     *
     * The regroup walks the batches in creation order, so the batch that
     * *gains* the mesh is visited first here, and the one that loses it second.
     * Giving the mesh its visibility back at that point undoes what the new
     * batch just did: it would be drawn by itself *and* as an instance, and
     * with `slotOf` cleared its instance would never move again.
     *
     * The old code could not reach this — any membership change disposed both
     * batches and rebuilt them from scratch. Making membership incremental took
     * that accidental safety away.
     */
    const plain = cubes(4, false);
    const shadowed = cubes(5, true);
    const binder = batching();
    // Plain first, so its batch is created first and refit first.
    binder.sync(sceneWith([...plain, ...shadowed]));

    expect(batchFor(binder, false).instanceCount).toBe(4);
    expect(batchFor(binder, true).instanceCount).toBe(5);

    // Not the first of its group: the batch adopted *that* one's material, so
    // moving it fails the material check and rebuilds — which is the safe path
    // and hides the one under test. The second has no such privilege.
    const migrant = shadowed[1]!;
    binder.sync(sceneWith([...plain, ...withoutShadows(shadowed, 1)]));

    expect(batchFor(binder, false).instanceCount).toBe(5);
    expect(batchFor(binder, true).instanceCount).toBe(4);
    // Its batch draws it now, so it must not draw itself as well.
    expect(meshOf(binder, migrant.entity.id).visible).toBe(false);
    // And the batch that took it must still answer for it, or the click that
    // lands on it selects nothing and its matrix is never written again.
    expect(slotFor(binder, batchFor(binder, false), migrant.entity.id)).toBeDefined();
  });

  it('hands a member over even when the batch it leaves is torn down', () => {
    // The same hazard through the other door: the mesh the departing batch had
    // taken its material from is the one that leaves, so that batch cannot be
    // refitted and is disposed instead — and disposal hands its members back
    // exactly as the refit does.
    const plain = cubes(4, false);
    const shadowed = cubes(4, true);
    const binder = batching();
    binder.sync(sceneWith([...plain, ...shadowed]));

    const migrant = shadowed[0]!;
    binder.sync(sceneWith([...plain, ...withoutShadows(shadowed, 0)]));

    expect(batchFor(binder, false).instanceCount).toBe(5);
    // Three left behind is under `MIN_BATCH_SIZE`, so nothing replaces it.
    expect(batchesOf(binder)).toHaveLength(1);
    expect(meshOf(binder, migrant.entity.id).visible).toBe(false);
    expect(slotFor(binder, batchFor(binder, false), migrant.entity.id)).toBeDefined();
  });

  it('keeps resolving a click after a member left and another took its slot', () => {
    const field = cubes(6);
    const binder = batching();
    binder.sync(sceneWith(field));

    const batch = batchOf(binder);
    const gone = field[2]!.entity.id;
    const arrival = cubes(1)[0]!;

    // `addInstance` reuses freed ids first, so the newcomer lands in the slot
    // the departure left. A stale `bySlot` entry there would hand every click on
    // it the id of an entity the document no longer holds.
    binder.sync(sceneWith([...field.filter((cube) => cube.entity.id !== gone), arrival]));
    expect(batchOf(binder)).toBe(batch);

    for (const cube of [...field.filter((c) => c.entity.id !== gone), arrival]) {
      const slot = [...Array(batch.maxInstanceCount).keys()].find(
        (candidate) => binder.resolveBatchHit(batch, candidate) === cube.entity.id,
      );
      expect(slot).toBeDefined();
    }
    // And nothing still answers for the entity that left.
    const orphaned = [...Array(batch.maxInstanceCount).keys()].some(
      (slot) => binder.resolveBatchHit(batch, slot) === gone,
    );
    expect(orphaned).toBe(false);
  });

  it('adds and removes instances instead of rebuilding the whole batch', () => {
    const field = cubes(6);
    const binder = batching();
    binder.sync(sceneWith(field));

    const before = batchOf(binder);
    expect(before.instanceCount).toBe(6);
    // Room to grow, or placing one more object rebuilds the batch.
    expect(before.maxInstanceCount).toBeGreaterThan(6);

    const grown = [...field, ...cubes(1)];
    binder.sync(sceneWith(grown));
    expect(batchOf(binder)).toBe(before);
    expect(before.instanceCount).toBe(7);

    binder.sync(sceneWith(grown.slice(0, 5)));
    expect(batchOf(binder)).toBe(before);
    expect(before.instanceCount).toBe(5);
  });

  it('leaves the matrices of the crates already there alone when one is placed', () => {
    const field = cubes(6);
    const binder = batching();
    binder.sync(sceneWith(field));

    const batch = batchOf(binder);
    const settled = field.map((cube) => slotFor(binder, batch, cube.entity.id));
    const written = vi.spyOn(batch, 'setMatrixAt');

    // The dirty set an editor placement produces: the new entity, and nothing
    // else. `affectedEntities` reads the id straight out of the patch path.
    const arrival = cubes(1);
    binder.sync(sceneWith([...field, ...arrival]), new Set([arrival[0]!.entity.id]));

    /*
     * Only the new slot holds an identity matrix. The six that were already
     * there hold the matrices they held — `deleteInstance` never moves an id —
     * and rewriting them is not free: `setMatrixAt` raises `needsUpdate`, and
     * three re-uploads the whole matrix texture, 246KB for a field of three
     * thousand, to place one crate.
     */
    const touched = written.mock.calls.map(([slot]) => slot);
    for (const slot of settled) expect(touched).not.toContain(slot);
    expect(touched).toContain(slotFor(binder, batch, arrival[0]!.entity.id));
  });

  it('takes a batched member out of the raycast, and gives it back', () => {
    const field = cubes(4);
    const binder = batching();
    binder.sync(sceneWith(field));

    /*
     * `visible` is not enough. Three's raycaster tests `layers` and nothing
     * else — `Raycaster.js` gates `object.raycast` on `layers.test` alone — so
     * the hidden members of a batch were each answering a hit test that
     * `Picker` sorted by distance and then threw away, on top of the batch's own
     * instances. Twice the work per click, all of it wasted.
     */
    const member = meshOf(binder, field[0]!.entity.id);
    expect(member.layers.test(new Layers())).toBe(false);

    binder.batching = false;
    binder.sync(sceneWith(field));
    expect(member.layers.test(new Layers())).toBe(true);
  });

  it('batches again after batching is turned off and back on', () => {
    const scene = sceneWith(cubes(4));
    const binder = batching();
    binder.sync(scene);
    expect(batchesOf(binder)).toHaveLength(1);

    binder.batching = false;
    binder.sync(scene);
    expect(batchesOf(binder)).toHaveLength(0);

    // Taking the batches down says nothing about what the groups should hold, so
    // the regroup that follows has to run rather than trust its last answer.
    binder.batching = true;
    binder.sync(scene);
    expect(batchesOf(binder)).toHaveLength(1);
  });
});

/*
 * The sky, and the one rule that makes it appear at all.
 *
 * `HDRLoader` and `EXRLoader` return a texture before they have read a byte,
 * and the placeholder they return is 1x1. three tests an equirectangular
 * texture for readiness with `image.height > 0` — `CubeMapNode` before turning
 * it into a cubemap for the background, `PMREMNode` before prefiltering it for
 * the lighting — so 1x1 reads as ready. Both then build from one pixel and
 * cache the result against the texture object, and neither cache is keyed on
 * anything that moves when the real pixels land. The sky is black for good.
 *
 * So the binder must not hand over a texture that is not ready. That is the
 * rule below; the two caches are three's and cannot be asserted from here.
 */
describe('an equirectangular image that is still decoding', () => {
  function skyScene(assetId: string) {
    const scene = sceneWith([]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = assetId;
    scene.environment.environmentMode = 'texture';
    scene.environment.environmentTexture = assetId;
    return scene;
  }

  it('leaves the background on its colour until the pixels have landed', () => {
    const texture = new Texture();
    vi.spyOn(ModelCache.prototype, 'instanceTexture').mockReturnValue(texture);
    const ready = vi.spyOn(ModelCache.prototype, 'textureReady').mockReturnValue(false);

    const binder = binderWith({ url: () => 'studio-asset://project/sky.hdr' });
    const target = new Scene();
    const scene = skyScene('sky-1');

    binder.syncEnvironment(target, scene);
    // Not the texture: handing it over now is what poisons three's caches with
    // a one-pixel image, and no later update takes that back.
    expect(target.background).toBeInstanceOf(Color);
    expect(target.environment).toBeNull();

    ready.mockReturnValue(true);
    binder.syncEnvironment(target, scene);
    expect(target.background).toBe(texture);
    expect(target.environment).toBe(texture);
  });

  it('keeps showing the old sky while the next one decodes', () => {
    const first = new Texture();
    const second = new Texture();
    vi.spyOn(ModelCache.prototype, 'instanceTexture').mockImplementation((assetId) =>
      assetId === 'sky-1' ? first : second,
    );
    const ready = vi
      .spyOn(ModelCache.prototype, 'textureReady')
      .mockImplementation((assetId) => assetId === 'sky-1');
    vi.spyOn(ModelCache.prototype, 'whenTextureReady').mockResolvedValue(undefined);

    const binder = binderWith({ url: () => 'studio-asset://project/sky.hdr' });
    const target = new Scene();
    binder.syncEnvironment(target, skyScene('sky-1'));
    expect(target.background).toBe(first);

    // Switching to an image that has not arrived must not flash the clear
    // colour — the sky that is up stays up until there is one to replace it.
    binder.syncEnvironment(target, skyScene('sky-2'));
    expect(target.background).toBe(first);

    ready.mockReturnValue(true);
    binder.syncEnvironment(target, skyScene('sky-2'));
    expect(target.background).toBe(second);
  });
});
