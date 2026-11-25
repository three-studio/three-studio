import type { QuatLike, Vec3Like } from './PhysicsApi';

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

/** The rotation made unit length, or `null` when it has none to give: zero, or not a number. */
export function unitQuat({ x, y, z, w }: Readonly<QuatLike>): QuatLike | null {
  // Infinite with an infinity in it, even beside a NaN.
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length === 0) return null;
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** `unitQuat` written into `target`; `false`, and `target` untouched, when there is no rotation to give. */
export function writeUnitQuat(target: QuatLike, { x, y, z, w }: Readonly<QuatLike>): boolean {
  // Not `Math.hypot`, whose builtin gathers its arguments into an array of its
  // own on every call, and this runs every tick. An infinity or a NaN in it
  // still makes the length one.
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  if (!Number.isFinite(length) || length === 0) return false;
  target.x = x / length;
  target.y = y / length;
  target.z = z / length;
  target.w = w / length;
  return true;
}

/** The direction made unit length, or `null` when it has none to give: zero, or not a number. */
export function unitVec({ x, y, z }: Readonly<Vec3Like>): Vec3Like | null {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) return null;
  return { x: x / length, y: y / length, z: z / length };
}
