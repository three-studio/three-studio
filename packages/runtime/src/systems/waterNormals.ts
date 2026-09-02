import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  RepeatWrapping,
} from 'three/webgpu';

/*
 * The normal map a water surface uses until an author gives it one.
 *
 * `WaterMesh` samples its normal map four times per pixel at four different
 * scales and takes the average as the wave normal. With no texture at all it
 * gets `undefined` and throws; with a flat one it is a mirror. So there has to
 * be a default, and this project ships no images — the repository has no binary
 * assets at all, and adding its first for a fallback is a poor trade.
 *
 * Generated instead, from a sum of sines. Integer frequencies are the whole
 * trick: a sine whose period divides the texture exactly is continuous across
 * the wrap, so the tile has no seam, and the gradient is analytic rather than a
 * finite difference — so is the normal.
 */

/** Enough to look like water at the four scales `WaterMesh` samples it at. */
const SIZE = 256;

/**
 * Integer frequencies, amplitudes, and phases.
 *
 * Chosen coprime-ish and unaligned so the sum does not resolve into a visible
 * grid — the failure mode of a two-wave version, which reads as corduroy.
 */
const WAVES: readonly [fx: number, fy: number, amplitude: number, phase: number][] = [
  [1, 2, 1, 0],
  [3, 1, 0.6, 1.7],
  [2, 5, 0.4, 3.1],
  [5, 3, 0.3, 0.6],
  [7, 6, 0.18, 2.2],
  [11, 9, 0.1, 4.4],
];

/**
 * How steep the surface is. Not a wave height in metres: the shader scales what
 * it reads by `distortionScale`, so this only has to put the normals in a range
 * that still looks like a surface after that.
 */
const STEEPNESS = 0.35;

let generated: DataTexture | null = null;

/**
 * The built-in normal map, generated once per document.
 *
 * Shared by every water surface and never retired — it is one 256 KB buffer
 * with no owner, and handing it to the arena would let the last surface to be
 * deleted dispose something the next one is about to ask for.
 */
export function defaultWaterNormals(): DataTexture {
  if (generated) return generated;

  const data = new Uint8Array(SIZE * SIZE * 4);
  const step = (2 * Math.PI) / SIZE;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // Slope, summed analytically: the derivative of `A sin(f·u + p)` is
      // `A f cos(f·u + p)`, so no neighbouring texel is ever read.
      let dx = 0;
      let dy = 0;
      for (const [fx, fy, amplitude, phase] of WAVES) {
        const angle = (fx * x + fy * y) * step + phase;
        const slope = amplitude * Math.cos(angle);
        dx += slope * fx;
        dy += slope * fy;
      }

      // The surface normal is the height field's gradient, negated, with the
      // vertical component at 1 — then normalised into a tangent-space normal.
      const nx = -dx * STEEPNESS;
      const ny = -dy * STEEPNESS;
      const length = Math.hypot(nx, ny, 1);

      const i = (y * SIZE + x) * 4;
      data[i] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / length) * 255);
      data[i + 3] = 255;
    }
  }

  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // A normal map carries directions, not colour, and the same slot on a
  // material asset is set the same way — see `TEXTURE_SLOTS` in `material.ts`.
  // Left in sRGB the slopes come back through the transfer function.
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;

  generated = texture;
  return texture;
}
