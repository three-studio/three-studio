import type { EnvironmentDef } from '@three-studio/core';
import {
  Color,
  EquirectangularReflectionMapping,
  Fog,
  FogExp2,
  LinearSRGBColorSpace,
  SRGBColorSpace,
  Scene,
  type Renderer,
  type Texture,
} from 'three/webgpu';
import type { ModelCache } from './assets/ModelCache';
import type { ResourceArena, Disposable } from './systems/ResourceArena';
import { ProceduralSky } from './systems/sky';

/** One of the two things an equirectangular image can be: the sky, or the light. */
type EnvironmentSlot = 'background' | 'environment';

/** An equirectangular image, and how many slots are showing it. */
interface EnvironmentMap {
  texture: Texture;
  /**
   * Zero while the image is loading and no slot has swapped to it yet — see
   * `equirectangular`. An entry that reaches zero, or that never gets claimed,
   * is retired by `dropUnclaimed`.
   */
  users: number;
}

/**
 * The background, the image-based lighting, the analytic sky and the fog.
 *
 * Lifted out of `SceneBinder`, which described itself as a coordinator and did
 * eleven jobs; this was the largest of them and the one with the least to say
 * to the others. What is left over there projects entities and delegates here.
 *
 * **One binder, one `Scene`.** `scene` below is a single field, not a map, and
 * that is a constraint rather than an omission — it is what killed the idea of
 * sharing one binder between the editor's viewport and the running game. The
 * reason is in `defer`: an image that finishes decoding after
 * `sync` has returned arrives in a callback with no scene in its hand, so the
 * last one has to be remembered. Two scenes would need two of everything here,
 * at which point it is two binders.
 *
 * The arena is **given**, not owned. Everything this lets go of has to land in
 * the same retire queue the systems use — see `retire`.
 */
export class EnvironmentBinder {
  /**
   * @param renderer The device an analytic sky is captured on, or null until
   *   there is one: acquiring a WebGPU device is async, and the editor's binder
   *   is built before that resolves. Everything else in the runtime is
   *   deliberately renderer-free — `Engine` owns no renderer either, because
   *   the host draws it — and this is the one thing that cannot be. Capturing a
   *   sky is six draw calls and a blur chain, not a transform over data.
   */
  constructor(
    private readonly models: ModelCache,
    private readonly arena: ResourceArena,
    private readonly renderer: Renderer | null,
  ) {}

  /** Equirectangular images by asset id, shared between the two slots. */
  private readonly maps = new Map<string, EnvironmentMap>();
  /** What each slot is showing right now, by asset id. */
  private readonly slots = new Map<EnvironmentSlot, string>();
  /**
   * What each slot is waiting to show.
   *
   * A slot keeps its old image up while the new one decodes, so a change made
   * during that wait has to win: the arrival checks this before swapping
   * anything, and drops what it loaded if nothing wants it any more.
   */
  private readonly pending = new Map<EnvironmentSlot, string>();
  /**
   * The scene the environment was last applied to.
   *
   * Held rather than passed, because an image that lands after `sync` has
   * returned arrives in a callback rather than in a call, and it still has to
   * be put somewhere.
   */
  private scene: Scene | null = null;
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

  /**
   * Holds a GPU object until the frame that might still be reading it is gone.
   *
   * A sky this lets go of lands in the **same** queue the systems use, which is
   * why the arena is a constructor argument and not a field of its own.
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

  sync(scene: Scene, environment: EnvironmentDef): void {
    this.scene = scene;

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
    const shown = this.slots.get(slot) ?? null;
    if (shown === assetId) {
      this.pending.delete(slot);
      return this.textureOf(assetId);
    }

    if (assetId === null) {
      this.pending.delete(slot);
      this.releaseSlot(slot);
      return null;
    }

    const map = this.maps.get(assetId) ?? this.load(assetId);
    // An id the resolver does not know — a scene naming a deleted file. Leave
    // whatever is up rather than blanking the sky over a reference that a
    // re-import will fix.
    if (map === null) return this.textureOf(shown);

    if (!this.models.textureReady(assetId)) {
      this.defer(slot, assetId);
      return this.textureOf(shown);
    }

    this.pending.delete(slot);
    this.claim(slot, assetId, map);
    return map.texture;
  }

  /** What a slot is showing, or `null` for an empty slot. */
  private textureOf(assetId: string | null): Texture | null {
    if (assetId === null) return null;
    return this.maps.get(assetId)?.texture ?? null;
  }

  /**
   * Starts a load and registers the image, with no slot showing it yet.
   *
   * Mapped as a reflection probe rather than a flat image: an equirectangular
   * texture assigned without it is drawn as a rectangle across the screen,
   * which looks like a broken background rather than like a sky.
   */
  private load(assetId: string): EnvironmentMap | null {
    const texture = this.models.instanceTexture(assetId);
    if (texture === null) return null;

    texture.mapping = EquirectangularReflectionMapping;
    // HDR and EXR already hold linear light; a PNG or a JPEG holds sRGB pixels
    // and renders visibly washed out unless it is said so.
    texture.colorSpace = this.models.isLinearTexture(assetId)
      ? LinearSRGBColorSpace
      : SRGBColorSpace;

    const map: EnvironmentMap = { texture, users: 0 };
    this.maps.set(assetId, map);
    return map;
  }

  /** Moves a slot onto an image, letting go of whatever it was showing. */
  private claim(
    slot: EnvironmentSlot,
    assetId: string,
    map: EnvironmentMap,
  ): void {
    this.releaseSlot(slot);
    map.users += 1;
    this.slots.set(slot, assetId);
  }

  /** Swaps a slot onto its pending image once that image has decoded. */
  private defer(slot: EnvironmentSlot, assetId: string): void {
    if (this.pending.get(slot) === assetId) return;
    this.pending.set(slot, assetId);

    void this.models.whenTextureReady(assetId).then(() => {
      // Superseded while it decoded: whatever asked for this is no longer
      // asking, and the image it loaded goes back out if nothing else took it.
      if (this.pending.get(slot) !== assetId) {
        this.dropUnclaimed(assetId);
        return;
      }
      this.pending.delete(slot);

      const map = this.maps.get(assetId);
      const scene = this.scene;
      if (!map || scene === null) return;

      this.claim(slot, assetId, map);
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
  private releaseSlot(slot: EnvironmentSlot): void {
    const assetId = this.slots.get(slot);
    if (assetId === undefined) return;
    this.slots.delete(slot);

    const map = this.maps.get(assetId);
    if (!map) return;
    map.users -= 1;
    if (map.users <= 0) this.dropUnclaimed(assetId);
  }

  /** Frees an image no slot is showing and none is still waiting for. */
  private dropUnclaimed(assetId: string): void {
    const map = this.maps.get(assetId);
    if (!map || map.users > 0) return;
    for (const pending of this.pending.values()) {
      if (pending === assetId) return;
    }

    this.maps.delete(assetId);
    this.retire(map.texture);
  }

  /** Every image both slots hold, and anything still waiting on a decode. */
  release(): void {
    this.pending.clear();
    this.slots.clear();
    for (const map of this.maps.values()) this.retire(map.texture);
    this.maps.clear();
    this.scene = null;
  }

  /** Everything held, and the sky. The binder is not usable afterwards. */
  dispose(): void {
    this.release();
    this.sky?.dispose();
    this.sky = null;
  }
}
