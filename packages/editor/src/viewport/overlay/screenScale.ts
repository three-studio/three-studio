/**
 * The world scale that keeps an object of radius 1 a constant size on screen.
 *
 * `2·d·tan(fov/2)` is the world height a perspective camera covers at distance
 * `d`; divided by the viewport height in pixels it gives world units per pixel,
 * which is the whole of the arithmetic.
 *
 * Kept here, as a function on numbers rather than on a camera, because it is the
 * one part of the overlay that can be pinned by a test without a renderer — and
 * because the marker, the outline and anything else that wants a screen-sized
 * annotation should share one answer rather than each rounding it differently.
 */

/** Below this the camera is effectively inside the marker and `d` explodes. */
const MIN_DISTANCE = 0.05;
/** A marker filling the view is worse than one slightly too small. */
const MAX_SCALE = 1000;

export function screenScale(
  distance: number,
  fovDegrees: number,
  viewportHeight: number,
  pixels: number,
): number {
  // A dock panel on a hidden tab reports zero height; the viewport declines to
  // resize to it, and this declines to divide by it.
  if (viewportHeight <= 0) return 0;

  const halfFov = (fovDegrees * Math.PI) / 360;
  const worldPerPixel =
    (2 * Math.max(distance, MIN_DISTANCE) * Math.tan(halfFov)) / viewportHeight;
  return Math.min(worldPerPixel * pixels, MAX_SCALE);
}
