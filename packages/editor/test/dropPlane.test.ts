import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { horizontalPlaneHit } from '../src/viewport/dropPlane';

/*
 * The fallback surface, which is where the placement bug lived.
 *
 * `dropPoint` asks for a surface under the centre of the view and, finding
 * none, falls back onto a horizontal plane. The height of that plane used to be
 * a literal `0` — the helper grid — so an author whose floor sat at y = -3 got
 * their objects three metres above it, every time the centre of the screen
 * cleared the floor's finite edge. The height is the pivot's now, and these
 * are the cases that made the old spelling look right.
 */

const down = (x = 0, y = -1, z = 0) => new Vector3(x, y, z).normalize();

describe('the plane an object falls back onto', () => {
  it('meets a ray aimed straight down at the plane, not at zero', () => {
    const hit = horizontalPlaneHit(new Vector3(4, 10, -7), down(), -3);

    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(-3, 5);
    expect(hit!.x).toBeCloseTo(4, 5);
    expect(hit!.z).toBeCloseTo(-7, 5);
  });

  it('travels sideways in proportion to the drop', () => {
    // Forty-five degrees down and forward: the horizontal run equals the fall.
    const hit = horizontalPlaneHit(new Vector3(0, 8, 0), down(0, -1, -1), 0);

    expect(hit!.y).toBeCloseTo(0, 5);
    expect(hit!.z).toBeCloseTo(-8, 5);
  });

  it('keeps the grid for a scene that has not been touched', () => {
    // The pivot starts at the origin, so nothing about a fresh scene changes.
    const hit = horizontalPlaneHit(new Vector3(8, 6, 12), down(0, -1, -0.5), 0);

    expect(hit!.y).toBeCloseTo(0, 5);
  });

  it('refuses a ray pointed at the sky', () => {
    expect(horizontalPlaneHit(new Vector3(0, 5, 0), down(0, 1, -1), 0)).toBeNull();
    expect(horizontalPlaneHit(new Vector3(0, 5, 0), new Vector3(0, 0, -1), 0)).toBeNull();
  });

  it('refuses to stick anything to the underside', () => {
    // Under the plane and looking down: the ray never reaches it, and reaching
    // "backwards" for it is how a negative distance becomes a place.
    expect(horizontalPlaneHit(new Vector3(0, -10, 0), down(), -3)).toBeNull();
  });

  it('gives up rather than answer a kilometre away', () => {
    // A ray a hair off horizontal meets the plane, technically, somewhere the
    // author will never find it.
    expect(horizontalPlaneHit(new Vector3(0, 10, 0), down(0, -0.002, -1), 0)).toBeNull();
  });
});
