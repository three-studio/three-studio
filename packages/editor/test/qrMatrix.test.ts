import { decodeQR } from 'qr/decode.js';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath } from '../src/ui/qrMatrix';

/*
 * The code a phone's camera turns into the device link. Read back by the
 * decoder that ships beside the encoder, from pixels laid out the way the SVG
 * draws the modules — so what is checked is what a camera is shown.
 */

const TOKEN = 'abcdefghijKLMNOPQRST01';

/** Pixels per module, as a camera would see a code drawn at a few pixels each. */
const SCALE = 4;

/** The code as an RGBA image: dark modules 0, light ones 255. */
function rasterize(matrix: readonly (readonly boolean[])[]): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const height = matrix.length * SCALE;
  const width = (matrix[0]?.length ?? 0) * SCALE;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = matrix[Math.floor(y / SCALE)]![Math.floor(x / SCALE)] ? 0 : 255;
      data.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('the code of a link', () => {
  it.each([
    `http://192.168.1.42:7700/${TOKEN}/`,
    `http://100.101.102.103:65535/${TOKEN}/`,
    `https://100.101.102.103:65535/${TOKEN}/`,
  ])('reads back as %s', (text) => {
    expect(decodeQR(rasterize(qrMatrix(text)))).toBe(text);
  });

  it('is ringed by four light modules', () => {
    // The quiet zone the standard asks for, without which some cameras never
    // find the code against whatever surrounds it on screen.
    const matrix = qrMatrix(`http://192.168.1.42:7700/${TOKEN}/`);
    const last = matrix.length - 1;

    for (let ring = 0; ring < 4; ring += 1) {
      expect(matrix[ring]!.some(Boolean)).toBe(false);
      expect(matrix[last - ring]!.some(Boolean)).toBe(false);
      expect(matrix.some((row) => row[ring] || row[last - ring])).toBe(false);
    }
    // Just inside it, the corner of a finder pattern.
    expect(matrix[4]![4]).toBe(true);
  });
});

describe('the path the SVG draws', () => {
  it('is one rectangle per run of dark modules along a row', () => {
    expect(
      qrPath([
        [true, true, false],
        [false, false, true],
      ]),
    ).toBe('M0 0h2v1h-2zM2 1h1v1h-1z');
  });
});
