import {
  BUILD_FORMAT_VERSION,
  createDeviceLaunchOptions,
  createRenderingSettings,
  type BuildManifest,
  type DeviceLaunchOptions,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { applyLaunchOptions } from '../src/main/devices/launchOptions';

/*
 * The launch options a device's renderer reads, applied to the manifest as it
 * is served: the player reads them as it reads any export's, and neither it
 * nor the runtime ever learns that a device asked.
 */

function manifest(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return {
    formatVersion: BUILD_FORMAT_VERSION,
    title: 'Races',
    forceWebGL: false,
    rendering: createRenderingSettings(),
    scenes: ['main'],
    scripts: null,
    ...overrides,
  };
}

function options(overrides: Partial<DeviceLaunchOptions> = {}): DeviceLaunchOptions {
  return { ...createDeviceLaunchOptions(), ...overrides };
}

describe('the launch options, applied to a manifest', () => {
  it('leave the very same manifest when they change nothing the renderer reads', () => {
    const given = manifest();

    expect(applyLaunchOptions(given, options())).toBe(given);
    // Stats are drawn by the client, so a build never hears of them.
    expect(applyLaunchOptions(given, options({ stats: true }))).toBe(given);
  });

  it('force WebGL2 where both a build and its rendering say it, on a copy', () => {
    const given = manifest();
    const before = structuredClone(given);

    const applied = applyLaunchOptions(given, options({ forceWebGL: true }));

    expect(applied.forceWebGL).toBe(true);
    expect(applied.rendering?.forceWebGL).toBe(true);
    expect(given).toEqual(before);
  });

  it('never take away what the project forces itself', () => {
    const forced = manifest({
      forceWebGL: true,
      rendering: { ...createRenderingSettings(), forceWebGL: true },
    });

    const applied = applyLaunchOptions(forced, options({ maxPixelRatio: 1 }));

    expect(applied.forceWebGL).toBe(true);
    expect(applied.rendering?.forceWebGL).toBe(true);
  });

  it('cap the pixel ratio, or keep the project’s', () => {
    expect(applyLaunchOptions(manifest(), options({ maxPixelRatio: 1 })).rendering?.maxPixelRatio).toBe(1);
    expect(
      applyLaunchOptions(manifest(), options({ forceWebGL: true })).rendering?.maxPixelRatio,
    ).toBe(2);
  });

  it('never write stats into a build', () => {
    const applied = applyLaunchOptions(manifest(), options({ forceWebGL: true, stats: true }));

    expect(JSON.stringify(applied)).not.toContain('stats');
  });

  it('give a manifest without rendering settings the factory’s, with its own forceWebGL', () => {
    // How the player reads a build written before `rendering` existed.
    const old = manifest({ forceWebGL: true, rendering: undefined });

    const applied = applyLaunchOptions(old, options({ maxPixelRatio: 1.5 }));

    expect(applied.rendering).toEqual({
      ...createRenderingSettings(),
      forceWebGL: true,
      maxPixelRatio: 1.5,
    });
  });
});
