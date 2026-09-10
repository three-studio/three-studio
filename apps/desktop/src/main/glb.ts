/*
 * The GLB container, read and written, so what a model carries inside it can be
 * made smaller on the way in.
 *
 * A `.glb` is a 12-byte header and a list of chunks: the glTF JSON, then the
 * binary blob its `bufferView`s address. Two things in that blob are worth
 * rewriting, and neither can be reached from outside the file:
 *
 * - **its images**. They have no sidecar, no id and no row in the project, so
 *   the only way to cap them is to write the file out again with different
 *   bytes in their views.
 * - **the width of its indices**. An exporter that writes `UNSIGNED_INT`
 *   because that is its default spends four bytes on a triangle corner that two
 *   describe exactly. Measured on the photogrammetry scan this was written for:
 *   22.68 MB of indices whose largest value was 65533.
 * - **the width of its normals**. A unit vector in three floats is twelve bytes
 *   spent on a direction that a byte per axis describes to half a degree. On
 *   the same scan: 22.47 MB that become 7.49.
 *
 * All three end in the same place — a blob rebuilt view by view — so all three
 * happen in one pass. Two passes would mean rebuilding eighty megabytes twice
 * for one file.
 *
 * The source is never touched. The copy goes in the project's cache, which is
 * declared disposable — the same arrangement as the scene index, and for the
 * same reason: a derived file that can be deleted at any time is one nobody has
 * to keep in step.
 *
 * Nothing here imports Electron. Whoever calls it supplies the function that
 * scales an image, which is what lets the container work be tested on its own.
 */

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

const BYTE = 5120;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;
const MAX_UNSIGNED_SHORT = 65535;

/** What a byte-sized normal needs the file to declare. */
const QUANTIZATION = 'KHR_mesh_quantization';

/** What a compressed stream needs the file to declare. */
const MESHOPT = 'EXT_meshopt_compression';

/**
 * What the encoder will not take, and what would be wrong to hand it.
 *
 * A stream of attributes is addressed four bytes at a time and the codec holds
 * a window per byte lane, so the stride has to divide into four and stay small.
 * A stream of triangles is three indices at a time, of two bytes or four — a
 * count that is not a multiple of three is a line or a point list, which this
 * leaves alone rather than encoding as something it is not.
 */
const MAX_ATTRIBUTE_STRIDE = 256;

/**
 * Where a compressed view says its decompressed bytes live.
 *
 * Nowhere, is the answer. The extension defines a *fallback buffer* — one with
 * a length and no contents — so that a view can go on describing what comes out
 * of the decoder while its real bytes sit compressed in the blob. A source is
 * only ever rebuilt when it has exactly one buffer, so the second index is
 * always free.
 */
const FALLBACK_BUFFER = 1;

/**
 * How far a normal's squared length may stray from one before this leaves it
 * alone. Float32 rounding moves it by about 1e-7; this is four orders of
 * magnitude of room, and still catches a normal nobody normalised.
 */
const UNIT_TOLERANCE = 0.01;

/** As much of an accessor as this file has to understand. */
export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
  /**
   * Declared only to be recognised. A sparse accessor keeps its indices and its
   * values in *other* views, addressed from here — so repacking any view could
   * move bytes it points at, and this file refuses to repack anything at all
   * once one is present. See `repackable`.
   */
  sparse?: unknown;
}

/** As much of the glTF document as this file has to understand. */
export interface GltfJson {
  buffers?: { byteLength: number; uri?: string; extensions?: Record<string, unknown> }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    extensions?: Record<string, unknown>;
  }[];
  accessors?: GltfAccessor[];
  meshes?: {
    primitives?: {
      indices?: number;
      attributes?: Record<string, number>;
      targets?: Record<string, number>[];
    }[];
  }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
}

export interface GlbContents {
  json: GltfJson;
  bin: Buffer;
}

/** Rounds up to the 4-byte boundary the format requires everywhere. */
function aligned(length: number): number {
  return (length + 3) & ~3;
}

/**
 * Splits a `.glb` into its document and its blob.
 *
 * `null` for anything this cannot put back together byte for byte, and that is
 * the honest answer rather than a partial one: the caller serves the source
 * file instead, which always works.
 */
