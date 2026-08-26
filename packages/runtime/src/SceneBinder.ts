import {
  componentsOf,
  findComponent,
  type ComponentDoc,
  type EntityDoc,
  type EnvironmentDef,
  type MaterialDef,
  type SceneDoc,
} from '@three-studio/core';
import {
  Color,
  EquirectangularReflectionMapping,
  Fog,
  FogExp2,
  Group,
  LinearSRGBColorSpace,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  type Renderer,
  type Texture,
} from 'three/webgpu';
import { NULL_ASSET_RESOLVER, type AssetResolver } from './assets/AssetResolver';
import { ModelCache } from './assets/ModelCache';
import type { ModelShape } from './assets/modelNodes';
import { Reconciler } from './Reconciler';
import type { SystemContext, SystemHandle } from './systems/ComponentSystem';
import { ENTITY_ID_KEY, resolveEntityId } from './systems/identity';
import { buildMaterial, patchMaterial, sameTextureSlots } from './systems/material';
import { MeshBatcher } from './MeshBatcher';
import { ResourceArena, SharedMaterial, type Disposable } from './systems/ResourceArena';
import { ProceduralSky } from './systems/sky';

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

/** One of the two things an equirectangular image can be: the sky, or the light. */
type EnvironmentSlot = 'background' | 'environment';

/** An equirectangular image, and how many slots are showing it. */
interface EnvironmentMap {
  texture: Texture;
  /**
   * Zero while the image is loading and no slot has swapped to it yet — see
   * `equirectangular`. An entry that reaches zero, or that never gets claimed,
   * is retired by `dropUnclaimedEnvironmentMap`.
   */
  users: number;
}


