import type { Vec3Like } from './PhysicsApi';

/*
 * A caller's values, checked before they reach Rapier.
 *
 * Rapier keeps whatever it is handed, and a value that is not a number never
 * leaves it. Measured in 0.20: a NaN `setTranslation` left the body at NaN and
 * its entity drawn nowhere for good; a NaN impulse read back as a NaN
 * velocity; an infinite velocity left a NaN one. A script's one bad division
 * is enough, so the façade refuses such a value, with the rest of its call.
 */

/** Every component a finite number. */
export function isFiniteVec(value: Readonly<Vec3Like>): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
