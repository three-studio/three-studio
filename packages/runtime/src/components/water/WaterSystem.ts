import { type EntityId, type GeometryDef, type WaterComponent } from '@three-studio/core';
import {
  BackSide,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
  RepeatWrapping,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three/webgpu';
import type { TextureHold } from '../../assets/AssetCache';
import { ComponentSystem, type SystemContext, type SystemHandle } from '../../systems/ComponentSystem';
import type { Sun } from '../../world/sun';
import { buildGeometry, geometryKeyOf } from '../../systems/geometry';
import { ENTITY_ID_KEY } from '../../systems/identity';
import { WaterSurface } from '../../systems/WaterSurface';
import { defaultWaterNormals } from '../../systems/waterNormals';

/*
 * Flat reflective water.
 *
 * The surface itself is `WaterSurface`, a fork of three's `WaterMesh` — see that
 * file for why. What matters here is what the fork buys: **`patch` never answers
 * `'remount'`.** Every setting, `resolutionScale` included, is a uniform or a
 * property written in place, so dragging a slider never rebuilds a shader
 * pipeline or a reflection pass.
 *
 * The surface costs a full extra render of the scene, per camera, per frame:
 * `reflector()` draws everything again from a mirrored camera. That is the
 * technique, not an oversight, and it is why `resolutionScale` exists.
 */

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const;

/**
 * Where the glint comes from when the scene cannot say where its sky's sun is:
 * up and to one side, white — what `WaterMesh` lights with by default, and what
 * a sun of the surface's own starts at.
 */
const DEFAULT_SUN: Sun = { direction: [0.70707, 0.70707, 0], color: '#ffffff' };

export interface WaterHandle extends SystemHandle {
  water: WaterSurface;
  geometryDef: GeometryDef;
  /** Identifies the pooled geometry this handle holds a reference to. */
  geometryKey: string;
  geometry: BufferGeometry;
  normalMapId: string | null;
  /** The normal map's hold; `null` while the built-in map is in use — that one belongs to no handle. */
  normalMap: TextureHold | null;
  readonly objects: readonly WaterSurface[];
}

export class WaterSystem extends ComponentSystem<WaterComponent, WaterHandle> {
  private readonly direction = new Vector3();

  mount(entityId: EntityId, component: WaterComponent, ctx: SystemContext): WaterHandle {
    const geometryKey = geometryKeyOf(component.geometry);
    const geometry = ctx.arena.geometry(geometryKey, () => buildGeometry(component.geometry));
    const { hold, map } = this.normalMap(component, ctx);
    const sun = this.sunFor(component, ctx);

    const water = new WaterSurface(geometry, {
      waterNormals: map,
      time: ctx.time,
      resolutionScale: component.resolutionScale,
      alpha: component.alpha,
      size: component.size,
      speed: component.speed,
      direction: component.direction,
      choppiness: component.choppiness,
      distortionScale: component.distortionScale,
      waterColor: component.waterColor,
      sunColor: sun.color,
      sunDirection: this.direction.fromArray(sun.direction).normalize(),
    });
    water.userData[ENTITY_ID_KEY] = entityId;
    this.applyMaterial(water, component);

    return {
      water,
      geometryDef: component.geometry,
      geometryKey,
      geometry,
      normalMapId: component.normalMapId,
      normalMap: hold,
      objects: [water],
    };
  }

  /**
   * Never `'remount'`.
   *
   * Everything a water surface has is a uniform or a property the fork keeps
   * reachable, so the `WaterSurface` object survives every edit — and whatever
   * is pointing at it, the outline and the gizmo, keeps pointing at the same
   * thing. `speed` goes through its setter, which is where the phase that stops
   * a change from jumping is paid; see `WaterSurface`.
   */
  patch(
    handle: WaterHandle,
    _previous: WaterComponent,
    next: WaterComponent,
    ctx: SystemContext,
  ): WaterHandle {
    const { water } = handle;

    water.alpha.value = next.alpha;
    water.size.value = next.size;
    water.choppiness.value = next.choppiness;
    water.distortionScale.value = next.distortionScale;
    water.waterColor.value.set(next.waterColor);
    water.speed = next.speed;
    water.direction = next.direction;
    water.resolutionScale = next.resolutionScale;

    const sun = this.sunFor(next, ctx);
    water.sunColor.value.set(sun.color);
    water.sunDirection.value.fromArray(sun.direction).normalize();

    this.applyMaterial(water, next);

    let { geometry, geometryKey, normalMap } = handle;
    const nextKey = geometryKeyOf(next.geometry);
    if (geometryKey !== nextKey) {
      geometry = ctx.arena.geometry(nextKey, () => buildGeometry(next.geometry));
      ctx.arena.releaseGeometry(geometryKey);
      geometryKey = nextKey;
      water.geometry = geometry;
    }

    if (handle.normalMapId !== next.normalMapId) {
      // The old one goes back through the queue rather than being disposed
      // here: the frame in flight may still be sampling it.
      if (normalMap) ctx.arena.retire(normalMap);
      const swapped = this.normalMap(next, ctx);
      normalMap = swapped.hold;
      water.waterNormals.value = swapped.map;
    }

    return {
      ...handle,
      geometryDef: next.geometry,
      geometryKey,
      geometry,
      normalMapId: next.normalMapId,
      normalMap,
    };
  }

  /**
   * Retired, never freed inline: the material and the reflection targets are
   * exactly what the frame in flight may still be reading.
   *
   * The surface owns its material and its render targets and frees both in its
   * own `dispose`. The geometry is the arena's, and the built-in normal map
   * belongs to no handle — hence the null.
   */
  unmount(handle: WaterHandle, ctx: SystemContext): void {
    ctx.arena.releaseGeometry(handle.geometryKey);
    ctx.arena.retire(handle.water);
    if (handle.normalMap) ctx.arena.retire(handle.normalMap);
  }

  /**
   * The normal map, or the built-in one.
   *
   * The built-in is returned with a `null` hold on purpose: it is shared by
   * every surface and owned by none, so a handle must not retire it.
   */
  private normalMap(
    component: WaterComponent,
    ctx: SystemContext,
  ): { hold: TextureHold | null; map: Texture } {
    const assetId = component.normalMapId;
    const hold = assetId === null ? null : ctx.assets.holdTexture(assetId);
    if (!hold) return { hold: null, map: defaultWaterNormals() };
    const { texture } = hold;

    // Tiled and linear, both of which the shader depends on: it samples the map
    // at four different scales well outside 0..1, and reads the result as
    // directions rather than colour.
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.colorSpace = LinearSRGBColorSpace;
    return { hold, map: texture };
  }

  /**
   * What the glint is lit by. A light that has gone lights it as the sky does,
   * rather than leaving the water lit from nowhere; and a scene that cannot
   * answer for its sky lights it from the default a sun of its own starts at.
   *
   * Read when the water mounts and when its own component changes, and at no
   * other time. A light turned afterwards leaves the water lit as it was; and
   * a light that mounts after its water is not there to answer, so the water
   * takes the sky's — the binder mounts in the document's order, which a scene
   * read from its file holds by id, its keys being sorted.
   */
  private sunFor(component: WaterComponent, ctx: SystemContext): Sun {
    const { sun } = component;
    if (sun.kind === 'custom') return sun;
    const sky = ctx.sun.of(null) ?? DEFAULT_SUN;
    return sun.kind === 'light' && sun.entity !== null ? (ctx.sun.of(sun.entity) ?? sky) : sky;
  }

  /**
   * The two settings that are the material's rather than the shader's.
   *
   * `WaterMesh` takes neither as an option — they are `Water`'s — but both are
   * plain `Material` fields, so a `NodeMaterial` has them too. `fog` changes
   * what is compiled, hence `needsUpdate`; `side` is pipeline state and does not.
   */
  private applyMaterial(water: WaterSurface, component: WaterComponent): void {
    water.material.side = SIDES[component.side];
    if (water.material.fog !== component.fog) {
      water.material.fog = component.fog;
      water.material.needsUpdate = true;
    }
  }
}
