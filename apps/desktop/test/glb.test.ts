import { describe, expect, it } from 'vitest';
import { readGlb, rewriteGlb, writeGlb, type GlbContents, type GltfJson } from '../src/main/glb';

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
    const rewritten = rewriteGlb(sample(), shrink);
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
    const rewritten = rewriteGlb(sample(), shrink);

    for (const view of rewritten?.json.bufferViews ?? []) {
      expect(view.byteOffset! % 4).toBe(0);
    }
  });

  it('restates the buffer length, which no longer matches the source', () => {
    const rewritten = rewriteGlb(sample(), shrink);

    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
    expect(rewritten?.bin.length).toBeLessThan(sample().bin.length);
  });

  it('leaves the accessors and the images alone, since they address by index', () => {
    const before = sample().json;
    const rewritten = rewriteGlb(sample(), shrink);

    expect(rewritten?.json.accessors).toEqual(before.accessors);
    expect(rewritten?.json.images).toEqual(before.images);
  });

  it('says nothing changed when no image was worth scaling', () => {
    // `null` is "serve the source". Writing an identical copy would double the
    // largest files in the project on disk for no gain at all.
    expect(rewriteGlb(sample(), () => null)).toBeNull();
    expect(rewriteGlb({ json: { buffers: [{ byteLength: 0 }] }, bin: Buffer.alloc(0) }, shrink))
      .toBeNull();
  });

  it('refuses a meshopt-compressed file rather than corrupting it', () => {
    // Its `bufferView.extensions` entry addresses the blob directly rather than
    // through the view it hangs off, so moving views and rewriting only their
    // own offsets leaves it pointing at the wrong bytes — and the geometry
    // decodes into noise with nothing in the file to say why.
    const { json, bin } = sample({ extensionsUsed: ['EXT_meshopt_compression'] });
    expect(rewriteGlb({ json, bin }, shrink)).toBeNull();
  });

  it('refuses a file whose bytes are not all in it', () => {
    const external = sample({ buffers: [{ byteLength: 10, uri: 'scene.bin' }] });
    expect(rewriteGlb(external, shrink)).toBeNull();
  });
});

/*
 * Narrowing the indices.
 *
 * The bytes an accessor addresses move when an accessor *before it in the same
 * view* gets shorter, which is the whole difference between this and replacing
 * an image: a view is no longer a span to copy, it is a list of accessors to
 * lay out again. Every test below reads its numbers back through the document
 * — component type, view offset, accessor offset — because that is the only
 * thing that catches an offset which is wrong but plausible.
 */

const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;

function uint32(values: readonly number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, at) => out.writeUInt32LE(value, at * 4));
  return out;
}

/** Two index accessors sharing one view, then an image. */
const NARROW = [0, 1, 2, 65535, 4, 5] as const;
const WIDE = [6, 7, 65536] as const;

function indexed(over: Partial<GltfJson> = {}): GlbContents {
  const narrow = uint32(NARROW);
  const wide = uint32(WIDE);
  const bin = Buffer.concat([narrow, wide, FIRST]);

  const json: GltfJson = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: narrow.length + wide.length },
      { buffer: 0, byteOffset: narrow.length + wide.length, byteLength: FIRST.length },
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: UNSIGNED_INT, count: NARROW.length, type: 'SCALAR' },
      {
        bufferView: 0,
        byteOffset: narrow.length,
        componentType: UNSIGNED_INT,
        count: WIDE.length,
        type: 'SCALAR',
      },
    ],
    meshes: [{ primitives: [{ indices: 0 }, { indices: 1 }] }],
    images: [{ bufferView: 1, mimeType: 'image/png' }],
    ...over,
  };
  return { json, bin };
}

/** The numbers an accessor holds, found the way a loader would find them. */
function indicesOf(contents: GlbContents, at: number): number[] {
  const accessor = contents.json.accessors?.[at];
  const view = contents.json.bufferViews?.[accessor?.bufferView ?? -1];
  if (!accessor || !view) return [];

  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const wide = accessor.componentType === UNSIGNED_INT;
  return Array.from({ length: accessor.count }, (_, index) =>
    wide ? contents.bin.readUInt32LE(start + index * 4) : contents.bin.readUInt16LE(start + index * 2),
  );
}

