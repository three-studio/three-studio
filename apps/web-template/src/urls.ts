/**
 * Turns a path the exporter wrote into a path a URL can carry.
 *
 * Segment by segment, as the editor's own resolver does — a file named
 * `brick wall #2.png` is a legal asset and an illegal URL, and the `#` would
 * silently truncate everything after it into a fragment. Not `encodeURI`, which
 * lets `#`, `?` and `%` through for exactly the cases that matter here.
 *
 * A name that literally contains `%20` comes back as `%2520`, and that is
 * right: the file on disk is called `%20`, and encoding it once is what finds
 * it again.
 */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
