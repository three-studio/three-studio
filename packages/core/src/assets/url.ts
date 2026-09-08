import { CACHE_DIR } from '../project/schema';
/*
 * How a file in the project is addressed from a page.
 *
 * The scheme was a constant in the main process and a string literal in three
 * places in the renderer, each re-encoding the path in the same way beside it.
 * The sibling scheme — `studio-import`, for a file staged in the import dialog
 * — has lived in `core` since it was written, with the same three parts: the
 * scheme, the one host it answers on, and the function that builds a URL. This
 * is the same arrangement for the one that came first.
 *
 * `core` because both ends need it and neither owns it: the main process
 * registers and serves the scheme, and the renderer is what writes the URLs.
 */

export const ASSET_SCHEME = 'studio-asset';

/**
 * The only host accepted, so the open project is implicit.
 *
 * A URL naming its own root would be a way around the project sandbox, and
 * these URLs come out of scene documents — which are files a user can receive
 * from anyone.
 */
export const ASSET_HOST = 'project';

/**
 * Turns a path on disk into a path a URL can carry.
 *
 * Segment by segment: a file named `brick wall #2.png` is a legal asset and an
 * illegal URL, and the `#` would silently truncate everything after it into a
 * fragment. Not `encodeURI`, which lets `#`, `?` and `%` through for exactly
 * the cases that matter here.
 *
 * A name that literally contains `%20` comes back as `%2520`, and that is
 * right: the file on disk is called `%20`, and encoding it once is what finds
 * it again.
 */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Where the main process serves an asset at `path`, relative to the project. */
export function assetUrl(path: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${encodePath(path)}`;
}

/**
 * Where the scaled copy of an asset lives, relative to the project root.
 *
 * Under `CACHE_DIR`, which the project's own `.gitignore` excludes and which
 * `projectIndex.ts` already declares disposable — deleting it must never break a
 * project, only make the next open slower. This is the same bargain.
 *
 * **The name carries both things that invalidate it.** The source hash comes
 * from the sidecar, so editing the file produces a different name; the cap is
 * written out in full, so raising Max Size does too. Nothing has to notice a
 * change and clear anything: the old file is simply no longer asked for, and it
 * goes when the cache does.
 */
export function importedAssetPath(
  assetId: string,
  hash: string,
  cap: number,
  extension: string,
): string {
  // Twelve characters of SHA-256. Enough that two versions of one asset cannot
  // collide, short enough that the path stays readable in a file browser.
  return `${CACHE_DIR}/imported/${assetId}/${hash.slice(0, 12)}-${cap}${extension}`;
}