export function readGlb(bytes: Buffer): GlbContents | null {
  if (bytes.length < HEADER_BYTES) return null;
  if (bytes.readUInt32LE(0) !== MAGIC) return null;
  if (bytes.readUInt32LE(4) !== 2) return null;

  let json: GltfJson | null = null;
  // Annotated: `subarray` answers a view over whatever the buffer is backed by,
  // and an inferred `Buffer.alloc` is narrower than that.
  let bin: Buffer = Buffer.alloc(0);

  let offset = HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + CHUNK_HEADER_BYTES;
    if (start + length > bytes.length) return null;

    // Unknown chunk types are skipped rather than refused: the spec reserves
    // them, and a file carrying one is still a file whose images can be scaled.
    if (type === JSON_CHUNK) {
      try {
        json = JSON.parse(bytes.subarray(start, start + length).toString('utf8')) as GltfJson;
      } catch {
        return null;
      }
    } else if (type === BIN_CHUNK) {
      bin = bytes.subarray(start, start + length);
    }
    offset = start + length;
  }

  return json === null ? null : { json, bin };
}

/** Puts the two back together, with every chunk padded as the format requires. */
export function writeGlb({ json, bin }: GlbContents): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  // Spaces for the JSON chunk and zeroes for the binary one, which the spec
  // names specifically: a parser that reads the JSON chunk as text must find
  // whitespace at the end of it and not NUL.
  const jsonPadded = Buffer.alloc(aligned(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonPadded);
  const binPadded = Buffer.alloc(aligned(bin.length), 0x00);
  bin.copy(binPadded);

  const total =
    HEADER_BYTES +
    CHUNK_HEADER_BYTES +
    jsonPadded.length +
    (binPadded.length > 0 ? CHUNK_HEADER_BYTES + binPadded.length : 0);

  const out = Buffer.alloc(total);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);

  let offset = HEADER_BYTES;
  out.writeUInt32LE(jsonPadded.length, offset);
  out.writeUInt32LE(JSON_CHUNK, offset + 4);
  jsonPadded.copy(out, offset + CHUNK_HEADER_BYTES);
  offset += CHUNK_HEADER_BYTES + jsonPadded.length;

  if (binPadded.length > 0) {
    out.writeUInt32LE(binPadded.length, offset);
    out.writeUInt32LE(BIN_CHUNK, offset + 4);
    binPadded.copy(out, offset + CHUNK_HEADER_BYTES);
  }

  return out;
}

/**
 * Whether the blob can be rebuilt with different contents.
 *
 * **`EXT_meshopt_compression` is the one that must be refused.** Its
 * `bufferView.extensions` entry carries its own `buffer`, `byteOffset` and
 * `byteLength` addressing the blob *directly* rather than through the view it
 * hangs off — so a rebuild that moves views around and rewrites only their own
 * offsets leaves those pointing at the wrong bytes, and the geometry decodes
 * into noise. Nothing in the file would say so; it would simply come out wrong.
 *
 * A second buffer, or a buffer with a `uri`, means the bytes are not all here.
 */
