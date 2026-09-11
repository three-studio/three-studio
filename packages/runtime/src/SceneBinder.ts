import {
  SUN_FROM_SKY,
  componentsOf,
  findComponent,
  skySunDirection,
  type ComponentDoc,
  type EntityDoc,
  type MaterialDef,
  type RenderingSettings,
  type SceneDoc,
  type Vec3,
} from '@three-studio/core';
import {
  Group,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Renderer,
} from 'three/webgpu';
import type { AssetResolver } from './assets/AssetResolver';
import { EnvironmentBinder } from './EnvironmentBinder';
import { ModelCache } from './assets/ModelCache';
import type { ModelShape } from './assets/modelNodes';
import { Reconciler } from './Reconciler';
import type { Sun, SystemContext, SystemHandle } from './systems/ComponentSystem';
import { ENTITY_ID_KEY, resolveEntityId } from './systems/identity';
import { buildMaterial, patchMaterial, sameTextureSlots } from './systems/material';
import { MeshBatcher } from './MeshBatcher';
import { ResourceArena, SharedMaterial } from './systems/ResourceArena';
import { studioTime, type StudioTime } from './time/StudioTime';

export { isVisibleInHierarchy } from './MeshBatcher';

/**
 * Whether what a view holds still matches the document, element by element.
 *
 * Not identity of the array — there is no array in the document to compare
 * against since phase 10. `componentsOf` builds a fresh one per call, so
 * comparing its identity would differ every sync and rebuild the whole scene
 * every frame. The elements still carry immer's identity, and that is what this
 * uses.
 */
function sameComponents(a: readonly ComponentDoc[], b: readonly ComponentDoc[]): boolean {
  return a.length === b.length && a.every((component, index) => component === b[index]);
}

export { ENTITY_ID_KEY } from './systems/identity';

/** Scratch for `sunOf`'s basis extraction. Module-scope so it allocates once. */
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();


/**
 * Projects a `SceneDoc` onto a three.js scene graph and keeps it in sync.
 *
 * The document is authoritative; every object here is derived and disposable.
 * That is what lets undo, save/load and the play-mode snapshot work without any
 * of them knowing about three.js.
 *
 * Since phase 11 this is a **coordinator**, not the whole layer. What a
 * component draws belongs to its system (`systems/`), what it holds on the GPU
 * belongs to the arena, pairing the two against the document belongs to the
 * `Reconciler`, and everything that belongs to no entity at all — the
 * background, the lighting, the sky, the fog — belongs to `EnvironmentBinder`.
 * What is left here is what none of them can answer alone: the hierarchy of
 * containers, and the batching, which reads every mesh in the scene at once.
 *
 * Change detection is by object identity: immer preserves the identity of
 * anything a mutation did not touch, so a moved entity re-reads its transform
 * without rebuilding its geometry.
 */
export interface SceneBinderOptions {
  resolver: AssetResolver;
  /**
   * The project's rendering settings, whole.
   *
   * Whole rather than the two fields the binder reads, so that adding a
   * rendering setting is a change to `createRenderingSettings` and to whoever
   * reads it — not a new parameter threaded through every call site.
   */
  rendering: RenderingSettings;
  /**
   * Shared materials by asset id.
   *
   * Here rather than pushed in afterwards because a mesh is built
   * synchronously: a table that arrives after the first sync arrives after
   * every linked material has already fallen back to its embedded copy, which
   * is what play mode did until it was passed one.
   */
  materials?: Readonly<Record<string, MaterialDef>>;
  /**
   * The device an analytic sky is captured on.
   *
   * Read once, into `EnvironmentBinder`, where it is `readonly`: the device has
   * to be in hand before the environment is built, and that is now a property
   * of the constructor rather than an order to remember. See constraint 2 on
   * `bindScene`.
   */
  renderer?: Renderer | null;
  /**
   * Injected rather than reached for, so a test can drive the clock it hands
   * in. The default is the document's own — see `time/StudioTime`.
   */
  time?: StudioTime;
}

