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