describe('narrowing the indices', () => {
  it('halves the ones that fit and leaves the ones that do not', () => {
    const rewritten = rewriteGlb(indexed(), () => null);

    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_SHORT);
    // One value at 65536 is enough. Narrowing it would wrap it to 0 — a
    // triangle quietly pointing at the wrong vertex, which is the failure this
    // whole file is careful about.
    expect(rewritten?.json.accessors?.[1]?.componentType).toBe(UNSIGNED_INT);
  });

  it('still reads back the same numbers, both of them', () => {
    const rewritten = rewriteGlb(indexed(), () => null);

    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
    // The one that moved: it sat after an accessor that halved, so its offset
    // inside the view is not the one it arrived with.
    expect(indicesOf(rewritten!, 1)).toEqual([...WIDE]);
    expect(rewritten?.json.accessors?.[1]?.byteOffset).not.toBe(indexed().json.accessors?.[1]?.byteOffset);
  });

  it('restates the view and the buffer, which are both shorter now', () => {
    const source = indexed();
    const rewritten = rewriteGlb(source, () => null);

    expect(rewritten?.json.bufferViews?.[0]?.byteLength).toBe(
      NARROW.length * 2 + WIDE.length * 4,
    );
    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
    expect(rewritten?.bin.length).toBeLessThan(source.bin.length);
  });

  it('keeps every view on a four-byte boundary, and every accessor inside one', () => {
    const rewritten = rewriteGlb(indexed(), () => null);

    for (const view of rewritten?.json.bufferViews ?? []) expect(view.byteOffset! % 4).toBe(0);
    for (const accessor of rewritten?.json.accessors ?? []) {
      expect((accessor.byteOffset ?? 0) % 4).toBe(0);
    }
  });

  it('narrows an accessor two primitives share, once', () => {
    const shared = indexed({ meshes: [{ primitives: [{ indices: 0 }, { indices: 0 }] }] });
    const rewritten = rewriteGlb(shared, () => null);

    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_SHORT);
    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
  });

  it('scales the images in the same pass', () => {
    const rewritten = rewriteGlb(indexed(), () => Buffer.from('SM'));
    const views = rewritten?.json.bufferViews ?? [];

    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
    expect(rewritten?.bin.subarray(views[1]!.byteOffset!, views[1]!.byteOffset! + 2))
      .toEqual(Buffer.from('SM'));
  });

  it('says nothing changed when every index already fits its width', () => {
    const already = indexed({
      meshes: [{ primitives: [{ indices: 1 }] }],
      images: [],
    });
    // Accessor 1 holds 65536, so there is nothing to narrow and no image to
    // scale: writing an identical copy of a large model would be the one thing
    // worse than leaving it alone.
    expect(rewriteGlb(already, () => null)).toBeNull();
  });
});

describe('the views it will not repack', () => {
  /*
   * Each of these leaves the file readable rather than refusing it: the view is
   * carried over byte for byte, the rest of the document is still rebuilt, and
   * an index that could not be narrowed is only an index that stayed wide.
   *
   * So each one scales an image, to make the rewrite actually happen. A test
   * that only asserted `null` would pass just as well against a version that
   * refused the whole file, which is a different behaviour.
   */

  const bothViews: Partial<GltfJson> = {
    images: [
      { bufferView: 0, mimeType: 'image/png' },
      { bufferView: 1, mimeType: 'image/png' },
    ],
  };

  /** Asserts the index accessors came through exactly as they arrived. */
  function untouched(rewritten: GlbContents | null): void {
    expect(rewritten).not.toBeNull();
    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_INT);
    expect(rewritten?.json.accessors?.[1]?.componentType).toBe(UNSIGNED_INT);
    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
    expect(indicesOf(rewritten!, 1)).toEqual([...WIDE]);
  }

  it('leaves a view an image also addresses, and does not scale that image either', () => {
    // The dangerous overlap, and repacking is not the half that bites: a scaled
    // image is a *different length*, so the accessor's offset would land in the
    // middle of a JPEG. Neither half happens — while the other image, on a view
    // of its own, is scaled as usual.
    const rewritten = rewriteGlb(indexed(bothViews), () => Buffer.from('SM'));
    const views = rewritten?.json.bufferViews ?? [];

    untouched(rewritten);
    expect(views[0]?.byteLength).toBe(indexed().json.bufferViews?.[0]?.byteLength);
    expect(rewritten?.bin.subarray(views[1]!.byteOffset!, views[1]!.byteOffset! + 2))
      .toEqual(Buffer.from('SM'));
  });

  it('leaves an interleaved view alone', () => {
    // Accessors take turns inside one stride there; laying them out end to end
    // would be a different file.
    const interleaved = indexed();
    interleaved.json.bufferViews![0]!.byteStride = 4;

    untouched(rewriteGlb(interleaved, () => Buffer.from('SM')));
  });

  it('leaves a view carrying its own extension alone', () => {
    const extended = indexed();
    extended.json.bufferViews![0]!.extensions = { EXT_something: {} };

    untouched(rewriteGlb(extended, () => Buffer.from('SM')));
  });

  it('repacks nothing at all once one accessor is sparse', () => {
    // A sparse accessor keeps its indices and its values in other views, at
    // offsets it holds itself and this does not follow. One is enough to stop
    // every repack in the file — they are unheard of in models, so the blunt
    // answer costs nothing and a subtle one could move bytes it points at.
    const sparse = indexed();
    sparse.json.accessors![1]!.sparse = { count: 1 };

    untouched(rewriteGlb(sparse, () => Buffer.from('SM')));
  });
});
