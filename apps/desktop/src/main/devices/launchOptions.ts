import type { BuildManifest, DeviceLaunchOptions } from '@three-studio/core';

/**
 * The manifest a device is served: the launch's, with the launch options the
 * renderer reads written into its rendering settings.
 *
 * Applied as `build.json` is served rather than kept in the launch, so that an
 * option changed while devices run needs no new launch — no snapshot, no
 * compile, no scan: the devices restart and fetch it. And written where the
 * player reads any export's settings, so that neither it nor the runtime has a
 * notion of a device, or of options.
 *
 * Forcing WebGL2 only ever adds to what the project says: unticking it gives
 * the project's own choice back, which may force it too. Stats on screen are
 * the client's to draw, and never part of a build.
 */
export function applyLaunchOptions(
  manifest: BuildManifest,
  options: DeviceLaunchOptions,
): BuildManifest {
  if (!options.forceWebGL && options.maxPixelRatio === null) return manifest;
  const { rendering } = manifest;
  return {
    ...manifest,
    rendering: {
      ...rendering,
      forceWebGL: rendering.forceWebGL || options.forceWebGL,
      maxPixelRatio: options.maxPixelRatio ?? rendering.maxPixelRatio,
    },
  };
}
