import type { ComponentBase, GeometryDef, Hex, MaterialSide, Vec3 } from '../../scene/primitives';

/**
 * Where a water surface takes its sun from.
 *
 * `'sky'` is the scene's own analytic sun — the one `SkySettings` already
 * describes — and is the default, because a scene that has a sky has exactly one
 * place the light should come from. `'custom'` is the two fields below. Anything
 * else is a light entity's id, and a light that goes away falls back to the sky
 * rather than leaving the water lit from nowhere.
 *
 * One field and one control rather than a mode plus a reference, because they
 * are one question — *which* sun — and splitting it would let the document hold
 * a mode and an id that disagree.
 */
export type WaterSunSource = string;

/**
 * A flat reflective water surface.
 *
 * Deliberately not a `mesh` with a material: the reflection is a second render
 * of the scene from a mirrored camera, which no `MaterialDef` can describe, and
 * the geometry is a plane because a reflector mirrors about one flat plane.
 *
 * It is the `WaterMesh` addon's parameter list, minus what only its WebGL twin
 * has. `textureWidth`/`textureHeight` are `resolutionScale` here;
 * `clipBias` and `eye` are internals; `time` belongs to the one clock and not to
 * a component.
 */
export interface WaterComponent extends ComponentBase {
  type: 'water';
  /** Plane only — see the note above. */
  geometry: Extract<GeometryDef, { kind: 'plane' }>;
  /** The normal map the ripples are read from. A built-in one is used until set. */
  normalMapId: string | null;
  waterColor: Hex;
  sunSource: WaterSunSource;
  /** Used when `sunSource` is `'custom'`. Points from the surface at the sun. */
  sunDirection: Vec3;
  /** Used when `sunSource` is `'custom'`. */
  sunColor: Hex;
  /** Opacity of the whole surface. */
  alpha: number;
  /** Spatial frequency of the ripples. Larger is finer. */
  size: number;
  /**
   * How fast the water runs. `0` holds it still.
   *
   * Per surface, on top of the scene's timescale: a millpond and a torrent can
   * sit in one scene, and Pause still stops both.
   */
  speed: number;
  /** Which way it runs, in radians. `0` is the addon's own look. */
  direction: number;
  /**
   * How sharp the waves read. Low is a swell, high is a chop.
   *
   * It scales the horizontal components of the wave normal; `1.5` is the value
   * three's `WaterMesh` hard-codes.
   */
  choppiness: number;
  /** How far the reflection is pushed around by those ripples. */
  distortionScale: number;
  /**
   * Reflection resolution, as a fraction of the viewport.
   *
   * The one knob that cannot be written in place: `WaterMesh` hands it to its
   * reflector while building the shader, so changing it rebuilds the surface.
   */
  resolutionScale: number;
  side: MaterialSide;
  fog: boolean;
}