/**
 * Projects a `SceneDoc` onto a three.js scene graph and keeps it in sync.
 *
 * The document is authoritative; every object here is derived and disposable.
 * That is what lets undo, save/load and the play-mode snapshot work without any
 * of them knowing about three.js.
 *
 * Since phase 11 this is a **coordinator**, not the whole layer. What a
 * component draws belongs to its system (`systems/`), what it holds on the GPU
 * belongs to the arena, and pairing the two against the document belongs to the
 * `Reconciler`. What is left here is what none of them can answer alone: the
 * hierarchy of containers, the batching — which reads every mesh in the scene at
 * once — and the environment, which belongs to no entity.
 *
 * Change detection is by object identity: immer preserves the identity of
 * anything a mutation did not touch, so a moved entity re-reads its transform
 * without rebuilding its geometry.
 */
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
   */
  shadowMapSize = 2048;
  /**
   * Entities whose light casts a shadow. Empty means per-instance culling is
   * safe; see `createBatch`.
   */
  private readonly shadowCasters = new Set<string>();
  /** Entities detached by a removal, to be re-parented from the document. */
  private readonly orphaned = new Set<string>();

  /**
   * Draws what can be drawn together. On in play mode and on in the editor: a
   * batch is one `Object3D`, but `resolveBatchHit` turns a click on it back into
   * the instance it landed on, and the outline and the gizmo work off the
   * entity's container, which a batched mesh still hangs from.
   */
  private readonly batcher = new MeshBatcher(
    this.root,
    this.reconciler,
    this.arena,
    this.shadowCasters,
  );

  get batching(): boolean {
    return this.batcher.enabled;
  }

  set batching(value: boolean) {
    this.batcher.enabled = value;
  }

  /** Writes the world matrices of what moved into the batches holding it. */
  updateBatches(only?: ReadonlySet<string>): void {
    this.batcher.updateBatches(only);
  }

  /** The entity a click on a batch landed on. */
  resolveBatchHit(object: Object3D, batchId: number): string | undefined {
    return this.batcher.resolveBatchHit(object, batchId);
  }

  constructor(resolver: AssetResolver = NULL_ASSET_RESOLVER) {
    this.root.name = 'SceneRoot';
    this.models = new ModelCache(resolver);
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
      shadowMapSize: this.shadowMapSize,
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
    this.releaseEnvironment();
    this.models.setResolver(resolver);
    // Every model has to be built again against the new resolver, so the
    // entities holding one are marked for a full remount on the next sync.
    for (const entityId of this.reconciler.entitiesWithModels()) {
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
     * Reconciled here, once per asset — B5.
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
   * B6, and the queue now lives in the arena. This used to hang off `sync`,
   * whose comment claimed the queue was "a frame old now" — true only if syncs
   * come one per frame, and two paths break that in opposite directions.
   */
  beginFrame(): void {
    this.arena.flush();
  }

  sync(scene: SceneDoc, dirty?: ReadonlySet<string>): void {
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

  /**
   * Holds a GPU object until the frame that might still be reading it is gone.
   *
   * Everything the binder itself lets go of comes through here — a batch, an
   * environment texture — and lands in the **same** queue the systems use.
   * `WebGPURenderer.render` returns a promise the loops do not await, so freeing
   * a buffer the previous frame drew with hands a destroyed buffer to a pass
   * still being encoded. That is a crash, not a dropped frame.
   *
   * Two queues would be one too many: the binder kept its own until phase 11,
   * and `beginFrame` emptied only the other.
   */
  private retire(disposable: Disposable): void {
    this.arena.retire(disposable);
  }

  /** Equirectangular images by asset id, shared between the two slots. */
  private readonly environmentMaps = new Map<string, EnvironmentMap>();
  /** What each slot is showing right now, by asset id. */
  private readonly environmentSlots = new Map<EnvironmentSlot, string>();
  /**
   * What each slot is waiting to show.
   *
   * A slot keeps its old image up while the new one decodes, so a change made
   * during that wait has to win: the arrival checks this before swapping
   * anything, and drops what it loaded if nothing wants it any more.
   */
  private readonly environmentPending = new Map<EnvironmentSlot, string>();
  /**
   * The scene the environment was last applied to.
   *
   * Held rather than passed, because an image that lands after
   * `syncEnvironment` has returned arrives in a callback rather than in a call,
   * and it still has to be put somewhere.
   */
  private environmentScene: Scene | null = null;
  /**
   * Reused rather than rebuilt, and this is not micro-optimisation.
   *
   * The WebGPU backend keys its background and fog nodes on **object identity**
   * — `NodeManager.updateFog` compares `sceneData.fog !== sceneFog`, and
   * `updateBackground` does the same — so a fresh `Color` or `Fog` per sync
   * rebuilds that node and recompiles every material program behind it. The
   * editor calls this on each notch of a slider, which made dragging the fog
   * density recompile the whole scene, per notch, for the length of the drag.
   *
   * Mutating instead is free: both nodes read their values through `reference`
   * uniforms bound to the object, so a written field arrives without a rebuild.
   */
  private readonly backgroundColor = new Color();
  private linearFog: Fog | null = null;
  private exponentialFog: FogExp2 | null = null;
  /** Built only for a scene that asks for an analytic sky; see `systems/sky`. */
  private sky: ProceduralSky | null = null;
  private skyDrifts = false;

  /**
   * Whether the sky's clouds drift.
   *
   * Off by default, which is the editor viewport: a scene sits still while it
   * is being built, and two screenshots of it are the same picture. `Engine`
   * turns it on, because a running game is the case where they should move, and
   * the editor turns it back off for the frames play mode spends paused.
   *
   * A setter rather than a flag the sync reads, so the host can write it every
   * frame — it is `playState` that decides, and `playState` is read per frame.
   *
   * **Its effect is not observable today**, and that is not a reason to delete
   * it. It writes the right value to the right uniform; what is broken is
   * `SkyMesh` itself, whose `time` uniform is never updated — measured at
   * effectively zero, and unmoving, while a plain TSL material in the same
   * renderer animates perfectly. See `docs/three-skymesh-clouds/`.
   */
  get skyAnimated(): boolean {
    return this.skyDrifts;
  }

  set skyAnimated(value: boolean) {
    if (this.skyDrifts === value) return;
    this.skyDrifts = value;
    if (this.sky) this.sky.animated = value;
  }

  /**
   * The device the analytic sky is captured on.
   *
   * Set by whatever is drawing, and null until it has one: acquiring a WebGPU
   * device is async, and the editor's binder is built before that resolves.
   *
   * Everything else here is deliberately renderer-free — `Engine` owns no
   * renderer either, because the host draws it — and this is the one thing
   * that cannot be. Capturing a sky is six draw calls and a blur chain, not a
   * transform over data.
   */
  renderer: Renderer | null = null;

  syncEnvironment(scene: Scene, doc: SceneDoc): void {
    this.environmentScene = scene;
    const { environment } = doc;

    // Which image each of the two slots wants, resolved before either is
    // loaded: `environmentMode: 'background'` names the same asset as the sky,
    // and naming the same asset is what gets them one shared texture and one
    // prefiltered radiance map instead of two. See `equirectangular`.
    const skyImage =
      environment.backgroundMode === 'texture' ? environment.backgroundTexture : null;
    const lightImage =
      environment.environmentMode === 'none'
        ? null
        : environment.environmentMode === 'background'
          ? skyImage
          : environment.environmentTexture;

    // Both slots are resolved whichever mode is on, so that switching to the
    // analytic sky and back does not leave an image held by a slot nothing
    // reads. The captures decide what is *shown*, not what is loaded.
    const backgroundImage = this.equirectangular('background', skyImage);
    const lightTexture = this.equirectangular('environment', lightImage);
    const showsSky = this.syncSky(scene, environment);

    scene.background = showsSky
      ? // Nothing to draw here: the sky is a mesh in the scene, and it covers
        // whatever the renderer cleared to. Its blur and its intensity are
        // properties of `scene.background`, so both go with it — see the
        // Inspector, which stops offering them.
        null
      : // `Color.set` hands back the same instance, which is the point: see above.
        (backgroundImage ?? this.backgroundColor.set(environment.background));
    scene.backgroundBlurriness = environment.backgroundBlur;
    scene.backgroundIntensity = environment.backgroundIntensity;

    scene.environment =
      environment.environmentMode === 'background' && showsSky
        ? this.skyRadiance(environment)
        : lightTexture;
    scene.environmentIntensity = environment.environmentIntensity;

    // One angle written into both, because a sky facing one way and reflections
    // facing another is a bug that reads as a lighting mistake — three keeps
    // them apart and this deliberately does not.
    //
    // But only into what is actually an image. The analytic sky is turned by
    // its own `azimuth`, which moves the sun with it; turning the capture as
    // well would spin the whole sky underneath the sun, from a control labelled
    // for textures. So a scene lit by an HDRI in front of a procedural sky —
    // which is a real arrangement — turns the HDRI and leaves the sky alone.
    const turnsBackground = environment.backgroundMode === 'texture';
    const turnsEnvironment =
      environment.environmentMode === 'texture' ||
      (environment.environmentMode === 'background' && turnsBackground);
    scene.backgroundRotation.set(0, turnsBackground ? environment.rotation : 0, 0);
    scene.environmentRotation.set(0, turnsEnvironment ? environment.rotation : 0, 0);

    scene.fog = this.fogFor(environment);
  }

  /**
   * Puts the analytic sky on the scene, or takes it off.
   *
   * Built on first use rather than with the binder: a `SkyMesh` compiles a
   * fair-sized node program, and most scenes are lit by a photograph or by
   * nothing at all.
   *
   * @returns Whether the scene is showing one.
   */
  private syncSky(scene: Scene, environment: EnvironmentDef): boolean {
    if (environment.backgroundMode !== 'sky') {
      // Detached, not freed: switching modes back and forth is something an
      // author does while deciding, and rebuilding the mesh each time would
      // recompile its node program. `dispose` is what actually lets it go.
      this.sky?.detach();
      return false;
    }

    const sky = (this.sky ??= new ProceduralSky());
    sky.animated = this.skyDrifts;
    sky.attach(scene, environment.sky, environment.backgroundIntensity);
    return true;
  }

  /** The light this sky casts, captured once per change of its settings. */
  private skyRadiance(environment: EnvironmentDef): Texture | null {
    if (this.renderer === null || this.sky === null) return null;
    return this.sky.radiance(environment.sky, this.renderer);
  }

  /**
   * The scene's fog, written into the instance the mode already uses.
   *
   * One instance per mode rather than one shared: switching between linear and
   * exponential is a different shader either way, so that rebuild is earned —
   * and keeping both means switching back does not allocate either.
   */
  private fogFor(environment: EnvironmentDef): Fog | FogExp2 | null {
    if (!environment.fogEnabled) return null;

    if (environment.fogMode === 'exponential') {
      const fog = (this.exponentialFog ??= new FogExp2(0x000000));
      fog.color.set(environment.fogColor);
      fog.density = environment.fogDensity;
      return fog;
    }

    const fog = (this.linearFog ??= new Fog(0x000000));
    fog.color.set(environment.fogColor);
    fog.near = environment.fogNear;
    fog.far = environment.fogFar;
    return fog;
  }

  /**
   * The texture for one environment slot.
   *
   * Two things here that a plain load would not do.
   *
   * It is keyed by **asset**, not by slot, so a scene using one image as both
   * its sky and its light holds one texture rather than two. three caches the
   * prefiltered radiance map against the texture object
   * (`nodes/pmrem/PMREMNode.js`), so two clones of one image is two full cubemap
   * bakes and two render targets for the same sky — and using one image for
   * both is the common case, not an edge one.
   *
   * And **nothing is handed over until its pixels have landed.** Not as a
   * nicety — a half-shown sky would only be ugly — but because an equirectangular
   * texture that is not ready poisons itself permanently.
   *
   * `HDRLoader` and `EXRLoader` return a texture immediately and fill it in
   * later, and the placeholder they return is 1×1 (`ModelCache` documents the
   * same trap for a different reason). three tests readiness with
   * `image.height > 0` — `CubeMapNode` before converting an equirect to a
   * cubemap for the background, `PMREMNode` before prefiltering one for the
   * lighting — so 1×1 reads as **ready**. Each of them then builds from a
   * one-pixel image and caches the result against the texture object: a black
   * cubemap and a degenerate radiance map. The real pixels arrive a moment
   * later, `needsUpdate` fires, and neither cache is keyed on anything that
   * moved, so both stay black for the life of the texture.
   *
   * Waiting means the background falls back to its colour for as long as the
   * file takes to parse, and the sky then appears at full quality. It is also
   * why the slot is only released once the replacement is up: switching images
   * must not flash the clear colour.
   */
  private equirectangular(slot: EnvironmentSlot, assetId: string | null): Texture | null {
    const shown = this.environmentSlots.get(slot) ?? null;
    if (shown === assetId) {
      this.environmentPending.delete(slot);
      return this.environmentTexture(assetId);
    }

    if (assetId === null) {
      this.environmentPending.delete(slot);
      this.releaseEnvironmentSlot(slot);
      return null;
    }

    const map = this.environmentMaps.get(assetId) ?? this.loadEnvironmentMap(assetId);
    // An id the resolver does not know — a scene naming a deleted file. Leave
    // whatever is up rather than blanking the sky over a reference that a
    // re-import will fix.
    if (map === null) return this.environmentTexture(shown);

    if (!this.models.textureReady(assetId)) {
      this.deferEnvironmentSlot(slot, assetId);
      return this.environmentTexture(shown);
    }

    this.environmentPending.delete(slot);
    this.claimEnvironmentMap(slot, assetId, map);
    return map.texture;
  }

  /** What a slot is showing, or `null` for an empty slot. */
  private environmentTexture(assetId: string | null): Texture | null {
    if (assetId === null) return null;
    return this.environmentMaps.get(assetId)?.texture ?? null;
  }

  /**
   * Starts a load and registers the image, with no slot showing it yet.
   *
   * Mapped as a reflection probe rather than a flat image: an equirectangular
   * texture assigned without it is drawn as a rectangle across the screen,
   * which looks like a broken background rather than like a sky.
   */
  private loadEnvironmentMap(assetId: string): EnvironmentMap | null {
    const texture = this.models.instanceTexture(assetId);
    if (texture === null) return null;

    texture.mapping = EquirectangularReflectionMapping;
    // HDR and EXR already hold linear light; a PNG or a JPEG holds sRGB pixels
    // and renders visibly washed out unless it is said so.
    texture.colorSpace = this.models.isLinearTexture(assetId)
      ? LinearSRGBColorSpace
      : SRGBColorSpace;

    const map: EnvironmentMap = { texture, users: 0 };
    this.environmentMaps.set(assetId, map);
    return map;
  }

  /** Moves a slot onto an image, letting go of whatever it was showing. */
  private claimEnvironmentMap(
    slot: EnvironmentSlot,
    assetId: string,
    map: EnvironmentMap,
  ): void {
    this.releaseEnvironmentSlot(slot);
    map.users += 1;
    this.environmentSlots.set(slot, assetId);
  }

  /** Swaps a slot onto its pending image once that image has decoded. */
  private deferEnvironmentSlot(slot: EnvironmentSlot, assetId: string): void {
    if (this.environmentPending.get(slot) === assetId) return;
    this.environmentPending.set(slot, assetId);

    void this.models.whenTextureReady(assetId).then(() => {
      // Superseded while it decoded: whatever asked for this is no longer
      // asking, and the image it loaded goes back out if nothing else took it.
      if (this.environmentPending.get(slot) !== assetId) {
        this.dropUnclaimedEnvironmentMap(assetId);
        return;
      }
      this.environmentPending.delete(slot);

      const map = this.environmentMaps.get(assetId);
      const scene = this.environmentScene;
      if (!map || scene === null) return;

      this.claimEnvironmentMap(slot, assetId, map);
      if (slot === 'background') scene.background = map.texture;
      else scene.environment = map.texture;
    });
  }

  /**
   * Lets a slot go of what it is showing.
   *
   * Retired rather than disposed, like everything else the binder lets go of:
   * the frame in flight may still be sampling this sky.
   */
  private releaseEnvironmentSlot(slot: EnvironmentSlot): void {
    const assetId = this.environmentSlots.get(slot);
    if (assetId === undefined) return;
    this.environmentSlots.delete(slot);

    const map = this.environmentMaps.get(assetId);
    if (!map) return;
    map.users -= 1;
    if (map.users <= 0) this.dropUnclaimedEnvironmentMap(assetId);
  }

  /** Frees an image no slot is showing and none is still waiting for. */
  private dropUnclaimedEnvironmentMap(assetId: string): void {
    const map = this.environmentMaps.get(assetId);
    if (!map || map.users > 0) return;
    for (const pending of this.environmentPending.values()) {
      if (pending === assetId) return;
    }

    this.environmentMaps.delete(assetId);
    this.retire(map.texture);
  }

  /** Every image both slots hold, and anything still waiting on a decode. */
  private releaseEnvironment(): void {
    this.environmentPending.clear();
    this.environmentSlots.clear();
    for (const map of this.environmentMaps.values()) this.retire(map.texture);
    this.environmentMaps.clear();
    this.environmentScene = null;
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
    this.releaseEnvironment();
    this.sky?.dispose();
    this.sky = null;
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
        // in silence is exactly what hid B1 for months — an object visible and
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

    // B8 is now the reconciler's: a model that lands after this drops on the
    // floor, because the handle it was mounted under is no longer mounted.
    this.reconciler.remove(id, this.context);
    view.container.removeFromParent();
  }
}