/**
 * Builds a binder and puts a document into a scene, in the order that works.
 *
 * The order is the reason this exists, and it is four constraints rather than a
 * preference. Each was paid for once:
 *
 * 1. **Materials before the first sync.** A mesh is built synchronously, so a
 *    material table handed over later is handed over after every linked
 *    material has already fallen back to its embedded copy — silently, and
 *    looking merely wrong rather than broken.
 * 2. **Renderer before the environment.** Capturing an analytic sky into a
 *    cubemap is six draw calls, so the device has to be in hand before the
 *    environment is built and not merely before the first frame is drawn.
 * 3. **Entities before the environment.** The environment reads the world
 *    matrices the sync has just written, and `sunOf` answers off the lights the
 *    sync has just bound.
 * 4. **Environment last**, which is 2 and 3 together.
 *
 * Written down here rather than left as the order of four statements in
 * `Engine`'s constructor, because it is a constraint on *this* class's methods:
 * a reader of `SceneBinder` should not have to find a caller to learn which of
 * its methods may not be called first.
 */
export function bindScene(scene: Scene, doc: SceneDoc, options: SceneBinderOptions): SceneBinder {
  const binder = new SceneBinder(options);
  scene.add(binder.root);
  binder.sync(doc);
  binder.syncEnvironment(scene, doc);
  return binder;
}

export class SceneBinder {
  /** Parent this into the editor viewport scene or the runtime scene. */
  readonly root = new Group();

  private readonly reconciler = new Reconciler();
  private readonly arena = new ResourceArena();
  private readonly models: ModelCache;
  /** Shared materials by asset id; see `setMaterialLibrary`. */
  private materials: Readonly<Record<string, MaterialDef>> = {};
  /**
   * Per-light shadow map resolution, from the project settings. Square and a
   * power of two; 4096 costs four times the memory of 2048.
   *
   * Read once, at construction, because that is already when it was read — the
   * viewport assigned it in its constructor and nothing ever wrote it again.
   * `readonly` only says so. It was also the one setting nothing outside the
   * editor ever wrote at all, which is how a project asking for 4096 got 4096 in
   * the Scene view, 2048 the moment Play was pressed, and 2048 in the build.
   */
  readonly shadowMapSize: number;
  /**
   * Entities whose light casts a shadow. Empty means per-instance culling is
   * safe; see `createBatch`.
   */
  private readonly shadowCasters = new Set<string>();
  /** Entities detached by a removal, to be re-parented from the document. */
  private readonly orphaned = new Set<string>();

  /**
   * Draws what can be drawn together. On or off by the project's settings, the
   * same answer in the editor as in the game: a batch is one `Object3D`, but
   * `resolveBatchHit` turns a click on it back into the instance it landed on,
   * and the outline and the gizmo work off the entity's container, which a
   * batched mesh still hangs from.
   */
  private readonly batcher = new MeshBatcher(
    this.root,
    this.reconciler,
    this.arena,
    this.shadowCasters,
  );

  /**
   * Read-only, and set once from the settings handed in.
   *
   * It was a public setter written by both call sites, in two orders, and the
   * two agreed only because two separately written defaults happened to say the
   * same thing. Nothing in the product ever changed it after construction, so
   * nothing loses a capability here — see `bindScene`.
   */
  get batching(): boolean {
    return this.batcher.enabled;
  }

  /** Writes the world matrices of what moved into the batches holding it. */
  updateBatches(only?: ReadonlySet<string>): void {
    this.batcher.updateBatches(only);
  }

  /** The entity a click on a batch landed on. */
  resolveBatchHit(object: Object3D, batchId: number): string | undefined {
    return this.batcher.resolveBatchHit(object, batchId);
  }

  private readonly time: StudioTime;

