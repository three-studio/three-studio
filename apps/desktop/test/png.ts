import { crc32, deflateSync } from 'node:zlib';

/*
 * PNGs made by hand, for the tests of a device's screenshot. The main process
 * reads nothing of a PNG but its header, so a real file of a known size is all
 * a test needs, and its bytes can then be made wrong one at a time.
 */

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const named = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(named));
  return Buffer.concat([length, named, crc]);
}

/** An opaque grey image, 8-bit RGBA, as a canvas encodes one. */
export function pngOf(width = 3, height = 2): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA; compression, filter and interlace stay 0
  const row = Buffer.alloc(1 + width * 4, 0x80);
  row[0] = 0; // each row starts with its filter: none
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', new Uint8Array()),
  ]);
}
