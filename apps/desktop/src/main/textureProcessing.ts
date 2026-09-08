import { nativeImage } from 'electron';

/*
 * Scaled copies of images that are larger than a project has any use for.
 *
 * Every editor does this and none of them talk about it, because it is only
 * visible when it is missing: a source image is whatever the author was given,
 * and an 8192-square photograph is 268 MB of RGBA on the GPU for a prop nobody
 * walks up to. Unity, Unreal and Godot all decode once at import, clamp to a
 * Max Size, and never load the source again.
 *
 * `electron.nativeImage` rather than a library, and that is the whole reason
 * this is affordable: it is Chromium's own decoder, already in the binary, with
 * nothing to ship beside the app or beside an exported build. Measured on the
 * 42 MB 8192-square JPEG that started this: 471 ms to decode, 60 ms to scale to
 * 2048, 33 ms to re-encode, and 42.1 MB out as 1.77 MB.
 */

/** What `nativeImage` can both read and write. Everything else is left alone. */
export type ImageFormat = 'jpeg' | 'png';

/**
 * The format to treat a file as, from its name or its media type.
 *
 * `null` is the ordinary answer for half the formats a project holds: an HDR or
 * an EXR stores light rather than pixels and re-encoding one as either of these
 * would destroy exactly what it is for, a KTX2 is already compressed for a GPU,
 * and WebP is not something `nativeImage` will write back. All of those are
 * served as they came.
 */
export function imageFormatOf(nameOrType: string): ImageFormat | null {
  const lower = nameOrType.toLowerCase();
  if (lower.endsWith('.png') || lower === 'image/png') return 'png';
  if (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower === 'image/jpeg' ||
    lower === 'image/jpg'
  ) {
    return 'jpeg';
  }
  return null;
}

/**
 * The size an image should be reduced to, or `null` when it already fits.
 *
 * The **longest** side is what is capped, and the aspect ratio is kept: this is
 * Unity's rule, and the alternative — squaring everything to `maxSize` — turns
 * a 4096x512 trim sheet into a stretched square.
 *
 * `null` means "serve the source", not "something went wrong". Most images in
 * most projects are already under the cap, and copying them for nothing would
 * double the project on disk.
 */
export function scaledSize(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= maxSize || longest === 0 || maxSize <= 0) return null;

  const factor = maxSize / longest;
  // At least one pixel on the short side: a 16384x3 strip scaled to 2048 would
  // otherwise round its height to zero, and an image of no height is not an
  // image.
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/**
 * How much of the original a JPEG keeps.
 *
 * 90 rather than 100: the last ten points cost roughly twice the bytes for a
 * difference that needs the two side by side to see, and this is already a
 * scaled copy of a photograph.
 */
const JPEG_QUALITY = 90;

/**
 * A scaled copy of an image, or `null` to say the source will do.
 *
 * `null` covers three cases on purpose, because the caller does the same thing
 * in all of them: the image already fits, the bytes did not decode, or the
 * format is one this cannot write. Serving the source is right for each — the
 * worst outcome is a texture that stays large, and an asset that fails to
 * *import* because its image was awkward is much worse than that.
 */
export function processTexture(
  bytes: Buffer,
  format: ImageFormat,
  maxSize: number,
): Buffer | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;

  const { width, height } = image.getSize();
  const target = scaledSize(width, height, maxSize);
  if (target === null) return null;

  // `quality: 'good'` is Chromium's box-filtered path. `'better'` is Lanczos
  // and roughly three times the time for a difference that does not survive
  // being mipmapped anyway.
  const scaled = image.resize({ ...target, quality: 'good' });
  return format === 'png' ? scaled.toPNG() : scaled.toJPEG(JPEG_QUALITY);
}
