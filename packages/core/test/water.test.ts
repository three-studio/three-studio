import { describe, expect, it } from 'vitest';
import { SUN_CUSTOM, SUN_FROM_SKY, isEntitySun, skySunDirection } from '../src/scene/water';
import { createSkySettings, createWater } from '../src/scene/defaults';
import { fillComponent } from '../src/components';
import type { WaterComponent } from '../src/scene/schema';

/*
 * The sun conversion is pinned here because two places have to agree on it: the
 * sky mesh puts the disc somewhere, and the water puts its glint somewhere, and
 * a scene where those disagree looks broken in a way no single test of either
 * would catch.
 */
describe('the sky’s sun', () => {
  it('points straight up at ninety degrees of elevation', () => {
    const [x, y, z] = skySunDirection({ ...createSkySettings(), elevation: 90, azimuth: 0 });

    expect(y).toBeCloseTo(1);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });

  it('lies on the horizon at zero, and turns with the azimuth', () => {
    const south = skySunDirection({ ...createSkySettings(), elevation: 0, azimuth: 0 });
    const east = skySunDirection({ ...createSkySettings(), elevation: 0, azimuth: 90 });

    expect(south[1]).toBeCloseTo(0);
    expect(south[2]).toBeCloseTo(1);
    expect(east[0]).toBeCloseTo(1);
    expect(east[2]).toBeCloseTo(0);
  });

  it('is a unit vector, which is what the shader reflects about', () => {
    const [x, y, z] = skySunDirection({ ...createSkySettings(), elevation: 33, azimuth: 217 });

    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });
});

describe('a water surface’s sun source', () => {
  it('tells the two modes apart from an entity id', () => {
    expect(isEntitySun(SUN_FROM_SKY)).toBe(false);
    expect(isEntitySun(SUN_CUSTOM)).toBe(false);
    expect(isEntitySun('e_1a2b3c')).toBe(true);
  });
});

describe('a fresh water surface', () => {
  it('starts at three’s own behaviour, so nothing added before them moves', () => {
    const water = createWater();

    expect(water.speed).toBe(1);
    expect(water.direction).toBe(0);
    expect(water.choppiness).toBe(1.5);
  });

  it('fills the three onto a surface saved before they existed', () => {
    const { speed: _s, direction: _d, choppiness: _c, ...older } = createWater();
    const filled = fillComponent(older as WaterComponent) as WaterComponent;

    expect(filled.speed).toBe(1);
    expect(filled.direction).toBe(0);
    expect(filled.choppiness).toBe(1.5);
    // And the id is the one thing `fill` must never mint again — a prefab
    // override names a component by it.
    expect(filled.id).toBe(older.id);
  });
});
