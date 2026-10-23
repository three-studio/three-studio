import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { AssetKind } from '@three-studio/core';
import { AssetError, hashFile } from '../assetFiles';
import { foldKey, toBuildPath, type BuildPath } from './buildPath';

/*
 * Every file a build will hold, decided before one of them is written.
 *
 * The export used to write as it went and then walk the folder to find out what
 * it had written. The walk could not tell the build from what else was in the
 * folder — a repository's `.git/` went into the list, 27 MB of it counted as
 * the player — and writing as it went meant a script that failed to compile
 * left a folder half replaced. Now each step adds what it means to ship to a
 * plan, the plan refuses anything that cannot be a build's, and one writer
 * writes exactly the plan. `files.json` is the plan, so it cannot forget a file
 * the export wrote, nor name one it did not.
 */

/** Where a planned file's bytes come from. */
export type FileSource =
  /** A file on disk, copied as it is: one of the player's, an asset, a model's side file. */
  | { kind: 'file'; path: string }
  /** Bytes the export made itself: the page, the manifest, a scene, the scripts. */
  | { kind: 'bytes'; data: Uint8Array };

/**
 * What a file is to the build: what the size report sorts by, and what an
 * error names.
 *
 * Said by the step that plans the file, which is the only place that knows. The
 * size report used to read it back off the folder the file landed in, and so
 * counted an asset kept outside its kind's default folder as part of the player.
 */
export type FileRole =
  | { kind: 'page' }
  | { kind: 'player' }
  | { kind: 'manifest' }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'scripts' }
  | { kind: 'asset'; assetId: string; assetKind: AssetKind };

export interface PlannedFile {
  path: BuildPath;
  source: FileSource;
  role: FileRole;
  bytes: number;
  /** SHA-256 of the bytes the writer will write, lower-case hex. */
  sha256: string;
}

/** What a file's bytes come to, when something else already read them. */
export interface Digest {
  bytes: number;
  sha256: string;
}

export class BuildCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildCollisionError';
  }
}

function describeRole(role: FileRole): string {
  switch (role.kind) {
    case 'page':
      return 'the page';
    case 'player':
      return 'the player';
    case 'manifest':
      return 'the manifest';
    case 'scene':
      return `scene ${role.sceneId}`;
    case 'scripts':
      return 'the scripts';
    case 'asset':
      return `asset ${role.assetId}`;
  }
}

export function digestOf(data: Uint8Array): Digest {
  return { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
}

/** A file's size and digest, read through a symlink: what ships is what it points at. */
export async function digestOfFile(path: string): Promise<Digest> {
  const info = await stat(path);
  if (!info.isFile()) throw new AssetError(`${path} is not a file.`);
  return { bytes: info.size, sha256: await hashFile(path) };
}

export class BuildPlan {
  private readonly byKey = new Map<string, PlannedFile>();
  /** Every folder a planned file sits in, so a file and a folder cannot share a name. */
  private readonly folders = new Set<string>();

  /**
   * @param roots The names the export owns at the top of its folder. A step
   *   planning anything else has a bug, and the author's files are out there.
   */
  constructor(private readonly roots: ReadonlySet<string>) {}

  add(path: string, source: FileSource, role: FileRole, digest: Digest): PlannedFile {
    const checked = toBuildPath(path);
    const segments = checked.split('/');
    if (!this.roots.has(segments[0]!)) {
      throw new Error(`${describeRole(role)} planned ${checked}, outside the names the export owns.`);
    }

    const key = foldKey(checked);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      // Two models in one folder name the same buffer: one file, planned twice.
      if (existing.path === checked && existing.sha256 === digest.sha256) return existing;
      throw new BuildCollisionError(
        `${describeRole(existing.role)} and ${describeRole(role)} both need ${existing.path}` +
          (existing.path === checked ? ', with different contents.' : ` (as ${checked}).`),
      );
    }
    if (this.folders.has(key)) {
      throw new BuildCollisionError(`${describeRole(role)} needs ${checked}, which is a folder.`);
    }
    const parents = segments
      .slice(0, -1)
      .map((_, index) => foldKey(segments.slice(0, index + 1).join('/') as BuildPath));
    for (const parent of parents) {
      const file = this.byKey.get(parent);
      if (file !== undefined) {
        throw new BuildCollisionError(
          `${describeRole(role)} needs ${checked} inside ${file.path}, which is a file.`,
        );
      }
    }

    const planned: PlannedFile = { path: checked, source, role, ...digest };
    this.byKey.set(key, planned);
    for (const parent of parents) this.folders.add(parent);
    return planned;
  }

  /** A file the export made, as text or bytes. */
  addBytes(path: string, data: string | Uint8Array, role: FileRole): PlannedFile {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return this.add(path, { kind: 'bytes', data: bytes }, role, digestOf(bytes));
  }

  /**
   * A file copied off the disk.
   *
   * @param digest When the caller has already read the file — an asset is
   *   hashed to be named — so it is not read a second time.
   */
  async addFile(
    path: string,
    absolute: string,
    role: FileRole,
    digest?: Digest,
  ): Promise<PlannedFile> {
    return this.add(path, { kind: 'file', path: absolute }, role, digest ?? (await digestOfFile(absolute)));
  }

  /** Every planned file, by path in code-unit order, so the list is the same on every machine. */
  files(): readonly PlannedFile[] {
    return [...this.byKey.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  has(path: BuildPath): boolean {
    return this.byKey.get(foldKey(path))?.path === path;
  }
}
