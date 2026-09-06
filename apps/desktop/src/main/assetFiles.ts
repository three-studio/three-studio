import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, posix, sep } from 'node:path';

/*
 * The small things every other asset module needs, and one error type.
 *
 * Split out of `assets.ts`, which was 856 lines and four jobs, all of them
 * taking `projectPath` as a first argument — a namespace over a project rather
 * than a module. These are what the other three share, plus what four modules
 * outside this folder import.
 */

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

export async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

/** `tree.glb`, then `tree-1.glb`, so an import never silently overwrites. */
/**
 * @param extension Overrides the extension used to build the suffixed variant.
 *   Needed for compound extensions: without it `Brick.material.json` collides
 *   into `Brick.material-1.json`, which no longer reads as a material.
 */
/** `Tree`, then `Tree-1`, so a second import never lands in the first's folder. */
export async function uniqueFolderName(
  projectPath: string,
  directory: string,
  name: string,
): Promise<string> {
  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '-') || 'Model';

  for (let index = 0; index < 1000; index++) {
    const candidate = index === 0 ? safe : `${safe}-${index}`;
    try {
      await stat(join(projectPath, directory, candidate));
    } catch {
      return candidate;
    }
  }
  return `${safe}-${Date.now()}`;
}

export async function uniqueFileName(
  projectPath: string,
  directory: string,
  fileName: string,
  extension = extname(fileName),
): Promise<string> {
  const base = fileName.slice(0, fileName.length - extension.length);

  for (let index = 0; index < 1000; index++) {
    const candidate = index === 0 ? fileName : `${base}-${index}${extension}`;
    try {
      await stat(join(projectPath, directory, candidate));
    } catch {
      return candidate;
    }
  }
  return `${base}-${Date.now()}${extension}`;
}

/** Manifest paths are always posix so they read the same on every platform. */
export function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}
