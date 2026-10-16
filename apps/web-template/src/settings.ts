import {
  createPhysicsSettings,
  createRenderingSettings,
  type BuildManifest,
  type PhysicsSettings,
  type RenderingSettings,
} from '@three-studio/core';

/**
 * One reading of the settings a build runs with, shared by the renderer and the
 * engine — the same shape the editor viewport uses.
 *
 * Each falls back to what a build from before its field ran on. Rendering: the
 * factory, with the one field the player read before `rendering` existed.
 * Physics: the factory, the numbers the engine defaulted to while the player
 * passed it nothing.
 */
export function runSettingsOf(build: BuildManifest): {
  rendering: RenderingSettings;
  physics: PhysicsSettings;
} {
  return {
    rendering: build.rendering ?? { ...createRenderingSettings(), forceWebGL: build.forceWebGL },
    physics: build.physics ?? createPhysicsSettings(),
  };
}
