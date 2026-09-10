import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  readGlb,
  rewriteGlb,
  writeGlb,
  type GlbContents,
  type EncodeMode,
  type GltfJson,
  type RewriteOptions,
} from '../src/main/glb';

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

/** Options with the lossy half off, which is what all of these want but one. */
const options = (
  scaleImage: (bytes: Buffer, mimeType: string) => Buffer | null = () => null,
): RewriteOptions => ({ scaleImage, quantizeNormals: false, encodeGeometry: null });

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
    const rewritten = rewriteGlb(sample(), options(shrink));
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
    const rewritten = rewriteGlb(sample(), options(shrink));

    for (const view of rewritten?.json.bufferViews ?? []) {
      expect(view.byteOffset! % 4).toBe(0);
    }
  });

  it('restates the buffer length, which no longer matches the source', () => {
    const rewritten = rewriteGlb(sample(), options(shrink));

    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
    expect(rewritten?.bin.length).toBeLessThan(sample().bin.length);
  });

  it('leaves the accessors and the images alone, since they address by index', () => {
    const before = sample().json;
    const rewritten = rewriteGlb(sample(), options(shrink));

    expect(rewritten?.json.accessors).toEqual(before.accessors);
    expect(rewritten?.json.images).toEqual(before.images);
  });

  it('says nothing changed when no image was worth scaling', () => {
    // `null` is "serve the source". Writing an identical copy would double the
    // largest files in the project on disk for no gain at all.
    expect(rewriteGlb(sample(), options())).toBeNull();
    expect(rewriteGlb({ json: { buffers: [{ byteLength: 0 }] }, bin: Buffer.alloc(0) }, options(shrink)))
      .toBeNull();
  });

  it('refuses a meshopt-compressed file rather than corrupting it', () => {
    // Its `bufferView.extensions` entry addresses the blob directly rather than
    // through the view it hangs off, so moving views and rewriting only their
    // own offsets leaves it pointing at the wrong bytes — and the geometry
    // decodes into noise with nothing in the file to say why.
    const { json, bin } = sample({ extensionsUsed: ['EXT_meshopt_compression'] });
    expect(rewriteGlb({ json, bin }, options(shrink))).toBeNull();
  });

  it('refuses a file whose bytes are not all in it', () => {
    const external = sample({ buffers: [{ byteLength: 10, uri: 'scene.bin' }] });
    expect(rewriteGlb(external, options(shrink))).toBeNull();
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
    const rewritten = rewriteGlb(indexed(), options());

    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_SHORT);
    // One value at 65536 is enough. Narrowing it would wrap it to 0 — a
    // triangle quietly pointing at the wrong vertex, which is the failure this
    // whole file is careful about.
    expect(rewritten?.json.accessors?.[1]?.componentType).toBe(UNSIGNED_INT);
  });

  it('still reads back the same numbers, both of them', () => {
    const rewritten = rewriteGlb(indexed(), options());

    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
    // The one that moved: it sat after an accessor that halved, so its offset
    // inside the view is not the one it arrived with.
    expect(indicesOf(rewritten!, 1)).toEqual([...WIDE]);
    expect(rewritten?.json.accessors?.[1]?.byteOffset).not.toBe(indexed().json.accessors?.[1]?.byteOffset);
  });

  it('restates the view and the buffer, which are both shorter now', () => {
    const source = indexed();
    const rewritten = rewriteGlb(source, options());

    expect(rewritten?.json.bufferViews?.[0]?.byteLength).toBe(
      NARROW.length * 2 + WIDE.length * 4,
    );
    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
    expect(rewritten?.bin.length).toBeLessThan(source.bin.length);
  });

  it('keeps every view on a four-byte boundary, and every accessor inside one', () => {
    const rewritten = rewriteGlb(indexed(), options());

    for (const view of rewritten?.json.bufferViews ?? []) expect(view.byteOffset! % 4).toBe(0);
    for (const accessor of rewritten?.json.accessors ?? []) {
      expect((accessor.byteOffset ?? 0) % 4).toBe(0);
    }
  });

  it('narrows an accessor two primitives share, once', () => {
    const shared = indexed({ meshes: [{ primitives: [{ indices: 0 }, { indices: 0 }] }] });
    const rewritten = rewriteGlb(shared, options());

    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_SHORT);
    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
  });

  it('scales the images in the same pass', () => {
    const rewritten = rewriteGlb(indexed(), options(() => Buffer.from('SM')));
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
    expect(rewriteGlb(already, options())).toBeNull();
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
    const rewritten = rewriteGlb(indexed(bothViews), options(() => Buffer.from('SM')));
    const views = rewritten?.json.bufferViews ?? [];

    untouched(rewritten);
    expect(views[0]?.byteLength).toBe(indexed().json.bufferViews?.[0]?.byteLength);
    expect(rewritten?.bin.subarray(views[1]!.byteOffset!, views[1]!.byteOffset! + 2))
      .toEqual(Buffer.from('SM'));
  });

  it('leaves a genuinely interleaved view alone', () => {
    // Accessors take turns inside one stride there; laying them out end to end
    // would be a different file. Eight and not four: a stride of *exactly* one
    // element is what the spec asks for whenever two accessors share a view,
    // the data under it is already contiguous, and refusing that one would
    // refuse the ordinary shape every exporter writes.
    const interleaved = indexed();
    interleaved.json.bufferViews![0]!.byteStride = 8;

    untouched(rewriteGlb(interleaved, options(() => Buffer.from('SM'))));
  });

  it('repacks a view whose stride is exactly one element', () => {
    const decorative = indexed();
    decorative.json.bufferViews![0]!.byteStride = 4;
    const rewritten = rewriteGlb(decorative, options());

    expect(rewritten?.json.accessors?.[0]?.componentType).toBe(UNSIGNED_SHORT);
    expect(indicesOf(rewritten!, 0)).toEqual([...NARROW]);
    // And the stride goes: indices are tightly packed, and the spec says a view
    // used for them must not declare one.
    expect(rewritten?.json.bufferViews?.[0]?.byteStride).toBeUndefined();
  });

  it('leaves a view carrying its own extension alone', () => {
    const extended = indexed();
    extended.json.bufferViews![0]!.extensions = { EXT_something: {} };

    untouched(rewriteGlb(extended, options(() => Buffer.from('SM'))));
  });

  it('repacks nothing at all once one accessor is sparse', () => {
    // A sparse accessor keeps its indices and its values in other views, at
    // offsets it holds itself and this does not follow. One is enough to stop
    // every repack in the file — they are unheard of in models, so the blunt
    // answer costs nothing and a subtle one could move bytes it points at.
    const sparse = indexed();
    sparse.json.accessors![1]!.sparse = { count: 1 };

    untouched(rewriteGlb(sparse, options(() => Buffer.from('SM'))));
  });
});

