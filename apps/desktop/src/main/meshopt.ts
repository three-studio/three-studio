import { MeshoptEncoder } from 'meshoptimizer/encoder';
import type { EncodeMode } from './glb';

/*
 * The geometry encoder, and the one place that knows the decoder is already
 * paid for.
 *
 * This is what separates meshopt from the other two compressions this project
 * has looked at. KTX2 and Draco need a *decoder* served next to the editor and
 * next to every exported build — a WASM blob plus a wrapper, per build, whether
 * or not a single asset uses it. Meshopt's decoder is a plain ES module that
 * `loadModelFromUrl` already imports, so it is bundled into the editor and into
 * `apps/web-template` and has been from the start. Nothing ships here that was
 * not shipping already.
 *
 * The encoder is the other half and it is nearly as cheap: 24 kB of JavaScript
 * with its WASM inlined, running in the main process, once per file, behind the
 * scan the author is already waiting on. No native binary, no per-platform
 * build, nothing to install beside the app — which is the exact dependency the
 * exporter refuses to take on, and the reason compression belongs at import.
 */

/**
 * Resolves once the encoder has compiled its WASM.
 *
 * Called before a rebuild rather than inside one, so the container work stays a
 * synchronous function over bytes. The promise is the encoder's own and is
 * created once, so every call after the first is free.
 */
export function geometryEncoderReady(): Promise<void> {
  return MeshoptEncoder.ready;
}

/**
 * Compresses one stream of vertices or indices.
 *
 * A codec built for this shape of data — the entropy is in how little
 * consecutive vertices differ, which a general compressor cannot see and this
 * one is written around. Measured on a photogrammetry scan: indices at a ninth
 * of their size, positions and texture coordinates at two thirds. For
 * comparison, brotli manages a third off the same bytes.
 *
 * **Lossless for attributes, and for triangles lossless in every way that can
 * be observed.** Vertex data comes back byte for byte. The triangle codec is
 * free to start a triangle at a different corner — it picks the rotation that
 * codes smallest — so the indices are not always the same numbers in the same
 * order. Counted on the reference scan: of 1,982,017 triangles, 828,670 came
 * back untouched and 1,153,347 rotated, **none mirrored and none wrong**. A
 * rotation keeps the winding, so the facing, the shading and the collider are
 * the same; only the bytes differ.
 *
 * The byte-exact alternative exists — `INDICES` mode, which is the same codec
 * without that freedom — and costs 5.74 MB against 2.36 for a difference
 * nothing can see.
 */
export function encodeGeometry(
  source: Buffer,
  count: number,
  size: number,
  mode: EncodeMode,
): Buffer {
  return Buffer.from(MeshoptEncoder.encodeGltfBuffer(new Uint8Array(source), count, size, mode));
}
