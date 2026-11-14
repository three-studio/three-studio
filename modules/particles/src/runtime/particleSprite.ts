import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three/webgpu';

/*
 * The sprite a particle draws until an author gives it one.
 *
 * There has to be a default, for the reason `waterNormals.ts` gives about its
 * own: this project ships no binary assets at all, and adding its first for a
 * fallback is a poor trade. Generated instead — a soft disc, which is the shape
 * every particle system's built-in sprite is.
 *
 * A disc rather than nothing, and this is the part worth knowing: with no map
 * the sprite is a *square*, and a hundred overlapping squares read as broken
 * geometry rather than as smoke. Sampling a texture unconditionally is also
 * what lets an author's sprite be swapped in by writing one uniform, instead of
 * rebuilding the shader around an `if`.
 */

/** Small on purpose: it is a radial ramp, and nothing here has detail to lose. */
const SIZE = 64;

let generated: DataTexture | null = null;

/**
 * The built-in particle sprite, generated once per document.
 *
 * Shared by every emitter and never retired — one 16 KB buffer with no owner,
 * and handing it to the arena would let the last emitter deleted dispose
 * something the next one is about to ask for.
 */
export function defaultParticleSprite(): DataTexture {
  if (generated) return generated;

  const data = new Uint8Array(SIZE * SIZE * 4);
  const centre = (SIZE - 1) / 2;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // 0 at the centre, 1 at the edge of the inscribed circle, more in the
      // corners — which `clamp` throws away, so the disc stays a disc.
      const distance = Math.hypot(x - centre, y - centre) / centre;
      const falloff = Math.max(0, 1 - Math.min(distance, 1));
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // Squared, so the edge fades out rather than ending in a visible rim.
      data[i + 3] = Math.round(falloff * falloff * 255);
    }
  }

  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  // Clamped, not repeated: a particle samples the whole sprite once, and a
  // wrapped edge would fold the far side of the disc back over itself.
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  // No mipmaps: a particle is never minified far enough for one to help, and
  // the chain would blur the disc's alpha into a grey square at distance.
  texture.generateMipmaps = false;
  // White with an alpha ramp is a colour, unlike a normal map: it is multiplied
  // by the emitter's own colour, which the document stores as sRGB.
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  generated = texture;
  return texture;
}