  /**
   * Everything the binder is configured with, at the one moment it is
   * configured.
   *
   * `rendering` is required rather than defaulted, and that is the whole
   * mechanism: a default here is a second answer to a question the project has
   * already answered, and a second answer is what put 4096 in the viewport and
   * 2048 in the game.
   */
  constructor(options: SceneBinderOptions) {
    this.root.name = 'SceneRoot';
    this.time = options.time ?? studioTime;
    this.models = new ModelCache(options.resolver);
    this.shadowMapSize = options.rendering.shadowMapSize;
    this.batcher.enabled = options.rendering.batching;
    // Given the arena rather than one of its own: what it lets go of has to
    // land in the same retire queue the systems use. See `ResourceArena`.
    this.environment = new EnvironmentBinder(this.models, this.arena, options.renderer ?? null);
    // Before any sync, which is the ordering `bindScene` exists to hold: a mesh
    // is built synchronously, so a table that arrives afterwards has already
    // been fallen back from.
    if (options.materials) this.setMaterialLibrary(options.materials);
  }

  /**
   * What every system may reach.
   *
   * Rebuilt per access rather than held, because `materials` and
   * `shadowMapSize` are settings that change under it — a context captured once
   * would hand a system last week's material table.
   */
  private get context(): SystemContext {
    return {
      arena: this.arena,
      materials: this.materials,
      models: this.models,
      time: this.time,
      shadowMapSize: this.shadowMapSize,
      sunOf: (source: string) => this.sunOf(source),
      invalidate: () => {
        this.batcher.invalidate();
      },
      attach: (entityId: string, handle: SystemHandle, object: Object3D) =>
        this.reconciler.attachLate(entityId, handle, object),
    };
  }

  /** Called when a project opens, and when its asset manifest changes. */
  setAssetResolver(resolver: AssetResolver): void {
    // Before the cache is told, because `setResolver` disposes every texture
    // master and our environment maps are clones sharing those images. Held on
    // to, they would be handed back by `equirectangular`'s "same asset id"
    // shortcut — a sky that is now a disposed image. The models below are
    // invalidated for the same reason; the environment was simply left out.
    this.environment.release();
    this.models.setResolver(resolver);
    // Everything loaded through the resolver has to be built again against the
    // new one, so the entities holding such a build are marked for a full
    // remount on the next sync.
    for (const entityId of this.reconciler.entitiesThatLoad()) {
      const view = this.reconciler.view(entityId);
      if (view) view.components = [];
    }
  }

  /**
   * Replaces the shared material table.
   *
   * Materials are pushed in rather than fetched per reference because a mesh is
   * built synchronously — an awaited material would leave it untextured for a
   * frame. Every mesh bound to an asset is invalidated, which is what makes one
   * edit to a shared material reach all of its users.
   */
  /**
   * @returns The entity ids whose bindings this invalidated, so the caller can
   *   sync exactly those. Handing back `undefined` — "reconcile everything" —
   *   was costing a full pass over the scene per material tint.
   */
  setMaterialLibrary(materials: Readonly<Record<string, MaterialDef>>): ReadonlySet<string> {
    const previous = this.materials;
    this.materials = materials;

    /*
     * Reconciled here, once per asset.
     *
     * Each mesh used to do this for itself inside `buildMaterialFor`, holding
     * its own stale `previous`. So for N meshes on one asset, N of them took the
     * "the definition changed" branch and each called `SharedPool.replace`, which
     * unconditionally frees whatever the key currently holds: mesh 1 built M2 and
     * retired M1, mesh 2 saw a stale previous too, built M3 and retired **M2** —
     * the material mesh 1 had just adopted. Meshes 1..N-1 ended up holding
     * materials already in the retire queue, and the batch held the very first
     * one freed. That is the `setIndexBuffer: parameter 1 is not of type
     * GPUBuffer` class of failure, reached through another door.
     *
     * One pass, one decision per asset. It also turns N pipeline compilations
     * into one, which was the entire point of pooling them.
     */
    for (const [assetId, definition] of Object.entries(materials)) {
      const shared = this.arena.peekMaterial(assetId);
      // Not in the pool yet — nothing is using it, and the first mesh that does
      // will build it. `setMaterialLibrary` also runs at startup, when the pool
      // is empty and there is nothing to patch.
      if (!shared) continue;

      const before = previous[assetId];
      if (before === definition) continue;

      if (before !== undefined && sameTextureSlots(before, definition)) {
        // Uniforms only: patched in place, so every mesh naming this asset
        // follows without a single rebuild.
        patchMaterial(shared.material, shared.textures, definition);
      } else {
        // A slot changed, and a node material with a different texture slot is
        // a different shader pipeline. Replaced once, here.
        this.arena.replaceMaterial(assetId, new SharedMaterial(buildMaterial(definition, this.models)));
      }
    }

    // Still invalidated, so each mesh re-reads the material the pool now holds —
    // but by `peek`, never by rebuilding.
    const invalidated = this.reconciler.entitiesUsingMaterialAssets();
    for (const id of invalidated) {
      const view = this.reconciler.view(id);
      // `[]` never matches, so the next sync reconciles this entity.
      if (view) view.components = [];
    }
    return invalidated;
  }


