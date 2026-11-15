import { crc32, deflateSync } from 'node:zlib';

/*
 * PNG files written from a row function, for the recipes that need images.
 *
 * Real PNGs rather than files with a `.png` on the end: the Project panel puts
 * an `<img>` on every texture tile, and the editor decodes every image a model
 * carries, so a file that does not decode measures a different path. Written
 * here rather than taken from a dependency, because truecolour, one IDAT and
 * filter 0 are the whole of what the recipes need, and `node:zlib` has both the
 * deflate and the CRC.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGB = 3;

/** One chunk: its length, its type, its data, and the CRC over type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  // Incremental, so a 50 MB IDAT is never concatenated to its four-byte type
  // just to be checksummed.
  tail.writeUInt32BE(crc32(data, crc32(head.subarray(4))), 0);
  return Buffer.concat([head, data, tail]);
}

export interface PngImage {
  readonly width: number;
  readonly height: number;
  /** Writes row `y` into `rgb`: `width` pixels of red, green and blue, one byte each. */
  readonly fillRow: (y: number, rgb: Buffer) => void;
  /** zlib's level, 0 to 9. The big recipes trade a few bytes for seconds. */
  readonly level?: number;
}

/** An 8-bit truecolour PNG of the image. */
export function encodePng({ width, height, fillRow, level = 6 }: PngImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // Bytes 10–12 stay 0: deflate, the only filter method, no interlace.

  // One filter byte per row, then the row's pixels. Filter 0 is "none", which
  // is why each row is written straight into the scanline it will be read from.
  const stride = 1 + width * RGB;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    fillRow(y, raw.subarray(y * stride + 1, (y + 1) * stride));
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
