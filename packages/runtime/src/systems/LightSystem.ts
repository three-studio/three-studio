import type { LightComponent } from '@three-studio/core';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Light,
  OrthographicCamera,
  PointLight,
  ProjectorLight,
  RectAreaLight,
  SpotLight,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import { ComponentSystem, type SystemContext, type SystemHandle } from './ComponentSystem';
import { ENTITY_ID_KEY } from './identity';

export interface LightHandle extends SystemHandle {
  light: Object3D;
  kind: LightComponent['kind'];
  /**
   * The projector's cookie. Its own instance, owned by this handle — the model
   * cache shares the decoded image, not the `Texture`. `null` for every other
   * kind, and for a projector whose slot is empty or whose asset is missing.
   */
  texture: Texture | null;
  /** What `texture` was instanced from, so `patch` can tell a swap from a no-op. */
  mapId: string | null;
  readonly objects: readonly Object3D[];
}

/**
 * The light, and the shadow map it owns.
 *
 * B9 lives here and is the reason the `patch`/`'remount'` contract is worth
 * having at all: a directional, spot or point light allocates a render target of
 * `shadowMapSize` squared — 2048 by default, up to 4096 — and only
 * `light.dispose()` frees it. Rebuilding on every edit meant dragging an
 * intensity slider allocated a fresh shadow map per frame and abandoned the last
 * one. Sixty a second, none of them freed.
 */
export class LightSystem extends ComponentSystem<LightComponent, LightHandle> {
  readonly type = 'light' as const;

  mount(entityId: string, component: LightComponent, ctx: SystemContext): LightHandle {
    const light = buildLight(component);
    applyShadow(light, component, ctx.shadowMapSize);
    const texture = applyCookie(light, component, ctx, null);
    /*
     * On its entity's origin, and not where three put it.
     *
     * `DirectionalLight`, `SpotLight` and `HemisphereLight` all construct at
     * `(0, 1, 0)` — `this.position.copy(Object3D.DEFAULT_UP)` — so that a light
     * added straight to a scene shines downward instead of sitting inside the
     * floor. Here the entity's transform is what places it, and that default put
     * every light of those three kinds **one metre above the entity holding
     * it**: the gizmo, the marker and the outline sat on the entity while the
     * light itself, and anything drawn from it, sat a metre away.
     *
     * Visible as a helper that would not line up. Real beyond the helper: a
     * directional light's shadow camera is centred on its position, so the
     * shadows were cast from somewhere the document never named — and the
     * document is what is authoritative.
     *
     * A hemisphere light is the exception, and not a cosmetic one. Its position
     * is not a place: `HemisphereLightNode` builds the sky-to-ground axis as
     * `normalize(worldPosition)`, so the origin is a zero vector to normalise.
     * That is undefined in WGSL, the irradiance it contributes comes back NaN,
     * and NaN added to a fragment's accumulated irradiance takes the whole
     * fragment to black — every surface, every other light in the scene
     * included. The starter scene ships a hemisphere light called "sky", so the
     * symptom was every new project rendering pitch black until that one light
     * was deleted, which is an alarming way to find this out. Its `(0, 1, 0)`
     * stays, and means up.
     */
    if (component.kind !== 'hemisphere') light.position.set(0, 0, 0);
    light.userData[ENTITY_ID_KEY] = entityId;
    return { light, kind: component.kind, texture, mapId: component.mapId, objects: [light] };
  }

  /**
   * Scalars are written on; a change of `kind` is not.
   *
   * A hemisphere light and a spot light are different classes, so there is
   * nothing to write onto. Saying `'remount'` rather than rebuilding quietly is
   * what lets the caller free the shadow map the old one holds.
   *
   * A projector's cookie is swapped in place rather than answered with
   * `'remount'`, even though it is a resource: remounting throws away the shadow
   * map, which is the whole subject of B9 above. Changing which texture a light
   * throws should not cost a shadow-map reallocation.
   */
  patch(
    handle: LightHandle,
    _previous: LightComponent,
    next: LightComponent,
    ctx: SystemContext,
  ): LightHandle | 'remount' {
    if (handle.kind !== next.kind) return 'remount';

    const light = handle.light as Light &
      Partial<SpotLight & PointLight & HemisphereLight & RectAreaLight & ProjectorLight>;
    light.color.set(next.color);
    light.intensity = next.intensity;
    if (light.groundColor) light.groundColor.set(next.groundColor);
    if (typeof light.distance === 'number') light.distance = next.distance;
    if (typeof light.decay === 'number') light.decay = next.decay;
    if (typeof light.angle === 'number') light.angle = next.angle;
    if (typeof light.penumbra === 'number') light.penumbra = next.penumbra;
    if (typeof light.width === 'number') light.width = next.width;
    if (typeof light.height === 'number') light.height = next.height;
    if ('castShadow' in light) light.castShadow = next.castShadow;

    applyShadow(handle.light, next, ctx.shadowMapSize);

    if (handle.mapId === next.mapId) return handle;
    const texture = applyCookie(handle.light, next, ctx, handle.texture);
    return { ...handle, texture, mapId: next.mapId };
  }