  /**
   * @param dirty Entity ids to re-read. A set containing `'*'`, or `undefined`,
   *   forces a full reconcile (initial load, undo of a structural change).
   */
  /**
   * Frees what the previous frame let go of. Call once per rendered frame.
   *
   * The queue now lives in the arena. This used to hang off `sync`,
   * whose comment claimed the queue was "a frame old now" — true only if syncs
   * come one per frame, and two paths break that in opposite directions.
   */
  beginFrame(): void {
    this.arena.flush();
  }

  sync(scene: SceneDoc, dirty?: ReadonlySet<string>): void {
    // Held for `sunOf`, which answers about the scene rather than about one
    // entity and so cannot be given its subject as an argument.
    this.scene = scene;
    const full = dirty === undefined || dirty.has('*');
    const ids = full
      ? new Set([...Object.keys(scene.entities), ...this.reconciler.all().keys()])
      : dirty;

    for (const id of ids) {
      const entity = scene.entities[id];
      if (!entity) {
        this.removeEntity(id);
        continue;
      }
      this.syncEntity(entity, componentsOf(scene, id));
    }

    // Parenting is resolved after every entity exists, so an entity created
    // before its parent in the same batch still lands in the right place.
    for (const id of ids) {
      const entity = scene.entities[id];
      if (entity) this.attachToParent(entity);
    }

    // And whatever a removal detached along the way, whether or not this sync
    // was told those entities were dirty.
    for (const id of this.orphaned) {
      const entity = scene.entities[id];
      if (entity) this.attachToParent(entity);
    }
    this.orphaned.clear();

    this.batcher.sync(full, ids);
  }

  /** The last document synced, for the scene-wide questions a system may ask. */
  private scene: SceneDoc | null = null;

  /**
   * The background, the lighting, the sky and the fog — none of which is an
   * entity, and all of which used to be here.
   *
   * Its own class rather than a region of this one: it shares the model cache
   * and the retire queue with the projection and nothing else, and it holds a
   * `Scene` where the projection holds a document. Declared as `readonly` so
   * that "one binder, one scene" stays a property of both.
   */
  private readonly environment: EnvironmentBinder;

  /**
   * @param doc Only its `environment` is read; the whole document is taken so
   *   that the call reads the same as `sync` at the site that pairs them.
   */
  syncEnvironment(scene: Scene, doc: SceneDoc): void {
    this.environment.sync(scene, doc.environment);
  }


  getObject(entityId: string): Object3D | undefined {
    return this.reconciler.view(entityId)?.container;
  }

  /**
   * The objects one component built, so an editor overlay can annotate them.
   *
   * Nothing else may hold on to what comes back: a system answering `'remount'`
   * replaces its objects, and the identity of this array's first element is
   * exactly how a caller notices.
   */
  objectsFor(entityId: string, componentId: string): readonly Object3D[] {
    return this.reconciler.objectsOf(entityId, componentId);
  }

