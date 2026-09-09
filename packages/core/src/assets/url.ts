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
 * How the scaled copy of an asset is built, as a number that goes in its name.
 *
 * The third thing that invalidates a derived file, beside the source and the
 * settings: **the code that derived it.** Without this, teaching the importer a
 * new trick would change nothing for any project already scanned — every asset
 * would keep the copy it has, and an asset that had nothing to do last time
 * would keep the marker that says so. The improvement would ship and be
 * invisible, which is the worst of the three outcomes.
 *
 * Bump it whenever the bytes this pipeline produces from the same inputs
 * change. `1` is the generation that carried no stamp at all.
 *
 * This is Unity's import version under another name, and it works the same way:
 * old copies are simply no longer asked for, and they go when the cache does.
 */
export const IMPORT_PIPELINE_VERSION = 3;

/**
 * Where the scaled copy of an asset lives, relative to the project root.
 *
 * Under `CACHE_DIR`, which the project's own `.gitignore` excludes and which
 * `projectIndex.ts` already declares disposable — deleting it must never break a
 * project, only make the next open slower. This is the same bargain.
 *
 * **The name carries everything that invalidates it.** The source hash comes
 * from the sidecar, so editing the file produces a different name; the variant
 * spells out the answers that produced this copy, so changing one of them does
 * too; and the pipeline version covers the case neither of them can see, where
 * the file and the answers are the same and the code that read them is not.
 * Nothing has to notice a change and clear anything.
 *
 * `variant` is a string and not the settings themselves, because what belongs
 * in a name is *which answers*, and only the caller reading the sidecar knows
 * which ones matter for a kind. A texture's is its cap; a model's is its cap
 * and whether its geometry was compressed.
 */
export function importedAssetPath(
  assetId: string,
  hash: string,
  variant: string,
  extension: string,
): string {
  // Twelve characters of SHA-256. Enough that two versions of one asset cannot
  // collide, short enough that the path stays readable in a file browser.
  const name = `${hash.slice(0, 12)}-${variant}-v${IMPORT_PIPELINE_VERSION}`;
  return `${CACHE_DIR}/imported/${assetId}/${name}${extension}`;
}
