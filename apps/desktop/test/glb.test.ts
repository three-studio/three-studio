import { describe, expect, it } from 'vitest';
import { readGlb, rewriteEmbeddedImages, writeGlb, type GltfJson } from '../src/main/glb';

/*
 * The GLB container, taken apart and put back together.
 *
 * The images in a `.glb` have no sidecar, no id and no row in the project, so
 * the only way to cap their size is to write the file out again with different
 * bytes in their views. Everything else in the file has to survive that
 * untouched — and "untouched" here means the accessors still address the same
 * numbers, which is not something a viewer would tell you about: bad offsets
 * decode into geometry, just the wrong geometry.
 */

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** A `.glb` built by hand, so the bytes under the test are known exactly. */
function glb(json: GltfJson, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (n: number) => (n + 3) & ~3;
  const jsonPadded = Buffer.alloc(pad(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonPadded);
  const binPadded = Buffer.alloc(pad(bin.length));
  bin.copy(binPadded);

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonPadded.copy(out, 20);
  out.writeUInt32LE(binPadded.length, 20 + jsonPadded.length);
  out.writeUInt32LE(BIN_CHUNK, 24 + jsonPadded.length);
  binPadded.copy(out, 28 + jsonPadded.length);
  return out;
}

/** Geometry, then two images, in one blob. */
const MESH = Buffer.from('MESHDATA');
const FIRST = Buffer.from('IMAGE-ONE-BYTES!');
const SECOND = Buffer.from('IMAGE-TWO');

function sample(over: Partial<GltfJson> = {}): { json: GltfJson; bin: Buffer } {
  const bin = Buffer.concat([MESH, FIRST, SECOND]);
  const json: GltfJson = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: MESH.length },
      { buffer: 0, byteOffset: MESH.length, byteLength: FIRST.length },
      { buffer: 0, byteOffset: MESH.length + FIRST.length, byteLength: SECOND.length },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }],
    images: [
      { bufferView: 1, mimeType: 'image/jpeg' },
      { bufferView: 2, mimeType: 'image/png' },
    ],
    ...over,
  };
  return { json, bin };
}

/** Stands in for the scaler: shorter bytes, so every offset after it moves. */
const shrink = (bytes: Buffer, mimeType: string): Buffer | null =>
  mimeType === 'image/jpeg' ? Buffer.from('SM') : null;

describe('reading and writing the container', () => {
  it('survives a round trip with its document and its blob intact', () => {
    const { json, bin } = sample();

    const read = readGlb(glb(json, bin));
    expect(read?.json).toEqual(json);
    expect(read?.bin.subarray(0, bin.length)).toEqual(bin);

    // And again from what this writes, which is the half that matters: the
    // file has to be readable by three, not only by this.
    const again = readGlb(writeGlb({ json, bin }));
    expect(again?.json).toEqual(json);
    expect(again?.bin.subarray(0, bin.length)).toEqual(bin);
  });

  it('pads every chunk to four bytes, which the format requires', () => {
    // An odd-length blob and a JSON string of no particular length.
    const written = writeGlb({ json: { buffers: [{ byteLength: 3 }] }, bin: Buffer.from('abc') });

    expect(written.length % 4).toBe(0);
    expect(written.readUInt32LE(8)).toBe(written.length);
    expect(written.readUInt32LE(12) % 4).toBe(0);
  });

  it('refuses what it cannot put back together', () => {
    expect(readGlb(Buffer.from('not a glb at all'))).toBeNull();
    // Version 1 is a different container entirely.
    const wrongVersion = glb(sample().json, sample().bin);
    wrongVersion.writeUInt32LE(1, 4);
    expect(readGlb(wrongVersion)).toBeNull();
  });
});

describe('replacing the images inside', () => {
  it('moves every view that follows a replaced one, and keeps the rest byte for byte', () => {
    const rewritten = rewriteEmbeddedImages(sample(), shrink);
    const views = rewritten?.json.bufferViews ?? [];
    const bin = rewritten?.bin ?? Buffer.alloc(0);

    // The geometry is the point: an accessor addresses it through view 0, so
    // those bytes have to still be those bytes.
    expect(bin.subarray(views[0]!.byteOffset!, views[0]!.byteOffset! + views[0]!.byteLength))
      .toEqual(MESH);
    expect(bin.subarray(views[1]!.byteOffset!, views[1]!.byteOffset! + views[1]!.byteLength))
      .toEqual(Buffer.from('SM'));
    // Untouched, but relocated: it sat after an image that got shorter.
    expect(bin.subarray(views[2]!.byteOffset!, views[2]!.byteOffset! + views[2]!.byteLength))
      .toEqual(SECOND);
  });

  it('keeps every view on a four-byte boundary, which accessors depend on', () => {
    const rewritten = rewriteEmbeddedImages(sample(), shrink);

    for (const view of rewritten?.json.bufferViews ?? []) {
      expect(view.byteOffset! % 4).toBe(0);
    }
  });

  it('restates the buffer length, which no longer matches the source', () => {
    const rewritten = rewriteEmbeddedImages(sample(), shrink);

    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
    expect(rewritten?.bin.length).toBeLessThan(sample().bin.length);
  });

  it('leaves the accessors and the images alone, since they address by index', () => {
    const before = sample().json;
    const rewritten = rewriteEmbeddedImages(sample(), shrink);

    expect(rewritten?.json.accessors).toEqual(before.accessors);
    expect(rewritten?.json.images).toEqual(before.images);
  });

  it('says nothing changed when no image was worth scaling', () => {
    // `null` is "serve the source". Writing an identical copy would double the
    // largest files in the project on disk for no gain at all.
    expect(rewriteEmbeddedImages(sample(), () => null)).toBeNull();
    expect(rewriteEmbeddedImages({ json: { buffers: [{ byteLength: 0 }] }, bin: Buffer.alloc(0) }, shrink))
      .toBeNull();
  });

  it('refuses a meshopt-compressed file rather than corrupting it', () => {
    // Its `bufferView.extensions` entry addresses the blob directly rather than
    // through the view it hangs off, so moving views and rewriting only their
    // own offsets leaves it pointing at the wrong bytes — and the geometry
    // decodes into noise with nothing in the file to say why.
    const { json, bin } = sample({ extensionsUsed: ['EXT_meshopt_compression'] });
    expect(rewriteEmbeddedImages({ json, bin }, shrink)).toBeNull();
  });

  it('refuses a file whose bytes are not all in it', () => {
    const external = sample({ buffers: [{ byteLength: 10, uri: 'scene.bin' }] });
    expect(rewriteEmbeddedImages(external, shrink)).toBeNull();
  });
});
