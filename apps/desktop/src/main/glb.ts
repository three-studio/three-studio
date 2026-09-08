/*
 * The GLB container, read and written, so the images inside a model can be
 * replaced by scaled copies.
 *
 * A `.glb` is a 12-byte header and a list of chunks: the glTF JSON, then the
 * binary blob its `bufferView`s address. Images stored that way have no sidecar,
 * no id and no row in the project, so the only way to cap them is to write the
 * file out again with different bytes in those views.
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

/** As much of the glTF document as this file has to understand. */
export interface GltfJson {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    extensions?: Record<string, unknown>;
  }[];
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

/**
 * A copy of the file with its embedded images replaced by whatever `process`
 * makes of them.
 *
 * `null` when nothing changed — no images, none worth scaling, or a file that
 * cannot be rebuilt — and the caller then serves the source, which is the point
 * of answering rather than throwing.
 *
 * Every view is copied into a fresh blob in order, so the offsets are recomputed
 * rather than patched. Views that overlap in the source stop overlapping, which
 * can make the file slightly larger; that is the correct trade against tracking
 * which bytes are shared by what, and it is nothing beside the images.
 */
export function rewriteEmbeddedImages(
  contents: GlbContents,
  process: (bytes: Buffer, mimeType: string) => Buffer | null,
): GlbContents | null {
  const { json, bin } = contents;
  if (!canRebuild(json)) return null;

  const views = json.bufferViews ?? [];
  const replaced = new Map<number, Buffer>();

  for (const image of json.images ?? []) {
    const index = image.bufferView;
    if (index === undefined || replaced.has(index)) continue;

    const view = views[index];
    if (view === undefined) continue;

    const offset = view.byteOffset ?? 0;
    const scaled = process(bin.subarray(offset, offset + view.byteLength), image.mimeType ?? '');
    if (scaled !== null) replaced.set(index, scaled);
  }

  if (replaced.size === 0) return null;

  const parts: Buffer[] = [];
  let offset = 0;
  const rebuilt = views.map((view, index) => {
    const source =
      replaced.get(index) ??
      bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);

    const padding = aligned(offset) - offset;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    parts.push(source);
    const placed = { ...view, byteOffset: offset, byteLength: source.length };
    offset += source.length;
    return placed;
  });

  return {
    json: {
      ...json,
      bufferViews: rebuilt,
      buffers: [{ ...(json.buffers?.[0] ?? { byteLength: 0 }), byteLength: offset }],
    },
    bin: Buffer.concat(parts),
  };
}
