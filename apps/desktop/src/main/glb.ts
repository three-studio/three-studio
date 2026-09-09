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
 *
 * Both end in the same place — a blob rebuilt view by view — so both happen in
 * one pass. Two passes would mean rebuilding eighty megabytes twice for one
 * file.
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

const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;
const MAX_UNSIGNED_SHORT = 65535;

/** As much of an accessor as this file has to understand. */
export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
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
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    extensions?: Record<string, unknown>;
  }[];
  accessors?: GltfAccessor[];
  meshes?: { primitives?: { indices?: number }[] }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  extensionsUsed?: string[];
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
 * A copy of the file with its embedded images scaled and its indices narrowed
 * to the width they need.
 *
 * `null` when nothing changed — no image worth scaling, no index worth
 * narrowing, or a file that cannot be rebuilt — and the caller then serves the
 * source, which is the point of answering rather than throwing.
 *
 * Every view is copied into a fresh blob in order, so the offsets are recomputed
 * rather than patched. Views that overlap in the source stop overlapping, which
 * can make the file slightly larger; that is the correct trade against tracking
 * which bytes are shared by what, and it is nothing beside the images.
 *
 * **Each view is decided on its own**, and a view this cannot account for is
 * copied across untouched rather than making the whole file refuse. There is no
 * middle state: a view is either replaced by a scaled image, repacked from the
 * accessors that address it, or carried over byte for byte.
 */
export function rewriteGlb(
  contents: GlbContents,
  scaleImage: (bytes: Buffer, mimeType: string) => Buffer | null,
): GlbContents | null {
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
  // touch — and that has to be known before any index is considered.
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
    const bytes = scaleImage(bin.subarray(at, at + view.byteLength), image.mimeType ?? '');
    if (bytes !== null) scaled.set(index, bytes);
  }

  const hasSparse = accessors.some((accessor) => accessor.sparse !== undefined);

  /**
   * Whether a view's accessors can be laid out again from scratch.
   *
   * Repacking is what narrowing an index costs: making one accessor shorter
   * moves every accessor after it inside the same view, so the view has to be
   * rebuilt from all of them and each one's `byteOffset` written again.
   *
   * The four refusals, and what each would corrupt:
   *
   * - **a sparse accessor anywhere in the document.** Its indices and values
   *   live in other views at offsets it holds itself, and this does not follow
   *   them. One is enough to stop all repacking: they are unheard of in models,
   *   so the cost of the blunt answer is nothing and the cost of a subtle one
   *   would be geometry that decodes into the wrong shape.
   * - **a view an image also addresses.** Such a view is carried over untouched
   *   on both counts — the image is not scaled either, for the reason given
   *   where the images are collected.
   * - **an interleaved view** (`byteStride`). Its accessors take turns inside
   *   one stride; laying them out end to end would be a different file.
   * - **a view carrying its own extension**, for the reason `canRebuild`
   *   already gives about `EXT_meshopt_compression`.
   */
  const repackable = (index: number): boolean => {
    if (hasSparse || imageViews.has(index)) return false;

    const view = views[index];
    if (view === undefined) return false;
    if (view.byteStride !== undefined || view.extensions !== undefined) return false;

    return (byView.get(index) ?? []).every((at) => {
      const accessor = accessors[at];
      return accessor !== undefined && elementBytes(accessor) !== null;
    });
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
    const view = views[accessor.bufferView ?? -1];
    if (view === undefined) return false;

    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const end = start + accessor.count * 4;
    if (end > (view.byteOffset ?? 0) + view.byteLength || end > bin.length) return false;

    for (let at = start; at < end; at += 4) {
      if (bin.readUInt32LE(at) > MAX_UNSIGNED_SHORT) return false;
    }
    return true;
  };

  const narrowed = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      // An accessor may be the index buffer of several primitives; it is
      // narrowed once, and the second visit has nothing to add.
      const index = primitive.indices;
      if (index === undefined || narrowed.has(index)) continue;

      const accessor = accessors[index];
      if (accessor === undefined || accessor.bufferView === undefined) continue;
      if (accessor.componentType !== UNSIGNED_INT || accessor.type !== 'SCALAR') continue;
      if (!repackable(accessor.bufferView) || !fitsInShort(accessor)) continue;

      narrowed.add(index);
    }
  }

  if (scaled.size === 0 && narrowed.size === 0) return null;

  const repacked = new Set<number>();
  for (const index of narrowed) repacked.add(accessors[index]?.bufferView ?? -1);

  const placed = [...accessors];

  /** What a view will hold, and where its accessors sit inside it. */
  const contentsOf = (index: number): Buffer => {
    const image = scaled.get(index);
    if (image !== undefined) return image;

    const view = views[index];
    if (view === undefined) return Buffer.alloc(0);
    const start = view.byteOffset ?? 0;
    if (!repacked.has(index)) return bin.subarray(start, start + view.byteLength);

    // In the order they sat in the source, so a file that laid its accessors
    // out deliberately comes back laid out the same way.
    const inside = [...(byView.get(index) ?? [])].sort((left, right) => {
      const gap = (accessors[left]?.byteOffset ?? 0) - (accessors[right]?.byteOffset ?? 0);
      return gap !== 0 ? gap : left - right;
    });

    const parts: Buffer[] = [];
    let offset = 0;
    for (const at of inside) {
      const accessor = accessors[at];
      const size = accessor === undefined ? null : elementBytes(accessor);
      if (accessor === undefined || size === null) continue;

      // Four rather than the component size, which is all the spec asks: every
      // size in play divides four, and a view always starts on four, so one
      // rule covers both halves of "an accessor's offset into the buffer is a
      // multiple of its component size".
      const padding = aligned(offset) - offset;
      if (padding > 0) {
        parts.push(Buffer.alloc(padding));
        offset += padding;
      }

      const from = start + (accessor.byteOffset ?? 0);
      const narrow = narrowed.has(at);
      const bytes = narrow
        ? asUnsignedShort(bin, from, accessor.count)
        : bin.subarray(from, from + size * accessor.count);

      placed[at] = {
        ...accessor,
        byteOffset: offset,
        // `min` and `max` ride along in the spread and stay right: the numbers
        // an index holds do not change, only how many bytes each one takes.
        ...(narrow ? { componentType: UNSIGNED_SHORT } : {}),
      };
      parts.push(bytes);
      offset += bytes.length;
    }
    return Buffer.concat(parts);
  };

  const parts: Buffer[] = [];
  let offset = 0;
  const rebuilt = views.map((view, index) => {
    const bytes = contentsOf(index);

    const padding = aligned(offset) - offset;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    parts.push(bytes);
    const placedView = { ...view, byteOffset: offset, byteLength: bytes.length };
    offset += bytes.length;
    return placedView;
  });

  return {
    json: {
      ...json,
      // Only when the document had one: the spec has no empty arrays, and
      // adding a field a file did not carry is a change nobody asked for.
      ...(json.accessors === undefined ? {} : { accessors: placed }),
      bufferViews: rebuilt,
      buffers: [{ ...(json.buffers?.[0] ?? { byteLength: 0 }), byteLength: offset }],
    },
    bin: Buffer.concat(parts),
  };
}

/** The same numbers, two bytes each instead of four. */
function asUnsignedShort(bin: Buffer, from: number, count: number): Buffer {
  const out = Buffer.alloc(count * 2);
  for (let at = 0; at < count; at++) {
    out.writeUInt16LE(bin.readUInt32LE(from + at * 4), at * 2);
  }
  return out;
}
