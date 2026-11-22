import {
  componentEntities,
  componentsOf,
  isEntityId,
  type AssetId,
  type ComponentDoc,
  type ComponentId,
  type ComponentTypeId,
  type CoreRegistries,
  type EntityDoc,
  type EntityId,
  type MaterialDef,
  type Registry,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { Group, Object3D, Scene, type Renderer } from 'three/webgpu';
import { EnvironmentBinder } from './EnvironmentBinder';
import type { AssetCache } from './assets/AssetCache';
import type { ModelShape } from './assets/modelNodes';
import { Reconciler } from './Reconciler';
import type { SystemContext, SystemDefinition, SystemHandle } from './systems/ComponentSystem';
import { ENTITY_ID_KEY, resolveEntityId } from './systems/identity';
import { buildMaterial, patchMaterial, sameTextureSlots } from './systems/material';
import { MeshBatcher } from './MeshBatcher';
import { ResourceArena, SharedMaterial } from './systems/ResourceArena';
import type { StudioTime } from './time/StudioTime';
import type { CameraClaims } from './world/cameras';
import type { SunService } from './world/sun';

export { isVisibleInHierarchy } from './MeshBatcher';

/**
 * Whether what a view holds still matches the document, element by element.
 *
 * Not identity of the array — there is no array in the document to compare
 * against since components moved into its tables. `componentsOf` builds a fresh
 * one per call, so comparing its identity would differ every sync and rebuild
 * the whole scene every frame. The elements still carry immer's identity, and
 * that is what this uses.
 */
function sameComponents(a: readonly ComponentDoc[], b: readonly ComponentDoc[]): boolean {
  return a.length === b.length && a.every((component, index) => component === b[index]);
}

export { ENTITY_ID_KEY } from './systems/identity';

/** What `namersOf` answers for an entity nothing names. */
const NO_NAMERS: ReadonlySet<EntityId> = new Set();

/** The entities a sync of the whole scene was told of: none, since it reads them all. */
const NOTHING: ReadonlySet<EntityId> = new Set();


/**
 * Projects a `SceneDoc` onto a three.js scene graph and keeps it in sync.
 *
 * The document is authoritative; every object here is derived and disposable.
 * That is what lets undo, save/load and the play-mode snapshot work without any
 * of them knowing about three.js.
 *
 * This is a **coordinator**, not the whole layer. What a component draws
 * belongs to its system (`systems/`), what it holds on the GPU belongs to the
 * arena, pairing the two against the document belongs to the `Reconciler`, and
 * everything that belongs to no entity at all — the background, the lighting,
 * the sky, the fog — belongs to `EnvironmentBinder`. What is left here is what
 * none of them can answer alone: the hierarchy of containers, and the batching,
 * which reads every mesh in the scene at once.
 *
 * Change detection is by object identity: immer preserves the identity of
 * anything a mutation did not touch, so a moved entity re-reads its transform
 * without rebuilding its geometry.
 */
export interface SceneBinderOptions {
  /**
   * What the binder reads of the registries: the system that draws each type,
   * from which each binder builds its own, and the order of the types.
   *
   * The core's registries and the systems, rather than the runtime's registries
   * by name: those name the behaviours, whose context holds a binder, and the
   * binder naming them back would close an import cycle. A window's or a page's
   * runtime registries are this, whole.
   */
  registries: CoreRegistries & { readonly systems: Registry<ComponentTypeId, SystemDefinition> };
  /**
   * The project's loaded files, shared by every world the window draws: the
   * edit view's binder and Play's hold the same model once. Held through, and
   * never freed here — the cache is its maker's, and so is its frame.
   */
  assets: AssetCache;
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
  materials?: ReadonlyMap<AssetId, MaterialDef> | undefined;
  /**
   * The device an analytic sky is captured on.
   *
   * Read once, into `EnvironmentBinder`, where it is `readonly`: the device has
   * to be in hand before the environment is built, and that is now a property
   * of the constructor rather than an order to remember. See constraint 2 on
   * `bindScene`.
   */
  renderer?: Renderer | null | undefined;
  /**
   * Who the view is drawn through: a camera component claims it as it mounts.
   * Its world's, handed in; a binder no world draws through, the edit view's,
   * is handed claims of its own that nothing reads.
   */
  cameras: CameraClaims;
  /**
   * Where what shades itself takes its light from: each light provides its own
   * as it mounts, the environment the sky's. Its world's, handed in.
   */
  sun: SunService;
  /**
   * The window's clock, which every node material and every system reads: made
   * by whoever owns the window's loop and handed in, never reached for, so two
   * worlds of one window read one time and a test drives the clock it hands in.
   */
  time: StudioTime;
  /**
   * Told when an object a system loaded lands on its entity, after the sync
   * that mounted it — a model. A running world hands that entity's components
   * back to its subsystems, so that what was built from the entity's objects,
   * a mesh collider, is built again from what landed.
   */
  landed?: ((entityId: EntityId) => void) | undefined;
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
 *    matrices the sync has just written. The sky's sun is the exception, read
 *    from the document at the start of each sync: a water lit by the sky reads
 *    it as it mounts.
 * 4. **Environment last**, which is 2 and 3 together.
 *
 * Written down here rather than left as the order of four statements in
 * `World`'s constructor, because it is a constraint on *this* class's methods:
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

  /** For the order an entity's components are read in, which is the order their types were registered in. */
  private readonly registries: CoreRegistries;
  private readonly reconciler: Reconciler;
  private readonly arena = new ResourceArena();
  /** The project's files, which this scene's systems and environment hold. */
  private readonly assets: AssetCache;
  /** Shared materials by asset id; see `setMaterialLibrary`. */
  private materials: ReadonlyMap<AssetId, MaterialDef> = new Map();
  /**
   * Per-light shadow map resolution, from the project settings. Square and a
   * power of two; 4096 costs four times the memory of 2048.
   *
   * Read once, at construction, because that is already when it was read — the
   * viewport assigned it in its constructor and nothing ever wrote it again.
   * `readonly` only says so. It was also the one setting nothing outside the
   * editor ever wrote at all, which is how a project asking for 4096 got 4096 in
   * the edit view, 2048 the moment Play was pressed, and 2048 in the build.
   */
  readonly shadowMapSize: number;
  /**
   * Entities whose light casts a shadow. Empty means per-instance culling is
   * safe; see `createBatch`.
   */
  private readonly shadowCasters = new Set<EntityId>();
  /** Entities detached by a removal, to be re-parented from the document. */
  private readonly orphaned = new Set<EntityId>();
  /**
   * Which entities hold a component naming each entity, by the entity named —
   * a water lit by a light —, and what each entity's components name: kept
   * from the components each sync reads, so that a change to the one is read
   * again by the other (`rereadNamers`). Its own change only: a light turned by
   * turning its parent changed nothing the document says of the light, and a
   * water lit by it is lit as it was.
   */
  private readonly namers = new Map<EntityId, Set<EntityId>>();
  private readonly named = new Map<EntityId, readonly EntityId[]>();
  /** The namers one sync reads again, gathered once each. */
  private readonly rereading = new Set<EntityId>();

  /**
   * Draws what can be drawn together. On or off by the project's settings, the
   * same answer in the editor as in the game: a batch is one `Object3D`, but
   * `resolveBatchHit` turns a click on it back into the instance it landed on,
   * and the outline and the gizmo work off the entity's container, which a
   * batched mesh still hangs from.
   */
  private readonly batcher: MeshBatcher;
  /** See `holdBatches`. */
  private batchesHeld = false;

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
  updateBatches(only?: ReadonlySet<EntityId>): void {
    this.batcher.updateBatches(only);
  }

  /** The entity a click on a batch landed on. */
  resolveBatchHit(object: Object3D, batchId: number): EntityId | undefined {
    return this.batcher.resolveBatchHit(object, batchId);
  }

  private readonly time: StudioTime;
  private readonly cameras: CameraClaims;
  private readonly sun: SunService;
  private readonly landed: ((entityId: EntityId) => void) | undefined;

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
    this.time = options.time;
    this.cameras = options.cameras;
    this.sun = options.sun;
    this.landed = options.landed;
    this.registries = options.registries;
    this.reconciler = new Reconciler(options.registries.systems);
    this.batcher = new MeshBatcher(this.root, this.reconciler, this.arena, this.shadowCasters);
    this.assets = options.assets;
    this.shadowMapSize = options.rendering.shadowMapSize;
    this.batcher.enabled = options.rendering.batching;
    // Given the arena rather than one of its own: what it lets go of has to
    // land in the same retire queue the systems use. See `ResourceArena`.
    this.environment = new EnvironmentBinder(this.assets, this.arena, options.renderer ?? null, options.sun);
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
      assets: this.assets,
      time: this.time,
      shadowMapSize: this.shadowMapSize,
      cameras: this.cameras,
      sun: this.sun,
      invalidate: () => {
        this.batcher.invalidate();
      },
      attach: (entityId: EntityId, handle: SystemHandle, object: Object3D) => {
        const taken = this.reconciler.attachLate(entityId, handle, object);
        if (taken) this.landed?.(entityId);
        return taken;
      },
    };
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
  setMaterialLibrary(materials: ReadonlyMap<AssetId, MaterialDef>): ReadonlySet<EntityId> {
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
    for (const [assetId, definition] of materials) {
      const shared = this.arena.peekMaterial(assetId);
      // Not in the pool yet — nothing is using it, and the first mesh that does
      // will build it. `setMaterialLibrary` also runs at startup, when the pool
      // is empty and there is nothing to patch.
      if (!shared) continue;

      const before = previous.get(assetId);
      if (before === definition) continue;

      if (before !== undefined && sameTextureSlots(before, definition)) {
        // Uniforms only: patched in place, so every mesh naming this asset
        // follows without a single rebuild.
        patchMaterial(shared.material, shared.textures, definition);
      } else {
        // A slot changed, and a node material with a different texture slot is
        // a different shader pipeline. Replaced once, here.
        this.arena.replaceMaterial(assetId, new SharedMaterial(buildMaterial(definition, this.assets)));
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
   * Frees what the previous frame let go of. Call once per rendered frame.
   *
   * The queue now lives in the arena. This used to hang off `sync`,
   * whose comment claimed the queue was "a frame old now" — true only if syncs
   * come one per frame, and two paths break that in opposite directions.
   *
   * The asset cache's frame is not begun here: the cache is the window's, and
   * the edit view's binder and Play's each begin a frame of their own.
   */
  beginFrame(): void {
    this.arena.flush();
  }

  /**
   * @param dirty Entity ids to re-read. `undefined` forces a full reconcile
   *   (initial load, undo of a structural change).
   */
  sync(scene: SceneDoc, dirty?: ReadonlySet<EntityId>): void {
    const ids = dirty ?? new Set([...scene.entities.keys(), ...this.reconciler.all().keys()]);
    this.draw(scene, ids);
    if (!this.batchesHeld) this.batcher.sync(dirty === undefined, ids);
  }

  /**
   * `sync` for `ids`, the batches left to the next sync: a running world draws
   * a spawn at its call, and its frame's pass, which syncs the spawn again,
   * groups what the frame placed in one go. A regroup walks every batchable
   * mesh the binder holds, and one at each call made a thousand placements in
   * a frame take a second rather than 60 ms.
   */
  draw(scene: SceneDoc, ids: ReadonlySet<EntityId>): void {
    // Before the entities: a water lit by the sky reads its sun as it mounts.
    this.environment.readSky(scene.environment);

    for (const id of ids) {
      const entity = scene.entities.get(id);
      if (!entity) {
        this.removeEntity(id);
        continue;
      }
      this.syncEntity(entity, componentsOf(this.registries, scene, id));
    }

    // Parenting is resolved after every entity exists, so an entity created
    // before its parent in the same batch still lands in the right place.
    for (const id of ids) {
      const entity = scene.entities.get(id);
      if (entity) this.attachToParent(entity);
    }

    // And whatever a removal detached along the way, whether or not this sync
    // was told those entities were dirty.
    for (const id of this.orphaned) {
      const entity = scene.entities.get(id);
      if (entity) this.attachToParent(entity);
    }
    this.orphaned.clear();

    // After the entities and their parents, so that what is read is where it
    // is now.
    this.rereadNamers(ids);
  }

  /**
   * Leaves the batches as they are at each sync, until `releaseBatches`: for a
   * document built a few entities a sync, which nobody draws until it is whole
   * — a world built behind a loading scene. A regroup walks every batchable
   * mesh the binder holds, and one a sync made two thousand batched boxes take
   * 1.3 s of frames to build rather than 40 ms.
   */
  holdBatches(): void {
    this.batchesHeld = true;
  }

  /** Groups at once what was synced while the batches were held, and every sync from now on. */
  releaseBatches(): void {
    if (!this.batchesHeld) return;
    this.batchesHeld = false;
    this.batcher.invalidate();
    this.batcher.sync(true, NOTHING);
  }

  /**
   * The entities whose components name `entityId` — the waters lit by a light —,
   * as the last sync read them.
   */
  namersOf(entityId: EntityId): ReadonlySet<EntityId> {
    return this.namers.get(entityId) ?? NO_NAMERS;
  }

  /**
   * Hands back as it is each drawn component naming an entity in `changed`: a
   * water reads its light's sun when it is built or patched, and a light that
   * turned, changed colour, went or came back changed nothing of the water's.
   * Within one sync too: a scene read from its file holds its entities by id,
   * and a water whose id sorts first is built before its light is there to
   * answer.
   */
  private rereadNamers(changed: ReadonlySet<EntityId>): void {
    for (const id of changed) {
      for (const namer of this.namers.get(id) ?? NO_NAMERS) this.rereading.add(namer);
    }
    if (this.rereading.size === 0) return;

    const ctx = this.context;
    for (const namer of this.rereading) {
      // A snapshot: a component its system remounts is filed again under its id.
      const mounted = [...(this.reconciler.view(namer)?.mounted ?? [])];
      for (const [componentId, { doc }] of mounted) {
        const names = componentEntities(this.registries, doc);
        if (!names.some((named) => named !== null && changed.has(named))) continue;
        this.reconciler.reread(namer, componentId, ctx);
      }
    }
    this.rereading.clear();
  }

  /**
   * Files what `entityId`'s components name, in place of what they named: of
   * every type, drawn or not, so that a running world can hand them to its
   * subsystems as the binder hands its own to their systems.
   */
  private index(entityId: EntityId, components: readonly ComponentDoc[]): void {
    for (const named of this.named.get(entityId) ?? []) {
      const namers = this.namers.get(named);
      namers?.delete(entityId);
      if (namers?.size === 0) this.namers.delete(named);
    }

    const names: EntityId[] = [];
    for (const component of components) {
      for (const named of componentEntities(this.registries, component)) {
        if (named !== null && !names.includes(named)) names.push(named);
      }
    }
    if (names.length === 0) {
      this.named.delete(entityId);
      return;
    }
    this.named.set(entityId, names);
    for (const named of names) {
      const namers = this.namers.get(named);
      if (namers) namers.add(entityId);
      else this.namers.set(named, new Set([entityId]));
    }
  }

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


  getObject(entityId: EntityId): Object3D | undefined {
    return this.reconciler.view(entityId)?.container;
  }

  /**
   * The objects one component built, so an editor overlay can annotate them.
   *
   * Nothing else may hold on to what comes back: a system answering `'remount'`
   * replaces its objects, and the identity of this array's first element is
   * exactly how a caller notices.
   */
  objectsFor(entityId: EntityId, componentId: ComponentId): readonly Object3D[] {
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
  containerFor(entityId: EntityId): Object3D | undefined {
    return this.reconciler.peekContainer(entityId);
  }

  /** Walks up from a raycast hit to the entity that owns it. */
  static resolveEntityId(object: Object3D | null): EntityId | undefined {
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
  modelShape(assetId: AssetId): Promise<ModelShape> {
    return this.assets.modelShape(assetId);
  }

  /** What the systems find wrong with the scene they drew, in the order their types were registered. */
  diagnose(): readonly string[] {
    return this.reconciler.diagnose();
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
    this.environment.dispose();
    this.reconciler.clear(this.context);
    // Belt to the braces: every system released its share above, so the pools
    // are already empty unless a count went wrong — and everything up to here
    // retires rather than frees. Nothing is rendering any more, so there is
    // nothing left to wait for.
    this.arena.disposeAll();
    // Every hold this scene took has been given back by now, the texture holds
    // the arena just freed included. What nothing else holds, the cache frees
    // at the window's next frame, or keeps within its budget.
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
   * the document to compare by identity since components moved into its tables
   * — `componentsOf` builds a fresh one per call — but immer still preserves the
   * identity of every component it did not touch, so this is exactly as precise
   * as the old check.
   *
   * The name, the visibility and the transform are written when the document
   * changed them since they were last written, and not because the object
   * differs: in Play a script hides or moves its own object, and a component put
   * on its entity must not show it again or put it back.
   */
  private syncEntity(entity: EntityDoc, components: readonly ComponentDoc[]): void {
    const container = this.reconciler.containerFor(entity.id);
    const view = this.reconciler.view(entity.id);
    if (!view) return;

    if (!sameComponents(view.components, components)) {
      this.reconciler.reconcile(entity.id, components, this.context);
      this.index(entity.id, components);
      // Tracked here rather than scanned per sync: this is the one place that
      // already knows an entity's components changed.
      const caster = components.some((c) => c.type === 'light' && c.castShadow);
      if (caster) this.shadowCasters.add(entity.id);
      else this.shadowCasters.delete(entity.id);
    }

    if (view.name !== entity.name) {
      container.name = entity.name;
      view.name = entity.name;
    }
    if (view.visible !== entity.visible) {
      view.visible = entity.visible;
      if (container.visible !== entity.visible) {
        // Hidden meshes are left out of their group entirely, so this is a
        // membership change like any other.
        container.visible = entity.visible;
        this.batcher.invalidate();
      }
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
        // This is an impossible state: the tree layer refuses an edge to an
        // entity the document does not hold. Falling back to the root in silence
        // is exactly what hid it for months — an object visible and clickable in
        // the viewport and present in no branch of the hierarchy.
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
  private removeEntity(id: EntityId): void {
    const view = this.reconciler.view(id);
    if (!view) return;

    this.shadowCasters.delete(id);
    this.index(id, []);
    this.batcher.invalidate();

    for (const child of [...view.container.children]) {
      if (child.parent !== view.container) continue;
      const owner: unknown = child.userData[ENTITY_ID_KEY];
      // Noted, because a detached child whose own entity is not in this sync's
      // dirty set would be reattached by nothing and simply vanish.
      if (isEntityId(owner) && owner !== id) {
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