  unmount(handle: LightHandle, ctx: SystemContext): void {
    ctx.arena.retire(handle.light as unknown as { dispose(): void });
    if (handle.texture) ctx.arena.retire(handle.texture);
  }
}

/**
 * The class, and nothing that can be written after construction.
 *
 * Shadows are `applyShadow`'s and the cookie is `applyCookie`'s, so that `patch`
 * reaches them too — the shadow settings used to be set here alone, which meant
 * they existed only for as long as nobody edited the light.
 */
function buildLight(def: LightComponent): Object3D {
  const color = new Color(def.color);
  switch (def.kind) {
    case 'ambient':
      return new AmbientLight(color, def.intensity);
    case 'hemisphere':
      return new HemisphereLight(color, new Color(def.groundColor), def.intensity);
    case 'directional': {
      const light = new DirectionalLight(color, def.intensity);
      aimAlongLocalForward(light);
      return light;
    }
    case 'point':
      return new PointLight(color, def.intensity, def.distance, def.decay);
    case 'spot': {
      const light = new SpotLight(color, def.intensity, def.distance, def.angle, def.penumbra, def.decay);
      aimAlongLocalForward(light);
      return light;
    }
    case 'rectArea':
      // No target and no aiming: the rectangle emits from its own -Z face, so
      // the entity's rotation is already the whole of its orientation.
      return new RectAreaLight(color, def.intensity, def.width, def.height);
    case 'projector': {
      const light = new ProjectorLight(color, def.intensity, def.distance, def.angle, def.penumbra, def.decay);
      aimAlongLocalForward(light);
      return light;
    }
  }
}

/**
 * The shadow map and how it is sampled, for whichever kinds have one.
 *
 * Called from `mount` *and* `patch`, which is the correction of two faults at
 * once. `mapSize` used to be set on the directional branch alone, so a point or
 * a spot light — both of which are born casting — ran at three's 512 while the
 * directional beside it ran at the project's 2048, with nothing anywhere saying
 * so. And nothing re-applied any of it on an edit, so a shadow setting would
 * have taken effect only on a remount, which `patch` exists to avoid.
 *
 * A rect area light has no `shadow` at all; the property test is what skips it
 * rather than a list of kinds, so this stays true if another kind gains one.
 */
function applyShadow(light: Object3D, def: LightComponent, shadowMapSize: number): void {
  const casting = light as Object3D & Partial<SpotLight & DirectionalLight>;
  const shadow = casting.shadow;
  if (!shadow) return;

  casting.castShadow = def.castShadow;
  shadow.mapSize.set(shadowMapSize, shadowMapSize);
  shadow.bias = def.shadow.bias;
  shadow.normalBias = def.shadow.normalBias;
  shadow.radius = def.shadow.radius;
  shadow.blurSamples = def.shadow.blurSamples;

  const camera = shadow.camera;
  camera.near = def.shadow.near;
  camera.far = def.shadow.far;
  if (camera instanceof OrthographicCamera) {
    // The directional light's shadow camera is a box, not a frustum: what it
    // does not enclose simply casts nothing, which reads as a light that has
    // stopped working rather than as a setting to raise.
    const half = def.shadow.orthoSize;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
  }
  if (typeof casting.shadow?.focus === 'number') {
    (casting.shadow as { focus: number }).focus = def.shadow.focus;
  }
  // Near, far and the extents are all read off the projection matrix, which
  // three does not rebuild on its own.
  camera.updateProjectionMatrix();
}

/**
 * The projector's cookie, instanced from the shared image and owned by the
 * handle that gets it back.
 *
 * `previous` is retired rather than disposed on the spot: a frame already
 * encoding may still sample it. Same contract as a material's texture slots in
 * `material.ts`, and the arena is the one place that knows when it is safe.
 */
function applyCookie(
  light: Object3D,
  def: LightComponent,
  ctx: SystemContext,
  previous: Texture | null,
): Texture | null {
  if (!(light instanceof ProjectorLight)) return null;
  if (previous) ctx.arena.retire(previous);

  light.aspect = def.aspect > 0 ? def.aspect : null;
  light.map = def.mapId === null ? null : ctx.models.instanceTexture(def.mapId);
  return light.map;
}

/**
 * three aims directional and spot lights at a separate `target` object which,
 * by default, sits at the world origin — so rotating the entity would do
 * nothing. Parenting the target under the light makes the beam follow the
 * entity's rotation, which is what an author expects from a transform gizmo.
 */
function aimAlongLocalForward(light: DirectionalLight | SpotLight): void {
  light.target.position.set(0, 0, -1);
  light.add(light.target);
}
