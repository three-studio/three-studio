import { Vector3 } from 'three/webgpu';

/*
 * The horizontal plane an object falls back onto when the view is pointed at
 * nothing.
 *
 * Its own file because the arithmetic is the whole of the behaviour and it is
 * where the bug was: the height used to be a literal `0`, so an author whose
 * floor sat below the helper grid got their objects on the grid instead — the
 * ray misses a finite floor as soon as the centre of the screen clears its
 * edge, and the fallback then invented a surface at a height nothing in the
 * scene had.
 */

/** How far the plane may be before the answer stops meaning anything. */
const MAX_DISTANCE = 1000;

/**
 * Where a ray meets the horizontal plane at `height`, or `null`.
 *
 * Only from above, and only heading down. A camera under the plane looking up
 * does meet it, but sticking an object to the underside of an invisible surface
 * is a worse answer than admitting there is nothing there.
 */
export function horizontalPlaneHit(
  origin: Vector3,
  direction: Vector3,
  height: number,
): Vector3 | null {
  const drop = height - origin.y;
  if (drop >= 0 || direction.y >= -0.001) return null;

  const distance = drop / direction.y;
  if (distance >= MAX_DISTANCE) return null;

  return new Vector3().copy(origin).addScaledVector(direction, distance);
}