/*
 * Quantising the normals.
 *
 * The first loss this file takes, and the first thing an author can turn off.
 * A signed byte stores a direction to about half a degree — invisible on a
 * scanned surface, and the reason the switch exists for the one where it is
 * not.
 *
 * What makes it more than a component-type change: a normal of four bytes can
 * no longer share a view with a position of twelve, because glTF allows one
 * stride per view. So the view splits, and the tests below are mostly about
 * everything else still addressing what it addressed.
 */

const BYTE = 5120;
const FLOAT = 5126;
const quantising: RewriteOptions = {
  scaleImage: () => null,
  quantizeNormals: true,
  encodeGeometry: null,
};

/** A position and a normal per vertex, sharing one view the way exporters write it. */
function meshed(normals: readonly (readonly [number, number, number])[]): GlbContents {
  const positions = Buffer.alloc(normals.length * 12);
  normals.forEach((_, at) => {
    positions.writeFloatLE(at, at * 12);
    positions.writeFloatLE(at * 2, at * 12 + 4);
    positions.writeFloatLE(at * 3, at * 12 + 8);
  });
  const directions = Buffer.alloc(normals.length * 12);
  normals.forEach(([x, y, z], at) => {
    directions.writeFloatLE(x, at * 12);
    directions.writeFloatLE(y, at * 12 + 4);
    directions.writeFloatLE(z, at * 12 + 8);
  });
  const bin = Buffer.concat([positions, directions]);

  const json: GltfJson = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    // One view, one stride, two accessors laid end to end — the shape the
    // reference model actually has.
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length, byteStride: 12 }],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: FLOAT,
        count: normals.length,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [normals.length, normals.length * 2, normals.length * 3],
      },
      { bufferView: 0, byteOffset: positions.length, componentType: FLOAT, count: normals.length, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
  };
  return { json, bin };
}