  /**
   * The object carrying an entity's world transform, for a component that built
   * nothing to hang an annotation on.
   *
   * An audio source is the case: it holds a voice, not an `Object3D`, so
   * `objectsFor` answers empty and an overlay that only knows how to anchor on
   * what a system built has nowhere to draw. The container is the honest anchor
   * — it is where the entity *is* — and its identity is stable for as long as
   * the entity exists, which keeps the overlay's "rebuild when the source
   * changes" rule working unchanged.
   */
  containerFor(entityId: string): Object3D | undefined {
    return this.reconciler.peekContainer(entityId);
  }

  /**
   * Where a self-shading component takes its light from. See `SystemContext`.
   *
   * The sky's sun is a pure function of the document. A light's is not: it is
   * aimed along its entity's world -Z (see `aimAlongLocalForward` in
   * `LightSystem`), so the answer is the container's matrix, which three has
   * already composed. Resolved per sync rather than per frame — a sync is what
   * a gizmo drag produces, so the water still follows a light being moved.
   */
  private sunOf(source: string): Sun | null {
    const scene = this.scene;
    if (!scene) return null;

    if (source === SUN_FROM_SKY) {
      return { direction: skySunDirection(scene.environment.sky), color: '#ffffff' };
    }

    const light = findComponent(scene, source, 'light');
    const container = this.reconciler.peekContainer(source);
    if (!light || !container) return null;

    // +Z, because the light shines along -Z and `sunDirection` points back at
    // it. `matrixWorld` carries the scale too, so the basis is normalised.
    container.matrixWorld.extractBasis(_x, _y, _z);
    _z.normalize();
    const direction: Vec3 = [_z.x, _z.y, _z.z];
    return { direction, color: light.color };
  }

  /** Walks up from a raycast hit to the entity that owns it. */
  static resolveEntityId(object: Object3D | null): string | undefined {
    return resolveEntityId(object);
  }

  /**
   * The nodes a model file turned out to have, as plain data.
   *
   * Here rather than as a load of its own in the editor, and the reason is
   * correctness before convenience: the paths this hands back are indices into
   * the tree **as the import settings dress it**, which is what
   * `ModelSystem` will resolve them against. A second, undressed load would
   * produce paths that point at different nodes — and the failure would be an
   * unpacked model whose pieces are the wrong pieces, which reads as a corrupt
   * file rather than as a mismatch.
   */
  modelShape(assetId: string): Promise<ModelShape> {
    return this.models.modelShape(assetId);
  }

  /** Every camera the document defines, for play mode to choose from. */
  collectCameras(scene: SceneDoc): { entityId: string; camera: PerspectiveCamera | OrthographicCamera; isMain: boolean }[] {
    const cameras: { entityId: string; camera: PerspectiveCamera | OrthographicCamera; isMain: boolean }[] = [];
    for (const [id, view] of this.reconciler.all()) {
      if (!scene.entities[id]) continue;
      const component = findComponent(scene, id, 'camera');
      if (!component) continue;
      const camera = view.container.children.find(
        (object): object is PerspectiveCamera | OrthographicCamera =>
          object instanceof PerspectiveCamera || object instanceof OrthographicCamera,
      );
      if (camera) cameras.push({ entityId: id, camera, isMain: component.isMain });
    }
    return cameras;
  }

  /**
   * Resolves once no glTF is still loading.
   *
   * Physics is built from the objects the binder made, and a model arrives
   * after `sync` returns. Building before that gave an imported level a
   * collider derived from an empty group — a 3cm box the player fell straight
   * past. Rejections are already handled at the load site, so this settles
   * whether the models arrived or not: a broken asset must not hang play mode.
   */
  async whenLoaded(): Promise<void> {
    await this.reconciler.whenLoaded();
  }

