import type { SkySettings, Vec3, WaterSunSource } from './schema';

/*
 * What a water surface needs to know about the sun, and where it comes from.
 *
 * Here rather than beside the component because the sky half is a property of
 * the *scene*, and because it is the one piece of this feature that is a pure
 * function of the document — so it can be tested without a renderer, and read
 * identically by the editor and the exported build.
 */

/** The two `sunSource` values that are not an entity id. */
export const SUN_FROM_SKY = 'sky';
export const SUN_CUSTOM = 'custom';

/** Whether this source names a light entity rather than one of the two modes. */
export function isEntitySun(source: WaterSunSource): boolean {
  return source !== SUN_FROM_SKY && source !== SUN_CUSTOM;
}

/**
 * The scene's analytic sun, as a unit vector pointing from the ground at it.
 *
 * The same conversion `ProceduralSky` does for the sky mesh, and it has to be
 * the same or the water's glint and the sun in the sky would sit in different
 * places. Elevation is measured from the horizon and three's spherical phi from
 * straight up, which is the one conversion every sky example gets to write.
 *
 * The only trigonometry in this package. It stays here rather than moving to
 * the runtime because it is a fact about `SkySettings`, and the runtime is not
 * the only thing that wants it.
 */
export function skySunDirection(sky: SkySettings): Vec3 {
  const phi = ((90 - sky.elevation) * Math.PI) / 180;
  const theta = (sky.azimuth * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  return [sinPhi * Math.sin(theta), Math.cos(phi), sinPhi * Math.cos(theta)];
}
