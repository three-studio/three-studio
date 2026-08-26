import { describe, expect, it } from 'vitest';
import { screenScale } from '../src/viewport/overlay/screenScale';

/*
 * The one part of the overlay that is arithmetic rather than scene graph, which
 * is why it was split out: a marker whose size drifts with distance is the exact
 * failure that makes an icon useless, and nothing else here can catch it without
 * a renderer.
 */

const FOV = 60;
const HEIGHT = 800;
const PIXELS = 11;

describe('a constant size on screen', () => {
  it('grows in world units exactly as fast as the distance', () => {
    const near = screenScale(10, FOV, HEIGHT, PIXELS);
    const far = screenScale(20, FOV, HEIGHT, PIXELS);

    expect(far).toBeCloseTo(near * 2, 10);
  });

  it('puts the asked-for pixels on screen', () => {
    // A marker of radius `scale` at distance `d` covers `scale / worldPerPixel`
    // pixels, and `worldPerPixel` is the world height over the viewport height.
    const distance = 7;
    const worldHeight = 2 * distance * Math.tan((FOV * Math.PI) / 360);
    const scale = screenScale(distance, FOV, HEIGHT, PIXELS);

    expect((scale / worldHeight) * HEIGHT).toBeCloseTo(PIXELS, 10);
  });

  it('is wider for a wider lens at the same distance', () => {
    expect(screenScale(10, 90, HEIGHT, PIXELS)).toBeGreaterThan(
      screenScale(10, 30, HEIGHT, PIXELS),
    );
  });

  it('shrinks as the viewport gets taller, so the pixel count holds', () => {
    expect(screenScale(10, FOV, 1600, PIXELS)).toBeCloseTo(
      screenScale(10, FOV, 800, PIXELS) / 2,
      10,
    );
  });
});

describe('the bounds', () => {
  it('does not blow up when the camera sits on the marker', () => {
    const scale = screenScale(0, FOV, HEIGHT, PIXELS);

    expect(scale).toBeGreaterThan(0);
    expect(Number.isFinite(scale)).toBe(true);
  });

  it('never lets a marker fill the world', () => {
    expect(screenScale(1e9, FOV, HEIGHT, PIXELS)).toBeLessThanOrEqual(1000);
  });

  it('answers zero for a panel on a hidden tab, which reports no height', () => {
    // The viewport declines to resize to a zero-height container; this declines
    // to divide by it, rather than handing three a NaN scale.
    expect(screenScale(10, FOV, 0, PIXELS)).toBe(0);
  });
});