const UNIT: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
];

/** What an accessor's components read back as, denormalised the way a loader does. */
function vectorsOf(contents: GlbContents, at: number): number[][] {
  const accessor = contents.json.accessors?.[at];
  const view = contents.json.bufferViews?.[accessor?.bufferView ?? -1];
  if (!accessor || !view) return [];

  const size = accessor.componentType === BYTE ? 1 : 4;
  const step = view.byteStride ?? size * 3;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count }, (_, index) =>
    [0, 1, 2].map((component) => {
      const from = start + index * step + component * size;
      if (accessor.componentType !== BYTE) return contents.bin.readFloatLE(from);
      return Math.max(contents.bin.readInt8(from) / 127, -1);
    }),
  );
}

describe('quantising the normals', () => {
  it('stores a direction in a byte, to about half a degree', () => {
    const rewritten = rewriteGlb(meshed(UNIT), quantising);

    expect(rewritten?.json.accessors?.[1]?.componentType).toBe(BYTE);
    expect(rewritten?.json.accessors?.[1]?.normalized).toBe(true);
    for (const [index, read] of vectorsOf(rewritten!, 1).entries()) {
      read.forEach((value, component) => expect(value).toBeCloseTo(UNIT[index]![component]!, 2));
    }
  });

  it('gives the normals a view of their own, appended so no index moves', () => {
    const rewritten = rewriteGlb(meshed(UNIT), quantising);
    const views = rewritten?.json.bufferViews ?? [];

    // Four bytes a normal, three of them used: a stride has to be a multiple of
    // four, so the pad byte is the format's price and not a mistake.
    expect(views).toHaveLength(2);
    expect(rewritten?.json.accessors?.[1]?.bufferView).toBe(1);
    expect(views[1]?.byteStride).toBe(4);
    expect(views[1]?.byteLength).toBe(UNIT.length * 4);

    // The positions kept the view they were in, and the stride that goes with
    // them. Anything naming view 0 still means what it meant.
    expect(rewritten?.json.accessors?.[0]?.bufferView).toBe(0);
    expect(views[0]?.byteStride).toBe(12);
  });

  it('leaves the positions reading exactly as they did', () => {
    const source = meshed(UNIT);
    const rewritten = rewriteGlb(source, quantising);

    expect(vectorsOf(rewritten!, 0)).toEqual(vectorsOf(source, 0));
  });

  it('declares the extension as required, not merely used', () => {
    // A reader that does not know it cannot make sense of a byte where it
    // expects a float, so `extensionsUsed` alone would be a lie of omission.
    const rewritten = rewriteGlb(meshed(UNIT), quantising);

    expect(rewritten?.json.extensionsUsed).toContain('KHR_mesh_quantization');
    expect(rewritten?.json.extensionsRequired).toContain('KHR_mesh_quantization');
  });

  it('restates min and max in the units it stored, where the file had them', () => {
    const source = meshed(UNIT);
    source.json.accessors![1]!.min = [-1, -1, -1];
    source.json.accessors![1]!.max = [1, 1, 1];
    const rewritten = rewriteGlb(source, quantising);

    // Integers, because that is what the accessor now holds, and three reads
    // these to build a bounding box.
    expect(rewritten?.json.accessors?.[1]?.min).toEqual([0, -127, 0]);
    expect(rewritten?.json.accessors?.[1]?.max).toEqual([127, 73, 127]);
    // The position accessor's own bounds are untouched.
    expect(rewritten?.json.accessors?.[0]?.min).toEqual([0, 0, 0]);
  });

  it('adds no bounds to an accessor that carried none', () => {
    const rewritten = rewriteGlb(meshed(UNIT), quantising);

    expect(rewritten?.json.accessors?.[1]?.min).toBeUndefined();
  });

  it('refuses a normal that is not a unit vector', () => {
    // A signed byte is read back as `value / 127`, so a normal 1.4 long comes
    // back at 1.0 and the surface is lit differently. Nothing downstream would
    // report it — the model would simply look a little wrong.
    const stretched = meshed([...UNIT.slice(0, 3), [1.4, 0, 0]]);

    expect(rewriteGlb(stretched, quantising)).toBeNull();
  });

  it('refuses a normal of no length at all', () => {
    expect(rewriteGlb(meshed([...UNIT.slice(0, 3), [0, 0, 0]]), quantising)).toBeNull();
  });

  it('does nothing when the author turned it off', () => {
    expect(rewriteGlb(meshed(UNIT), { scaleImage: () => null, quantizeNormals: false, encodeGeometry: null })).toBeNull();
  });
});

