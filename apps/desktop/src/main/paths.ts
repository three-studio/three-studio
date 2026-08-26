import { isAbsolute, relative, resolve, sep } from 'node:path';

export class PathEscapeError extends Error {
  constructor(target: string) {
    super(`Refusing to touch a path outside the project: ${target}`);
    this.name = 'PathEscapeError';
  }
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
