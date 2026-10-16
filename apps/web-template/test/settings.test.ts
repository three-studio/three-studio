import { createPhysicsSettings, createRenderingSettings, type BuildManifest } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { runSettingsOf } from '../src/settings';

/*
 * What the player runs with, from whatever format of `build.json` it was handed.
 * A build is persisted data, so every older shape still has to start.
 */

function build(overrides: Partial<BuildManifest> = {}): BuildManifest {
  return { title: 'Game', forceWebGL: false, scenes: ['main'], scripts: null, ...overrides };
}

describe('the settings a build runs with', () => {
  it('runs on the factory physics when the build carries none', () => {
    expect(runSettingsOf(build()).physics).toEqual(createPhysicsSettings());
  });

  it('runs on the build physics, whole, when it carries them', () => {
    const physics = { gravity: [0, -3, 0] as [number, number, number], fixedTimestep: 1 / 120, maxSubsteps: 2 };
    expect(runSettingsOf(build({ physics })).physics).toEqual(physics);
  });

  it('runs on the build rendering, whole, when it carries them', () => {
    const rendering = { ...createRenderingSettings(), exposure: 1.5, antialias: false };
    expect(runSettingsOf(build({ rendering })).rendering).toEqual(rendering);
  });

  it('keeps forceWebGL from a build older than its rendering settings', () => {
    expect(runSettingsOf(build({ forceWebGL: true })).rendering).toEqual({
      ...createRenderingSettings(),
      forceWebGL: true,
    });
  });
});