/*
 * Compressing the geometry.
 *
 * Lossless, unlike the two before it: what the decoder hands back is what went
 * in, byte for byte. What is new here is *where the bytes are*. A compressed
 * view goes on describing what comes out of the decoder — its length, its
 * stride, the accessors inside it — while pointing at a second buffer that
 * holds nothing at all, and its extension names the real, compressed bytes back
 * in the blob. Two address spaces in one file, and most of these tests are
 * about keeping them apart.
 */

/** Stands in for the encoder: short, and it says what it was asked for. */
const calls: string[] = [];
const fakeEncoder = (source: Buffer, count: number, size: number, mode: EncodeMode): Buffer => {
  calls.push(`${mode} count=${count} size=${size} in=${source.length}`);
  return Buffer.from('Z');
};

const compressing = (
  encodeGeometry: RewriteOptions['encodeGeometry'] = fakeEncoder,
): RewriteOptions => ({ scaleImage: () => null, quantizeNormals: false, encodeGeometry });

/** Indices in one view, positions in another — the shape a primitive has. */
function compressible(indices: readonly number[] = [0, 1, 2, 2, 1, 3]): GlbContents {
  const index = Buffer.alloc(indices.length * 4);
  indices.forEach((value, at) => index.writeUInt32LE(value, at * 4));
  const vertices = Math.max(...indices) + 1;
  const positions = Buffer.alloc(vertices * 12);
  for (let at = 0; at < vertices * 3; at++) positions.writeFloatLE(at, at * 4);
  const bin = Buffer.concat([index, positions]);

  return {
    bin,
    json: {
      asset: { version: '2.0' },
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: index.length },
        { buffer: 0, byteOffset: index.length, byteLength: positions.length, byteStride: 12 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5125, count: indices.length, type: 'SCALAR' },
        { bufferView: 1, byteOffset: 0, componentType: FLOAT, count: vertices, type: 'VEC3' },
      ],
      meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1 } }] }],
    },
  };
}

const meshopt = (view: NonNullable<GltfJson['bufferViews']>[number] | undefined) =>
  view?.extensions?.['EXT_meshopt_compression'] as
    | { buffer: number; byteOffset: number; byteLength: number; count: number; byteStride: number; mode: string }
    | undefined;

