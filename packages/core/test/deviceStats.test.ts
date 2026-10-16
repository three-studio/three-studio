import { describeDeviceStats, formatCount, type DeviceStats } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * A device's numbers, in the words a row in the editor and the device's own
 * overlay both use: written in one place, so that the two never disagree on
 * what a phone just measured.
 */

function stats(overrides: Partial<DeviceStats> = {}): DeviceStats {
  return {
    fps: 58,
    p95: 21,
    frames: 116,
    drawCalls: 142,
    triangles: 85_210,
    textures: 31,
    gpuMemory: 180 * 1024 * 1024,
    pixelRatio: 2,
    width: 786,
    height: 1704,
    pinned30: false,
    ...overrides,
  };
}

describe('a device’s stats, described', () => {
  it('read as three lines — the pace, the scene, the pixels — and what a frame draws', () => {
    expect(describeDeviceStats(stats())).toEqual({
      pace: '58 fps · p95 21 ms',
      draws: '142 draws · 85.2k tris',
      scene: '142 draws · 85.2k tris · 31 textures · 180 MB',
      pixels: 'drawn at 2× · 786×1704',
    });
  });

  it('keep a tenth of a millisecond, and drop a tenth that is none', () => {
    expect(describeDeviceStats(stats({ p95: 16.7 })).pace).toBe('58 fps · p95 16.7 ms');
    expect(describeDeviceStats(stats({ p95: 33 })).pace).toBe('58 fps · p95 33 ms');
  });

  it('say one draw and one texture as one', () => {
    expect(describeDeviceStats(stats({ drawCalls: 1, triangles: 12, textures: 1 })).scene).toBe(
      '1 draw · 12 tris · 1 texture · 180 MB',
    );
  });

  it('write memory in MB, with a tenth below 10, and in GB from 1 024 MB', () => {
    const mb = 1024 * 1024;

    expect(describeDeviceStats(stats({ gpuMemory: 4.5 * mb })).scene).toMatch(/ · 4\.5 MB$/);
    expect(describeDeviceStats(stats({ gpuMemory: 0 })).scene).toMatch(/ · 0 MB$/);
    expect(describeDeviceStats(stats({ gpuMemory: 1280 * mb })).scene).toMatch(/ · 1\.25 GB$/);
  });

  it('write a ratio a phone draws at as it is, to a hundredth', () => {
    expect(describeDeviceStats(stats({ pixelRatio: 2.625 })).pixels).toBe(
      'drawn at 2.63× · 786×1704',
    );
    expect(describeDeviceStats(stats({ pixelRatio: 1.5 })).pixels).toBe('drawn at 1.5× · 786×1704');
  });
});

describe('a count', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1k'],
    [85_210, '85.2k'],
    [123_456, '123k'],
    [1_250_000, '1.25M'],
    [2_000_000, '2M'],
  ])('%i reads %s', (count, text) => {
    expect(formatCount(count)).toBe(text);
  });
});