function canRebuild(json: GltfJson): boolean {
  if ((json.extensionsUsed ?? []).includes('EXT_meshopt_compression')) return false;

  const buffers = json.buffers ?? [];
  if (buffers.length !== 1) return false;
  return buffers[0]?.uri === undefined;
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const COMPONENTS_PER_ELEMENT: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * How many bytes one element of an accessor occupies, or `null` for a layout
 * this does not claim to know.
 *
 * `null` is not an error, it is the answer that keeps the view it belongs to
 * untouched. The case it exists for: glTF pads every *column* of a `MAT2` or a
 * `MAT3` out to four bytes, so a `MAT3` of bytes is twelve bytes and not nine.
 * Reproducing that rule for matrices no exporter here writes would be a way to
 * get it subtly wrong; saying "not known" costs a view that was never going to
 * shrink anyway.
 */
function elementBytes(accessor: GltfAccessor): number | null {
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = COMPONENTS_PER_ELEMENT[accessor.type];
  if (componentBytes === undefined || components === undefined) return null;
  if ((accessor.type === 'MAT2' || accessor.type === 'MAT3') && componentBytes !== 4) return null;
  return components * componentBytes;
}

/**
 * What an accessor is *for*, which decides how its bytes may be laid out.
 *
 * glTF asks opposite things of the two: a view of vertex attributes shared by
 * several accessors **must** declare a `byteStride`, and a view of indices —
 * or of anything that is neither — **must not**.
 */
type Role = 'attribute' | 'index' | 'other';

/** How a stream of vertices or indices is read back, which the file declares. */
export type EncodeMode = 'ATTRIBUTES' | 'TRIANGLES';

export interface RewriteOptions {
  /** A smaller copy of one embedded image, or `null` to leave it as it is. */
  scaleImage(bytes: Buffer, mimeType: string): Buffer | null;
  /**
   * Whether a normal may be stored in a byte rather than a float.
   *
   * The author's answer, carried down from the sidecar, because this one is
   * lossy: a byte describes a direction to under four tenths of a degree,
   * which is invisible on a scanned surface and can band on a large smooth one.
   */
  quantizeNormals: boolean;
  /**
   * Compresses one stream of geometry, or `null` to store it as it is.
   *
   * Injected the same way the image scaler is, and for the same reason: the
   * encoder is a dependency with a WASM module inside it, and the container
   * work is worth testing without one. `count` elements of `size` bytes go in;
   * whatever comes back is what the file will carry, and the decoder named in
   * `EXT_meshopt_compression` is what turns it back. Byte for byte, except
   * under `TRIANGLES`, where a triangle may come back started at a different
   * corner — the same triangle, wound the same way.
   */
  encodeGeometry: ((source: Buffer, count: number, size: number, mode: EncodeMode) => Buffer) | null;
}

/**
 * A copy of the file with its embedded images scaled, its indices narrowed to
 * the width they need, and its normals quantised if the author allows it.
 *
 * `null` when nothing changed — or when the file cannot be rebuilt at all — and
 * the caller then serves the source, which is the point of answering rather
 * than throwing.
 *
 * Every view is copied into a fresh blob in order, so the offsets are recomputed
 * rather than patched. Accessors that overlap in the source stop overlapping,
 * which can make the file slightly larger; that is the correct trade against
 * tracking which bytes are shared by what, and it is nothing beside the images.
 *
 * **Each view is decided on its own**, and a view this cannot account for is
 * copied across untouched rather than making the whole file refuse. There is no
 * middle state: a view is either replaced by a scaled image, repacked from the
 * accessors that address it, or carried over byte for byte.
 *
 * **A repacked view may become several, and the extra ones are appended.** A
 * normal that shrank from twelve bytes to four can no longer share a stride
 * with the position beside it, and glTF allows one stride per view. Appending
 * rather than inserting is what keeps every view index that already existed
 * pointing at what it pointed at — including from places this file does not
 * read, such as a Draco extension naming its own view by number.
 */
export function rewriteGlb(contents: GlbContents, options: RewriteOptions): GlbContents | null {
  const { json, bin } = contents;
  if (!canRebuild(json)) return null;

  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];

  const byView = new Map<number, number[]>();
  for (const [index, accessor] of accessors.entries()) {
    if (accessor.bufferView === undefined) continue;
    const found = byView.get(accessor.bufferView);
    if (found) found.push(index);
    else byView.set(accessor.bufferView, [index]);
  }

  // Scaled first, because a view an image addresses is one nothing else may
  // touch — and that has to be known before any accessor is considered.
  const imageViews = new Set<number>();
  const scaled = new Map<number, Buffer>();
  for (const image of json.images ?? []) {
    const index = image.bufferView;
    if (index === undefined) continue;
    imageViews.add(index);
    if (scaled.has(index)) continue;
    // A view an accessor also addresses is left alone entirely, and this is the
    // half that repacking cannot protect: a scaled image is a *different
    // length*, so the accessor's offset inside the view would land in the
    // middle of a JPEG. Nothing declares this overlap illegal and no exporter
    // writes it, which is exactly why it would have gone unnoticed.
    if (byView.has(index)) continue;

    const view = views[index];
    if (view === undefined) continue;
    const at = view.byteOffset ?? 0;
    const bytes = options.scaleImage(bin.subarray(at, at + view.byteLength), image.mimeType ?? '');
    if (bytes !== null) scaled.set(index, bytes);
  }

  const hasSparse = accessors.some((accessor) => accessor.sparse !== undefined);

  const roles = new Map<number, Role>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.indices !== undefined) roles.set(primitive.indices, 'index');
      for (const at of Object.values(primitive.attributes ?? {})) roles.set(at, 'attribute');
      for (const target of primitive.targets ?? []) {
        for (const at of Object.values(target)) roles.set(at, 'attribute');
      }
    }
  }
  const roleOf = (at: number): Role => roles.get(at) ?? 'other';

  /**
   * Whether a view's accessors can be laid out again from scratch.
   *
   * Repacking is what changing a component type costs: making one accessor
   * shorter moves every accessor after it inside the same view, so the view has
   * to be rebuilt from all of them and each one's `byteOffset` written again.
   *
   * The refusals, and what each would corrupt:
   *
   * - **a sparse accessor anywhere in the document.** Its indices and values
   *   live in other views at offsets it holds itself, and this does not follow
   *   them. One is enough to stop all repacking: they are unheard of in models,
   *   so the cost of the blunt answer is nothing and the cost of a subtle one
   *   would be geometry that decodes into the wrong shape.
   * - **a view an image also addresses.** Such a view is carried over untouched
   *   on both counts — the image is not scaled either, for the reason given
   *   where the images are collected.
   * - **a view carrying its own extension**, for the reason `canRebuild`
   *   already gives about `EXT_meshopt_compression`.
   * - **a genuinely interleaved view.** A `byteStride` wider than one element
   *   means the accessors take turns inside it, and laying them out end to end
   *   would be a different file. A stride that is *exactly* one element is
   *   decorative — the spec asks for it whenever two accessors share a view —
   *   and the data under it is already contiguous, so that one is allowed.
   */
  const repackable = (index: number): boolean => {
    if (hasSparse || imageViews.has(index)) return false;

    const view = views[index];
    if (view === undefined || view.extensions !== undefined) return false;

    return (byView.get(index) ?? []).every((at) => {
      const accessor = accessors[at];
      if (accessor === undefined) return false;
      const size = elementBytes(accessor);
      return size !== null && (view.byteStride === undefined || view.byteStride === size);
    });
  };

  /** Where an accessor's own bytes start, and whether they are all there. */
  const spanOf = (accessor: GltfAccessor): number | null => {
    const view = views[accessor.bufferView ?? -1];
    const size = elementBytes(accessor);
    if (view === undefined || size === null) return null;

    const from = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = from + accessor.count * size;
    if (end > (view.byteOffset ?? 0) + view.byteLength || end > bin.length) return null;
    return from;
  };

  /**
   * Whether every index an accessor holds fits in sixteen bits.
   *
   * Read from the blob rather than taken from the accessor's own `max`, which
   * is optional on indices and is written by the same exporter that chose the
   * wrong width in the first place. A `max` that lies produces triangles
   * pointing at the wrong vertices, and nothing anywhere would say so.
   */
  const fitsInShort = (accessor: GltfAccessor): boolean => {
    const from = spanOf(accessor);
    if (from === null) return false;

    for (let at = from; at < from + accessor.count * 4; at += 4) {
      if (bin.readUInt32LE(at) > MAX_UNSIGNED_SHORT) return false;
    }
    return true;
  };

  /**
   * Whether every normal an accessor holds is a unit vector.
   *
   * A signed byte stores a direction, not a length: the format reads it back as
   * `value / 127`, so a normal that arrived 1.4 long comes back at 1.0 and the
   * surface is lit differently. Exporters that write unnormalised normals are
   * rare and they exist, and nothing downstream would report the change — the
   * model would simply look a little wrong.
   */
  const allUnitLength = (accessor: GltfAccessor): boolean => {
    const from = spanOf(accessor);
    if (from === null) return false;

    for (let at = from; at < from + accessor.count * 12; at += 12) {
      const x = bin.readFloatLE(at);
      const y = bin.readFloatLE(at + 4);
      const z = bin.readFloatLE(at + 8);
      if (Math.abs(x * x + y * y + z * z - 1) > UNIT_TOLERANCE) return false;
    }
    return true;
  };

  const narrowed = new Set<number>();
  const quantized = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      // An accessor may serve several primitives; it is converted once, and the
      // second visit has nothing to add.
      const indices = primitive.indices;
      const accessor = indices === undefined ? undefined : accessors[indices];
      if (
        indices !== undefined &&
        accessor?.bufferView !== undefined &&
        !narrowed.has(indices) &&
        accessor.componentType === UNSIGNED_INT &&
        accessor.type === 'SCALAR' &&
        repackable(accessor.bufferView) &&
        fitsInShort(accessor)
      ) {
        narrowed.add(indices);
      }

      const normal = primitive.attributes?.NORMAL;
      const normals = normal === undefined ? undefined : accessors[normal];
      if (
        options.quantizeNormals &&
        normal !== undefined &&
        normals?.bufferView !== undefined &&
        !quantized.has(normal) &&
        normals.componentType === FLOAT &&
        normals.type === 'VEC3' &&
        repackable(normals.bufferView) &&
        allUnitLength(normals)
      ) {
        quantized.add(normal);
      }
    }
  }

  const repacked = new Set<number>();
  for (const at of [...narrowed, ...quantized]) {
    const view = accessors[at]?.bufferView;
    if (view !== undefined) repacked.add(view);
  }
  // With an encoder, every view of accessors is laid out again even when none
  // of its own bytes changed. Compression needs each view to be one stream of
  // one width, and that is exactly what laying it out again produces — so the
  // texture coordinates, which nothing in this file rewrites, still get their
  // 14.98 MB taken down to 9.54.
  if (options.encodeGeometry !== null) {
    for (const index of byView.keys()) if (repackable(index)) repacked.add(index);
  }

  if (scaled.size === 0 && narrowed.size === 0 && quantized.size === 0 && repacked.size === 0) {
    return null;
  }

  /** An accessor as it will be written, which is what decides how wide it is. */
  const after = (at: number): GltfAccessor => {
    const accessor = accessors[at] as GltfAccessor;
    if (narrowed.has(at)) return { ...accessor, componentType: UNSIGNED_SHORT };
    if (quantized.has(at)) return { ...accessor, componentType: BYTE, normalized: true };
    return accessor;
  };

  /** Recomputed `min`/`max`, which the spec wants in the units it finds. */
  const bounds = new Map<number, { min: number[]; max: number[] }>();

  const contentsOfAccessor = (at: number, viewStart: number, step: number): Buffer => {
    const accessor = accessors[at] as GltfAccessor;
    const from = viewStart + (accessor.byteOffset ?? 0);
    const out = Buffer.alloc(accessor.count * step);

    if (quantized.has(at)) {
      const min = [127, 127, 127];
      const max = [-127, -127, -127];
      for (let k = 0; k < accessor.count; k++) {
        for (let component = 0; component < 3; component++) {
          const unit = bin.readFloatLE(from + k * 12 + component * 4);
          // Clamped at -127 and not -128: the format reads a signed byte back as
          // `max(value / 127, -1)`, so -128 and -127 are the same direction and
          // only one of them round-trips.
          const value = Math.max(-127, Math.min(127, Math.round(unit * 127)));
          out.writeInt8(value, k * step + component);
          min[component] = Math.min(min[component] as number, value);
          max[component] = Math.max(max[component] as number, value);
        }
      }
      bounds.set(at, { min, max });
      return out;
    }

    if (narrowed.has(at)) {
      for (let k = 0; k < accessor.count; k++) {
        out.writeUInt16LE(bin.readUInt32LE(from + k * 4), k * step);
      }
      return out;
    }

    // Unchanged, and usually unmoved as well: one copy rather than one per
    // element, which is two million of them on a scan of this size.
    const size = elementBytes(accessor) as number;
    if (step === size) return bin.subarray(from, from + size * accessor.count);
    for (let k = 0; k < accessor.count; k++) {
      bin.copy(out, k * step, from + k * size, from + (k + 1) * size);
    }
    return out;
  };

  interface Piece {
    origin: number;
    bytes: Buffer;
    byteStride?: number;
    accessors: { at: number; byteOffset: number }[];
    /** How the encoder would read this piece, when it is one clean stream. */
    stream?: { size: number; mode: EncodeMode };
  }

  /** What one repacked view becomes: one piece per role and element width. */
  const groupsOf = (index: number): Piece[] => {
    const view = views[index] as NonNullable<GltfJson['bufferViews']>[number];
    const start = view.byteOffset ?? 0;

    const groups = new Map<string, { role: Role; byteStride?: number; members: number[] }>();
    for (const at of [...(byView.get(index) ?? [])].sort((left, right) => {
      const gap = (accessors[left]?.byteOffset ?? 0) - (accessors[right]?.byteOffset ?? 0);
      return gap !== 0 ? gap : left - right;
    })) {
      const role = roleOf(at);
      const size = elementBytes(after(at)) as number;

      // **Only vertex attributes split.** A view of attributes declares one
      // stride for all of them, so a normal that shrank from twelve bytes to
      // four can no longer share the view its position sits in. Indices and
      // everything else are tightly packed and carry no stride at all, and
      // component types of different widths sit side by side there quite
      // happily — splitting those would be views bought for nothing.
      const key = role === 'attribute' ? `attribute:${size}` : role;
      const found = groups.get(key);
      if (found) found.members.push(at);
      // A stride has to be a multiple of four — WebGPU rejects anything else —
      // so three bytes of normal ride in four.
      else {
        groups.set(key, {
          role,
          byteStride: role === 'attribute' ? aligned(size) : undefined,
          members: [at],
        });
      }
    }

    return [...groups.values()].map(({ role, byteStride, members }) => {
      const parts: Buffer[] = [];
      const placedInside: { at: number; byteOffset: number }[] = [];
      let offset = 0;
      let uniform = true;
      for (const at of members) {
        const step = byteStride ?? (elementBytes(after(at)) as number);
        // To the element and not to four, so a run of one width leaves no gap at
        // all: a stream the encoder can take is one where `count * size` is the
        // whole length, and a padding byte in the middle would end that. Where
        // the width does change, the gap is what keeps the next accessor's
        // offset a multiple of its own component size.
        const padding = (step - (offset % step)) % step;
        if (padding > 0) {
          parts.push(Buffer.alloc(padding));
          offset += padding;
          uniform = false;
        }
        const bytes = contentsOfAccessor(at, start, step);
        placedInside.push({ at, byteOffset: offset });
        parts.push(bytes);
        offset += bytes.length;
        if (step !== (byteStride ?? (elementBytes(after(members[0] as number)) as number))) uniform = false;
      }
      const size = byteStride ?? (elementBytes(after(members[0] as number)) as number);
      return {
        origin: index,
        bytes: Buffer.concat(parts),
        byteStride,
        accessors: placedInside,
        stream: uniform ? { size, mode: role === 'index' ? 'TRIANGLES' : 'ATTRIBUTES' } : undefined,
      };
    });
  };

  const pieces: Piece[] = [];
  for (const [index, view] of views.entries()) {
    if (repacked.has(index)) {
      pieces.push(...groupsOf(index));
      continue;
    }
    const at = view.byteOffset ?? 0;
    pieces.push({
      origin: index,
      bytes: scaled.get(index) ?? bin.subarray(at, at + view.byteLength),
      byteStride: view.byteStride,
      accessors: [],
    });
  }

  /**
   * The compressed form of a piece, or `null` to store it as it stands.
   *
   * The refusals are the encoder's own contract, and each of them is a stream
   * this would be describing wrongly rather than one it could not squeeze: a
   * width that four does not divide, or that a byte lane cannot address; a
   * triangle list whose count is not a multiple of three, which is a line or a
   * point list wearing the wrong name; and a piece with a gap in it, where
   * `count * size` is no longer the whole length.
   *
   * And an encoding that came out no smaller than what it encodes is dropped:
   * a view is never made bigger by being compressed.
   */
  const compressedOf = (piece: Piece): Buffer | null => {
    const encode = options.encodeGeometry;
    if (encode === null || piece.stream === undefined) return null;

    const { size, mode } = piece.stream;
    if (piece.bytes.length === 0 || piece.bytes.length % size !== 0) return null;
    const count = piece.bytes.length / size;

    if (mode === 'TRIANGLES') {
      if ((size !== 2 && size !== 4) || count % 3 !== 0) return null;
    } else if (size % 4 !== 0 || size > MAX_ATTRIBUTE_STRIDE) return null;

    const encoded = encode(piece.bytes, count, size, mode);
    return encoded.length < piece.bytes.length ? encoded : null;
  };

  const placed = [...accessors];
  const rebuilt: NonNullable<GltfJson['bufferViews']> = [];
  const parts: Buffer[] = [];
  const claimed = new Set<number>();
  let offset = 0;
  let appended = views.length;
  // A compressed view's bytes are not where the view says they are. The view
  // describes what comes *out* of the decoder, in a second buffer that holds
  // nothing — the fallback the extension defines for exactly this — while the
  // extension names the compressed bytes back in the blob. Two address spaces,
  // counted side by side.
  let fallback = 0;
  let compressed = 0;

  for (const piece of pieces) {
    const encoded = compressedOf(piece);
    const stored = encoded ?? piece.bytes;

    const padding = aligned(offset) - offset;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    parts.push(stored);

    // The first piece keeps the view's own index; the rest go on the end.
    let index: number;
    if (claimed.has(piece.origin)) index = appended++;
    else {
      claimed.add(piece.origin);
      index = piece.origin;
    }

    const { byteStride: _replaced, ...rest } = views[piece.origin] as NonNullable<
      GltfJson['bufferViews']
    >[number];
    const base = {
      ...rest,
      ...(piece.byteStride === undefined ? {} : { byteStride: piece.byteStride }),
      byteLength: piece.bytes.length,
    };

    if (encoded === null) {
      rebuilt[index] = { ...base, byteOffset: offset };
    } else {
      compressed++;
      fallback = aligned(fallback);
      rebuilt[index] = {
        ...base,
        buffer: FALLBACK_BUFFER,
        byteOffset: fallback,
        extensions: {
          [MESHOPT]: {
            buffer: 0,
            byteOffset: offset,
            byteLength: encoded.length,
            count: piece.bytes.length / (piece.stream as { size: number }).size,
            byteStride: (piece.stream as { size: number }).size,
            mode: (piece.stream as { mode: EncodeMode }).mode,
          },
        },
      };
      fallback += piece.bytes.length;
    }

    for (const { at, byteOffset } of piece.accessors) {
      const recomputed = bounds.get(at);
      placed[at] = {
        ...after(at),
        bufferView: index,
        byteOffset,
        // Only where the file had them. Adding bounds an accessor never carried
        // would be answering a question nobody asked.
        ...(recomputed !== undefined && accessors[at]?.min !== undefined ? recomputed : {}),
      };
    }
    offset += stored.length;
  }

  // Everything was laid out again and nothing came out smaller: the copy would
  // be the source with different offsets in it, which is not worth a file.
  if (scaled.size === 0 && narrowed.size === 0 && quantized.size === 0 && compressed === 0) {
    return null;
  }

  /** Named once, whether or not the document already named it. */
  const naming = (list: string[] | undefined, ...names: string[]): string[] => {
    const out = [...(list ?? [])];
    for (const name of names) if (!out.includes(name)) out.push(name);
    return out;
  };

  // `extensionsRequired` and not only `extensionsUsed`, for both of them: a
  // reader that does not know these cannot make sense of a byte where it
  // expects a float, or of a view whose bytes are not where it says. The spec
  // says so in as many words, and three throws rather than guessing.
  const needed = [
    ...(quantized.size === 0 ? [] : [QUANTIZATION]),
    ...(compressed === 0 ? [] : [MESHOPT]),
  ];

  return {
    json: {
      ...json,
      // Only when the document had one: the spec has no empty arrays, and
      // adding a field a file did not carry is a change nobody asked for.
      ...(json.accessors === undefined ? {} : { accessors: placed }),
      ...(needed.length === 0
        ? {}
        : {
            extensionsUsed: naming(json.extensionsUsed, ...needed),
            extensionsRequired: naming(json.extensionsRequired, ...needed),
          }),
      bufferViews: rebuilt,
      buffers: [
        { ...(json.buffers?.[0] ?? { byteLength: 0 }), byteLength: offset },
        ...(compressed === 0
          ? []
          : [{ byteLength: fallback, extensions: { [MESHOPT]: { fallback: true } } }]),
      ],
    },
    bin: Buffer.concat(parts),
  };
}