describe('compressing the geometry', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('asks for triangles on the indices and attributes on everything else', () => {
    rewriteGlb(compressible(), compressing());

    // Six indices narrowed to two bytes each, and four positions of twelve.
    expect(calls).toEqual([
      'TRIANGLES count=6 size=2 in=12',
      'ATTRIBUTES count=4 size=12 in=48',
    ]);
  });

  it('leaves the view describing what comes out, not what is stored', () => {
    const rewritten = rewriteGlb(compressible(), compressing());
    const view = rewritten?.json.bufferViews?.[0];

    // The length and the offset are the decoder's output, in the buffer that
    // holds nothing. A loader reads accessors against those, and would find
    // rubbish if they described the compressed bytes instead.
    expect(view?.buffer).toBe(1);
    expect(view?.byteLength).toBe(12);
    expect(meshopt(view)).toEqual({
      buffer: 0,
      byteOffset: 0,
      byteLength: 1,
      count: 6,
      byteStride: 2,
      mode: 'TRIANGLES',
    });
  });

  it('declares a fallback buffer, which is a length and nothing else', () => {
    const rewritten = rewriteGlb(compressible(), compressing());

    expect(rewritten?.json.buffers?.[1]).toEqual({
      byteLength: 60,
      extensions: { EXT_meshopt_compression: { fallback: true } },
    });
    // The blob itself now holds only what is really there.
    expect(rewritten?.json.buffers?.[0]?.byteLength).toBe(rewritten?.bin.length);
  });

  it('declares the extension as required', () => {
    const rewritten = rewriteGlb(compressible(), compressing());

    expect(rewritten?.json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(rewritten?.json.extensionsUsed).toContain('EXT_meshopt_compression');
  });

  it('compresses a view nothing else was going to touch', () => {
    // The point of laying every view out again: the texture coordinates of the
    // reference model are rewritten by nothing at all, and are 14.98 MB.
    const rewritten = rewriteGlb(meshed(UNIT), compressing());

    expect(calls).toEqual(['ATTRIBUTES count=8 size=12 in=96']);
    expect(meshopt(rewritten?.json.bufferViews?.[0])?.mode).toBe('ATTRIBUTES');
  });

  it('stores a stream the encoder made no smaller', () => {
    // A view is never made bigger by being compressed.
    const rewritten = rewriteGlb(compressible(), compressing(() => Buffer.alloc(4096)));

    expect(meshopt(rewritten?.json.bufferViews?.[0])).toBeUndefined();
    expect(rewritten?.json.buffers).toHaveLength(1);
    expect(rewritten?.json.extensionsRequired ?? []).not.toContain('EXT_meshopt_compression');
  });

  it('leaves an index count that is not whole triangles', () => {
    // Four indices is a line list wearing the wrong name, and the triangle
    // codec would be describing it as something it is not.
    rewriteGlb(compressible([0, 1, 2, 3]), compressing());

    expect(calls).toEqual(['ATTRIBUTES count=4 size=12 in=48']);
  });

  it('leaves no gap between two runs of the same width', () => {
    /*
     * Nine indices then three, both whole triangles, both in one view. Nine of
     * two bytes is eighteen, which four does not divide — so padding the next
     * accessor out to four would put a two-byte hole in the middle, and a
     * stream with a hole in it is one where `count * size` is no longer the
     * length. The encoder would be told a smaller count and would describe the
     * wrong bytes.
     *
     * The reference model does this 44 times over: T-002's own layout left 46
     * bytes of padding across its index accessors.
     */
    const runs = [0, 1, 2, 2, 1, 3, 3, 1, 0, 1, 2, 3];
    const index = Buffer.alloc(runs.length * 4);
    runs.forEach((value, at) => index.writeUInt32LE(value, at * 4));
    const positions = Buffer.alloc(4 * 12);
    for (let at = 0; at < 12; at++) positions.writeFloatLE(at, at * 4);
    const bin = Buffer.concat([index, positions]);

    rewriteGlb(
      {
        bin,
        json: {
          asset: { version: '2.0' },
          buffers: [{ byteLength: bin.length }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: index.length },
            { buffer: 0, byteOffset: index.length, byteLength: positions.length, byteStride: 12 },
          ],
          accessors: [
            { bufferView: 0, byteOffset: 0, componentType: UNSIGNED_INT, count: 9, type: 'SCALAR' },
            { bufferView: 0, byteOffset: 36, componentType: UNSIGNED_INT, count: 3, type: 'SCALAR' },
            { bufferView: 1, byteOffset: 0, componentType: FLOAT, count: 4, type: 'VEC3' },
          ],
          meshes: [
            {
              primitives: [
                { indices: 0, attributes: { POSITION: 2 } },
                { indices: 1, attributes: { POSITION: 2 } },
              ],
            },
          ],
        },
      },
      compressing(),
    );

    // Twelve indices, twenty-four bytes: no hole anywhere in them.
    expect(calls).toContain('TRIANGLES count=12 size=2 in=24');
  });

  it('leaves the images alone', () => {
    const rewritten = rewriteGlb(indexed(), compressing());
    const image = rewritten?.json.bufferViews?.[1];

    expect(meshopt(image)).toBeUndefined();
    expect(image?.buffer).toBe(0);
  });
});

