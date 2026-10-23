import { mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BUILD_LAYOUT } from '@three-studio/core';
import { atomicCopy, atomicWrite } from '../atomicWrite';
import { BUILD_FILES_NAME, buildFileList } from './buildFiles';
import type { BuildPlan, PlannedFile } from './buildPlan';
import { walkFiles, type WalkedFile } from './walk';

/*
 * The one place an export writes, and it writes the plan.
 *
 * In four passes, and their order is what keeps a folder usable:
 *
 *  1. What the volume spells differently from the plan goes first. A folder
 *     renamed from `Models` to `models` in the project is still `Models` on a
 *     volume that ignores case, and a write into `models/` lands in it — so the
 *     author's disk works and the host, which tells them apart, answers 404.
 *  2. Every planned file, the switch files last: the manifest, then the page.
 *     A reader of the folder meets the previous manifest until the new one is
 *     whole, and every write is a whole file or none (temp file and rename).
 *  3. What the build no longer holds, under its own names only. Never before
 *     the switch: until then the previous build may still need it.
 *  4. `files.json`, from the plan, last of all.
 */

/**
 * The files a build switches on, in the order they are written: after every other.
 *
 * Every other file is named by its content, so writing it never disturbs the
 * build already in the folder — the new one lands beside the old. Until the
 * manifest is replaced, a reader finds the previous build whole; until the page
 * is, the previous player. A failure before the switch leaves the previous
 * build working, with a few unreferenced files beside it.
 */
const SWITCH_FILES: readonly string[] = [BUILD_LAYOUT.manifest, BUILD_LAYOUT.page];

export async function writeBuild(
  plan: BuildPlan,
  outputDir: string,
  /** The names the export owns at the top of the folder; nothing else in it is read or touched. */
  roots: readonly string[],
  onProgress: (fraction: number) => void = () => {},
): Promise<void> {
  const files = plan.files();
  // Compared without case, as the volumes this runs on mostly compare them:
  // `Assets/` is the folder an export writing `assets/` writes into.
  const owned = new Set(roots.map((name) => name.toLowerCase()));
  const found = await walkFiles(
    outputDir,
    (name) => owned.has(name.normalize('NFC').toLowerCase()) && name !== BUILD_FILES_NAME,
  );

  // --- 1. spellings -----------------------------------------------------------
  const misspelled = misspellings(found, files);
  for (const raw of misspelled) {
    await rm(join(outputDir, ...raw.split('/')), { recursive: true, force: true });
  }

  // --- 2. the plan ------------------------------------------------------------
  const ordered = [
    ...files.filter((file) => !SWITCH_FILES.includes(file.path)),
    ...SWITCH_FILES.flatMap((path) => files.filter((file) => file.path === path)),
  ];
  const total = Math.max(
    ordered.reduce((sum, file) => sum + file.bytes, 0),
    1,
  );
  let written = 0;
  for (const file of ordered) {
    const target = join(outputDir, ...file.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    if (file.source.kind === 'file') await atomicCopy(file.source.path, target);
    else await atomicWrite(target, file.source.data);
    written += file.bytes;
    onProgress(written / total);
  }

  // --- 3. what the build no longer holds --------------------------------------
  /*
   * Content-addressed names land beside their predecessors rather than over
   * them, so a folder re-exported through a morning of tweaking one texture
   * would carry every round of it — and a stale chunk of the player, a scene
   * deleted from the project, or the scripts of a project that has none left
   * would be published with the build. Under the build's own names only:
   * whatever else is in the folder is the author's.
   */
  for (const file of found) {
    if (misspelled.some((raw) => file.raw === raw || file.raw.startsWith(`${raw}/`))) continue;
    if (plan.has(file.path as PlannedFile['path']) && file.raw === file.path) continue;
    await rm(file.absolute, { force: true });
  }
  for (const root of roots) await pruneEmptyFolders(join(outputDir, root));

  // --- 4. the list --------------------------------------------------------------
  await atomicWrite(
    join(outputDir, BUILD_FILES_NAME),
    JSON.stringify(buildFileList(files), null, 2),
  );
}

/**
 * The paths on disk — files or whole folders — that the plan spells another way.
 *
 * The shallowest misspelled part of each path is removed, so the write that
 * follows makes the folder or file under the plan's own spelling. Case and
 * Unicode normalization both: a name decomposed on disk is composed in the plan.
 */
function misspellings(found: readonly WalkedFile[], files: readonly PlannedFile[]): string[] {
  const wanted = new Map<string, string>();
  for (const { path } of files) {
    const segments = path.split('/');
    for (let end = 1; end <= segments.length; end++) {
      const part = segments.slice(0, end).join('/');
      wanted.set(part.toLowerCase(), part);
    }
  }

  const doomed = new Set<string>();
  for (const file of found) {
    const segments = file.raw.split('/');
    for (let end = 1; end <= segments.length; end++) {
      const raw = segments.slice(0, end).join('/');
      const spelled = wanted.get(raw.normalize('NFC').toLowerCase());
      if (spelled !== undefined && spelled !== raw) {
        doomed.add(raw);
        break;
      }
    }
  }
  return [...doomed];
}

/** Removes the folders under `directory` that hold nothing, and `directory` too when it ends up empty. */
async function pruneEmptyFolders(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return; // Not a folder, or not there.
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyFolders(join(directory, entry.name));
  }
  if ((await readdir(directory)).length === 0) await rmdir(directory).catch(() => undefined);
}
