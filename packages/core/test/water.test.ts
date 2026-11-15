import { describe, expect, it } from 'vitest';
import { skySunDirection } from '../src/scene/water';
import { waterType } from '../src/components/water';
import { createEnvironment } from '../src/scene/environment';

/*
 * The sun conversion is pinned here because two places have to agree on it: the
 * sky mesh puts the disc somewhere, and the water puts its glint somewhere, and
 * a scene where those disagree looks broken in a way no single test of either
 * would catch.
 */
describe('the sky’s sun', () => {
  it('points straight up at ninety degrees of elevation', () => {
    const [x, y, z] = skySunDirection({ ...createEnvironment().sky, elevation: 90, azimuth: 0 });

    expect(y).toBeCloseTo(1);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });

  it('lies on the horizon at zero, and turns with the azimuth', () => {
    const south = skySunDirection({ ...createEnvironment().sky, elevation: 0, azimuth: 0 });
    const east = skySunDirection({ ...createEnvironment().sky, elevation: 0, azimuth: 90 });

    expect(south[1]).toBeCloseTo(0);
    expect(south[2]).toBeCloseTo(1);
    expect(east[0]).toBeCloseTo(1);
    expect(east[2]).toBeCloseTo(0);
  });

  it('is a unit vector, which is what the shader reflects about', () => {
    const [x, y, z] = skySunDirection({ ...createEnvironment().sky, elevation: 33, azimuth: 217 });

    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });
});

describe('a fresh water surface', () => {
  it('starts at three’s own behaviour, so nothing added before them moves', () => {
    const water = waterType.create();

    expect(water.speed).toBe(1);
    expect(water.direction).toBe(0);
    expect(water.choppiness).toBe(1.5);
  });

  it('refuses a surface saved before the three existed, naming each', () => {
    const { speed: _s, direction: _d, choppiness: _c, ...older } = waterType.create();
    const decoded = waterType.decode(older, []);

    expect(decoded.ok ? [] : decoded.diagnostics.map(({ code, path }) => `${code} ${path.join('.')}`)).toEqual([
      'field.missing speed',
      'field.missing direction',
      'field.missing choppiness',
    ]);
  });
});