describe('what the real decoder gives back', () => {
  /*
   * The test that proves the declaration and not just the plumbing. `count`,
   * `byteStride` and `mode` are what the decoder is handed; get any of them
   * wrong and it returns the wrong number of the wrong things, with nothing in
   * the file to say so.
   *
   * Vertex data comes back byte for byte. Triangles do not, quite: the codec
   * starts each one at whichever corner codes smallest, so the comparison has
   * to be made on triangles rather than on bytes. It is a rotation and never a
   * mirror — counted over the reference scan's 1,982,017 triangles — so the
   * winding, and everything that depends on it, is unchanged.
   */

  /** A triangle written from its smallest corner: a rotation matches, a mirror does not. */
  function triangles(bytes: Buffer): string[] {
    const out: string[] = [];
    for (let at = 0; at + 6 <= bytes.length; at += 6) {
      const corners = [0, 2, 4].map((c) => bytes.readUInt16LE(at + c));
      const first = corners.indexOf(Math.min(...corners));
      out.push([0, 1, 2].map((step) => corners[(first + step) % 3]).join(','));
    }
    return out;
  }
  beforeAll(async () => {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
  });

  const real = (source: Buffer, count: number, size: number, mode: EncodeMode): Buffer =>
    Buffer.from(MeshoptEncoder.encodeGltfBuffer(new Uint8Array(source), count, size, mode));

  /**
   * A strip of triangles, big enough that compressing it is worth doing.
   *
   * Twelve bytes of indices do not compress — a codec has a header, and the
   * guard against a view coming out larger correctly refuses them. Which is
   * itself the reason this fixture exists rather than the small one.
   */
  const strip = Array.from({ length: 900 }, (_, at) => at % 3 === 2 ? (at % 400) + 1 : at % 400);

  it('hands back exactly what was stored, view by view', () => {
    const plain = rewriteGlb(compressible(strip), compressing(null));
    const packed = rewriteGlb(compressible(strip), compressing(real));

    for (const [index, view] of (packed?.json.bufferViews ?? []).entries()) {
      const extension = meshopt(view);
      expect(extension).toBeDefined();

      const decoded = new Uint8Array(extension!.count * extension!.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        decoded,
        extension!.count,
        extension!.byteStride,
        new Uint8Array(
          packed!.bin.subarray(extension!.byteOffset, extension!.byteOffset + extension!.byteLength),
        ),
        extension!.mode,
      );

      const before = plain!.json.bufferViews![index]!;
      const want = plain!.bin.subarray(before.byteOffset!, before.byteOffset! + before.byteLength);
      expect(decoded.length).toBe(view.byteLength);

      if (extension!.mode === 'TRIANGLES') expect(triangles(Buffer.from(decoded))).toEqual(triangles(want));
      else expect(Buffer.from(decoded)).toEqual(want);
    }
  });
});
