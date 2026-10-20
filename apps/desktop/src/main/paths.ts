import { isAbsolute, relative, resolve, sep } from 'node:path';

export class PathEscapeError extends Error {
  constructor(target: string) {
    super(`Refusing to touch a path outside the project: ${target}`);
    this.name = 'PathEscapeError';
  }
}

/**
 * A file the editor was asked about is not there.
 *
 * Node says `ENOENT: no such file or directory, open '/Users/…'`: an errno and
 * an absolute path. The person reading the toast knows the file by its place in
 * the project, and needs to know it has gone — the editor never leaves one of
 * its own paths empty, so something outside it moved or deleted the file.
 */
export class MissingFileError extends Error {
  constructor(target: string) {
    super(`There is no file at ${target}: it was moved or deleted outside the editor.`);
    this.name = 'MissingFileError';
  }
}

/** Node saying nothing is at a path, and only that: `ENOENT`. */
export function isNotFound(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';
}

/**
 * Resolves a project-relative path and proves it stayed inside the project.
 *
 * The renderer is sandboxed, but the paths it sends come from scene and asset
 * documents, which are ordinary files a user can receive from anyone. Without
 * this check a crafted `../../../../.ssh/id_rsa` would be read or written with
 * the main process's full privileges.
 */
export function resolveInside(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, candidate);

  const rel = relative(absoluteRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new PathEscapeError(candidate);
  // `..` anywhere in the remainder cannot happen after `resolve`, but a
  // path segment equal to `..` on a case-insensitive volume can; be explicit.
  if (rel.split(sep).includes('..')) throw new PathEscapeError(candidate);

  return target;
}
