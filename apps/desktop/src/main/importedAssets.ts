import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { importedAssetPath, type AssetMeta } from '@three-studio/core';
import { atomicWrite } from './atomicWrite';
import { readGlb, rewriteGlb, writeGlb } from './glb';
import { encodeGeometry, geometryEncoderReady } from './meshopt';
import { imageFormatOf, processTexture } from './textureProcessing';

/*
 * The scaled copy an asset is loaded through, built once and kept in the
 * project's cache.
 *
 * This is what Unity's `Library/` and Unreal's DDC are: the source file stays
 * exactly as the author left it, and nothing at run time ever opens it. What
 * gets loaded is a derived artifact, keyed by the source, by the settings that
 * produced it and by the version of the code that produced it, in a directory
 * that can be deleted at any moment.
 *
 * Built during the scan rather than at the end of the import dialog, which is
 * one place instead of three: it then also covers assets that were imported
 * before this existed, a cache the author deleted, and a Max Size changed after
 * the fact. The scan pays for it once and every later scan is a `stat`.
 */

/**
 * Files small enough that opening them cannot be worth it.
 *
 * Deciding properly means decoding the image, and decoding every image in a
 * three-thousand-asset project on every scan is not a trade worth making. A
 * 2048-square JPEG — already at the default cap — is around a megabyte, so
 * anything under this is certainly under the cap as well.
 */
const WORTH_OPENING_BYTES = 2 * 1024 * 1024;

/** The answers that govern how a copy is built. */
interface Recipe {
  /** The longest side an image inside this asset may reach, in pixels. */
  cap: number;
  /** Whether its geometry may be made smaller where the loss has been measured. */
  compressGeometry: boolean;
}

/** What governs an asset, or `null` for a kind this does not process. */
function recipeFor(meta: AssetMeta): Recipe | null {
  const { settings } = meta;
  if (settings.kind === 'texture') return { cap: settings.maxSize, compressGeometry: false };
  if (settings.kind === 'model') {
    return { cap: settings.maxTextureSize, compressGeometry: settings.compressGeometry };
  }
  return null;
}

/**
 * The part of a copy's name that says which answers produced it.
 *
 * Spelled out rather than hashed, so a cache directory can be read by eye: the
 * question "why is this file here twice" is answered by looking at it. A
 * texture has no geometry, so its variant is only ever its cap — which keeps
 * the name it would have had anyway.
 */
function variantOf({ cap, compressGeometry }: Recipe): string {
  return compressGeometry ? `${cap}-c` : `${cap}`;
}

/**
 * Marks "the source is already fine", so the next scan does not decode it again.
 *
 * Without it, an image under the cap is opened, decoded and thrown away on
 * every single scan — which is the cost this whole file exists to remove, paid
 * for ever instead of once. Keyed by the same name, so it is invalidated by the
 * same things — the pipeline version among them, which is what lets a file that
 * had nothing to do last time be looked at again once the code has learnt
 * something new.
 */
const NOTHING_TO_DO = '.none';

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The path an asset should be loaded through, building the copy if it is not
 * there yet.
 *
 * `null` means "load the source", and it covers every case where that is the
 * right answer: a kind with no cap, a file too small to be worth opening, an
 * image already under the cap, a format that cannot be written back, and a
 * model container that cannot be rebuilt safely. The caller does the same thing
 * in all of them.
 *
 * Never throws. A scan that failed because one asset was awkward would be a
 * project that will not open.
 */
export async function ensureImported(
  projectPath: string,
  meta: AssetMeta,
  relativePath: string,
  sizeBytes: number,
): Promise<string | null> {
  const recipe = recipeFor(meta);
  if (recipe === null || sizeBytes < WORTH_OPENING_BYTES) return null;

  const extension = extname(relativePath).toLowerCase();
  const target = importedAssetPath(meta.id, meta.hash, variantOf(recipe), extension);
  const absolute = join(projectPath, target);

  if (await exists(absolute)) return target;
  if (await exists(absolute + NOTHING_TO_DO)) return null;

  try {
    const bytes = await readFile(join(projectPath, relativePath));
    // The encoder carries a WASM module it compiles once. Awaited here because
    // `rewriteGlb` is a pure function over bytes and is worth keeping that way.
    if (recipe.compressGeometry) await geometryEncoderReady();
    const built =
      meta.settings.kind === 'model'
        ? rebuildModel(bytes, recipe)
        : rebuildTexture(bytes, extension, recipe.cap);

    await mkdir(dirname(absolute), { recursive: true });
    if (built === null) {
      await atomicWrite(absolute + NOTHING_TO_DO, '');
      return null;
    }
    await atomicWrite(absolute, built);
    return target;
  } catch (cause) {
    // Said once and moved past. The source still loads, which is the whole
    // reason `null` is a legitimate answer here rather than a failure.
    console.warn(`[assets] could not build a scaled copy of ${relativePath}:`, cause);
    return null;
  }
}

function rebuildTexture(bytes: Buffer, extension: string, cap: number): Buffer | null {
  const format = imageFormatOf(extension);
  return format === null ? null : processTexture(bytes, format, cap);
}

/**
 * Only `.glb`, and the rest is deliberate rather than unfinished.
 *
 * A `.gltf` names its images as separate files, and each of those **is** a
 * texture asset with a sidecar and a `maxSize` of its own — so it is already
 * covered, by the branch above. FBX and OBJ embed images in formats this cannot
 * take apart without a parser for each.
 *
 * Both halves of the recipe reach the container: the cap governs the images it
 * carries, and the compression answer governs its geometry.
 */
function rebuildModel(bytes: Buffer, { cap, compressGeometry }: Recipe): Buffer | null {
  const read = readGlb(bytes);
  if (read === null) return null;

  const rewritten = rewriteGlb(read, {
    scaleImage: (imageBytes, mimeType) => {
      const format = imageFormatOf(mimeType);
      return format === null ? null : processTexture(imageBytes, format, cap);
    },
    quantizeNormals: compressGeometry,
    quantizePositions: compressGeometry,
    encodeGeometry: compressGeometry ? encodeGeometry : null,
  });
  return rewritten === null ? null : writeGlb(rewritten);
}
