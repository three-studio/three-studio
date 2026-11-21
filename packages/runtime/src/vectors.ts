/*
 * A point and a rotation as the runtime's surfaces take them: plain fields,
 * which three's `Vector3` and `Quaternion` have and so does an object literal.
 *
 * A leaf, importing nothing: physics speaks in them, and so does what scripts
 * are given, which must not import physics to name them.
 */

/** A point or a displacement, in metres. three's `Vector3` is one. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A rotation. three's `Quaternion` is one. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}
