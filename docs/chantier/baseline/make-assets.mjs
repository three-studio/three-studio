#!/usr/bin/env node
/**
 * Fills a project's `assets/` with textures, so the asset scan has something to
 * scan.
 *
 *   node docs/chantier/baseline/make-assets.mjs <project-dir> [count]
 *
 * Run it after `make-scene.mjs`, on the same directory. Three thousand by
 * default, which is what T-019 measured against — the point of T-061 is to
 * check that number, so the count has to be the same one.
 *
 * **The files are real PNGs and they are tiny, and only the first scan cares.**
 * `scanAssets` hashes a file the once, when it writes the sidecar that file has
 * never had; from then on it stats the sidecar and reads nothing. So the size of
 * these has no bearing on the numbers the index is about, and 3000 real textures
 * would be a gigabyte of scratch to prove it.
 *
 * Thirty folders rather than one flat directory, because a real project has
 * folders and because renaming one is the cheapest way to invalidate a hundred
 * index entries at once — see `measure-assets.js`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ASSETS_DIR, ASSET_KIND_INFO } from '@three-studio/core';

const [target, rawCount] = process.argv.slice(2);
if (!target) {
  console.error('usage: node docs/chantier/baseline/make-assets.mjs <project-dir> [count]');
  process.exit(1);
}

const COUNT = Number(rawCount ?? 3000);
const FOLDERS = 30;
const SIDE = 16;

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A flat 16 × 16 RGB PNG in the given colour.
 *
 * Written by hand rather than pulled from a dependency, and a real one rather
 * than a file with a `.png` on the end: the Project panel puts an `<img>` on
 * every texture tile it shows, and three thousand broken images is a different
 * measurement from three thousand textures.
 *
 * The colour varies per file so no two have the same bytes. Identical files
 * would hash identically, and a scan that produced three thousand copies of one
 * hash is not the scan a real project performs.
 */
function png(index) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIDE, 0);
  header.writeUInt32BE(SIDE, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const [r, g, b] = [(index >> 16) & 0xff, (index >> 8) & 0xff, index & 0xff];

  // One filter byte per row, then the row's pixels. Filter 0 is "none".
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(SIDE * 3).fill(0)]);
  for (let x = 0; x < SIDE; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: SIDE }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(target, ASSETS_DIR, ASSET_KIND_INFO.texture.directory);
const width = String(COUNT - 1).length;

for (let folder = 0; folder < FOLDERS; folder++) {
  await mkdir(join(root, `pack-${String(folder).padStart(2, '0')}`), { recursive: true });
}

const writes = [];
for (let i = 0; i < COUNT; i++) {
  const folder = `pack-${String(i % FOLDERS).padStart(2, '0')}`;
  const name = `tex-${String(i).padStart(width, '0')}.png`;
  writes.push(writeFile(join(root, folder, name), png(i)));
}
await Promise.all(writes);

console.log(`${target}: ${COUNT} textures in ${FOLDERS} folders`);
