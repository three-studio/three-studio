import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, createId } from '@three-studio/core';

/*
 * What a file held, last time it looked like this.
 *
 * Both scans of a project — `scanAssets` over `assets/`, `discoverScenes` over
 * `scenes/` — walk a directory and then open every file in it to read a few
 * bytes out of the front: an id, or a sidecar's settings. The walk is cheap and
 * the opening is not, and neither is the parsing. `assets:list` runs after
 * every mutation, from fourteen places in the editor, so a rename of one file
 * re-read three thousand others.
 *
 * This turns that into a `stat` per file, which is one syscall with no data and
 * no parse behind it, plus a read for however many actually changed.
 *
 * **It never becomes a source of truth.** It answers "the bytes at this path
 * have not moved since I read them", and the value it hands back is what the
 * file said. Anything it does not know, or is unsure about, it declines, and
 * the caller does the real work — which is what makes it safe to throw away.
 * `.studio/` is declared disposable and is gitignored (`createProject` writes
 * `.studio/.gitignore` containing `*`), so a missing, truncated or hand-edited
 * index costs one slow scan and nothing else.
 */

/** Enough of a `stat` to tell whether a file is the one that was read. */
export interface Stamp {
  mtimeMs: number;
  size: number;
}

/** The stamp of a file, or `null` when there is no file there. */
export async function stampOf(file: string): Promise<Stamp | null> {
  try {
    const info = await stat(file);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

/** One remembered read. Short keys: there is one of these per file in the project. */
interface Entry<T> {
  /** `mtimeMs`. */
  m: number;
  /** `size`. */
  s: number;
  /** What reading the file produced. */
  v: T;
}

interface IndexFile<T> {
  /**
   * What produced these values — see `FileIndex.open`. A mismatch discards the
   * whole file rather than trusting a value some other build computed.
   */
  builtBy: string;
  entries: Record<string, Entry<T>>;
}

export class FileIndex<T> {
  /** Held in a `Map` rather than an object: a folder may be called `__proto__`. */
  private readonly known = new Map<string, Entry<T>>();
  private readonly next = new Map<string, Entry<T>>();
  private changed = false;

  private constructor(
    private readonly file: string,
    private readonly builtBy: string,
  ) {}

  /**
   * Reads `.studio/<name>`, or starts empty.
   *
   * @param builtBy Everything the cached values were derived from, beyond the
   *   file contents themselves — the app version, and any format version whose
   *   bump changes what a read produces. It is not decoration: `readAssetMeta`
   *   merges `defaultSettings` into what it returns, so a build that adds a
   *   setting produces a different value from the same bytes, and an index that
   *   survived the upgrade would serve the old shape for ever. Anything that is
   *   *repaired* on read — an out-of-date sidecar — must be named here too, or
   *   the cache would hide the repair rather than skip a read.
   */
  static async open<T>(projectPath: string, name: string, builtBy: string): Promise<FileIndex<T>> {
    const index = new FileIndex<T>(join(projectPath, CACHE_DIR, name), builtBy);
    try {
      const parsed = JSON.parse(await readFile(index.file, 'utf8')) as Partial<IndexFile<T>>;
      if (parsed.builtBy !== builtBy || typeof parsed.entries !== 'object' || !parsed.entries) {
        return index;
      }
      for (const [path, entry] of Object.entries(parsed.entries)) {
        if (entry && typeof entry.m === 'number' && typeof entry.s === 'number') {
          index.known.set(path, entry);
        }
      }
    } catch {
      // Absent, truncated, or written by a build that shaped it differently.
      // All three mean the same thing: read the files.
    }
    return index;
  }

  /**
   * What the file at `path` held, if it still looks exactly as it did.
   *
   * Carries the entry forward on a hit, which is how the index stays the shape
   * of the project: whatever is not asked for during a scan is not written back,
   * so a deleted file leaves without anyone having to notice it went.
   */
  reuse(path: string, stamp: Stamp): T | undefined {
    const entry = this.known.get(path);
    if (!entry || entry.m !== stamp.mtimeMs || entry.s !== stamp.size) return undefined;
    this.next.set(path, entry);
    return entry.v;
  }

  /** Records what reading the file at `path` produced. */
  put(path: string, stamp: Stamp, value: T): void {
    this.next.set(path, { m: stamp.mtimeMs, s: stamp.size, v: value });
    this.changed = true;
  }

  /**
   * Writes the index back, and only when it says something new.
   *
   * A scan that found nothing changed writes nothing: the common case after the
   * first run is a rename, where one entry moves and the other thousands are
   * carried over untouched. Failure is swallowed — `.studio/` may be read-only,
   * or absent on a volume that will not make it — because a cache that cannot
   * be written is a slow scan, not a failed one.
   */
  async save(): Promise<void> {
    if (!this.changed && this.next.size === this.known.size) return;

    const body: IndexFile<T> = {
      builtBy: this.builtBy,
      entries: Object.fromEntries(this.next),
    };
    // Through a temporary file and a rename, like every other write to a
    // project: three scans run at once during an export, and a reader must get
    // one of them whole rather than the middle of another.
    const staging = `${this.file}.${createId()}.tmp`;
    try {
      await mkdir(join(this.file, '..'), { recursive: true });
      await writeFile(staging, JSON.stringify(body), 'utf8');
      await rename(staging, this.file);
    } catch {
      await rm(staging, { force: true }).catch(() => undefined);
    }
  }
}