  dispose(): void {
    this.batcher.clear();
    // The model cache was never touched here, so every Play → Stop cycle built a
    // fresh `SceneBinder` with a fresh `ModelCache`, re-downloaded every glTF,
    // and abandoned the previous one's buffers on the GPU.
    void this.models.clear();
    this.environment.dispose();
    this.reconciler.clear(this.context);
    // Belt to the braces, and last: every system released its share above, so
    // the pools are already empty unless a count went wrong — and everything up
    // to here retires rather than frees. Nothing is rendering any more, so there
    // is nothing left to wait for.
    this.arena.disposeAll();
    this.root.clear();
  }

  /** Distinct pooled resources, for tests and for the stats overlay. */
  get poolSizes(): { geometries: number; materials: number } {
    return this.arena.sizes;
  }


  /**
   * Brings one entity in line with the document: its objects, its name, its
   * visibility and its transform.
   *
   * The component list is compared **element by element**. There is no array in
   * the document to compare by identity since phase 10 — `componentsOf` builds a
   * fresh one per call — but immer still preserves the identity of every
   * component it did not touch, so this is exactly as precise as the old check.
   */
  private syncEntity(entity: EntityDoc, components: readonly ComponentDoc[]): void {
    const container = this.reconciler.containerFor(entity.id);
    const view = this.reconciler.view(entity.id);
    if (!view) return;

    if (!sameComponents(view.components, components)) {
      this.reconciler.reconcile(entity.id, components, this.context);
      // Tracked here rather than scanned per sync: this is the one place that
      // already knows an entity's components changed.
      const caster = components.some((c) => c.type === 'light' && c.castShadow);
      if (caster) this.shadowCasters.add(entity.id);
      else this.shadowCasters.delete(entity.id);
    }

    container.name = entity.name;
    if (container.visible !== entity.visible) {
      // Hidden meshes are left out of their group entirely, so this is a
      // membership change like any other.
      container.visible = entity.visible;
      this.batcher.invalidate();
    }

    if (view.transform !== entity.transform) {
      const { position, rotation, scale } = entity.transform;
      container.position.set(...position);
      container.rotation.set(...rotation);
      container.scale.set(...scale);
      view.transform = entity.transform;
    }
  }

  private attachToParent(entity: EntityDoc): void {
    const view = this.reconciler.view(entity.id);
    if (!view) return;

    let parent: Object3D = this.root;
    if (entity.parent !== null) {
      const bound = this.reconciler.view(entity.parent)?.container;
      if (bound) {
        parent = bound;
      } else if (import.meta.env?.DEV) {
        // Since phase 1 this is an impossible state: the tree layer refuses an
        // edge to an entity the document does not hold. Falling back to the root
        // in silence is exactly what hid it for months — an object visible and
        // clickable in the viewport and present in no branch of the hierarchy.
        console.warn(
          `[binder] "${entity.id}" names parent "${entity.parent}", which has no view; attached to the root.`,
        );
      }
    }
    if (view.container.parent !== parent) parent.add(view.container);
  }


  /**
   * Drops an entity the document no longer holds.
   *
   * Children are left where the document puts them, not moved here. Reparenting
   * a survivor onto the root was a decision about the three graph that the
   * document never made — and it outlives the sync, so the object stayed at the
   * root until something else touched it. Detaching the container is enough;
   * `attachToParent` re-reads the document for whatever is still in it.
   */
  private removeEntity(id: string): void {
    const view = this.reconciler.view(id);
    if (!view) return;

    this.shadowCasters.delete(id);
    this.batcher.invalidate();

    for (const child of [...view.container.children]) {
      if (child.parent !== view.container) continue;
      const owner: unknown = child.userData[ENTITY_ID_KEY];
      // Noted, because a detached child whose own entity is not in this sync's
      // dirty set would be reattached by nothing and simply vanish.
      if (typeof owner === 'string' && owner !== id) {
        child.removeFromParent();
        this.orphaned.add(owner);
      }
    }

    // The late arrival is now the reconciler's: a model that lands after this drops on the
    // floor, because the handle it was mounted under is no longer mounted.
    this.reconciler.remove(id, this.context);
    view.container.removeFromParent();
  }
}
