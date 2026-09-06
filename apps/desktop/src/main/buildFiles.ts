import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSET_KIND_INFO, type AssetKind, type BuildSize } from '@three-studio/core';
import { AssetError, hashFile } from './assetFiles';

/*
 * What an export wrote, and how to check a folder still holds exactly that.
 *
 * Nothing said what a build contained. A CI job that publishes one could not
 * tell a complete folder from a half-copied one, and nobody could tell a
 * published folder from a published folder with one file swapped — which is the
 * shape of every supply-chain attack on a static site.
 *
 * **Not part of `build.json`, and that is the same reasoning as folding the
 * three documents into it, run the other way.** Those were small and always
 * needed, so a separate request for each was a round trip spent on nothing.
 * This is never needed at runtime: the player would download a list of every
 * asset in the build, before the first frame, to ignore it. So it is a file of
 * its own — which also lets `build.json` be listed and checked like everything
 * else.
 *
 * Written *and* read here, together, for the reason `BuildManifest` is declared
 * once: the two halves have to agree about the shape, and a digest that agrees
 * with nothing is worse than no digest at all.
 */

/**
 * The list itself, which is the one file it cannot describe.
 *
 * Nothing can hash a file that holds its own hash. A manifest is the anchor,
 * and what vouches for the anchor is outside the folder — a signature, or the
 * CI artifact it arrived in.
 */
export const BUILD_FILES_NAME = 'files.json';

export interface BuildFile {
  /** Relative to the build root, with `/` separators on every platform. */
  path: string;
  bytes: number;
  /** SHA-256, lower-case hex, of the file as it was written. */
  sha256: string;
}

export interface BuildFileList {
  files: BuildFile[];
}

export interface BuildVerification {
  /** Nothing missing, nothing altered, and nothing there that should not be. */
  ok: boolean;
  missing: string[];
  changed: string[];
  /**
   * In the folder and not in the list.
   *
   * Neither missing nor altered, and reported anyway: a file that appeared
   * after the export is exactly what an injected one looks like, and the walk
   * has already found it. The exporter empties the directories it owns so this
   * stays empty for an ordinary re-export.
   */
  unexpected: string[];
}

/**
 * Lists every file in the build, with its size and its digest.
 *
 * A walk of the folder rather than a list kept while writing, and the
 * difference is the whole point: a list kept while writing says what the
 * exporter *meant* to produce, and this says what is on the disk. It cannot
 * forget the player's own files either — those arrive by copying a directory,
 * so the exporter never names them one by one.
 *
 * Sorted, so re-exporting an unchanged project writes the same bytes and a
 * folder under version control shows no diff.
 */
export async function writeBuildFiles(outputDir: string): Promise<BuildFile[]> {
  const files: BuildFile[] = [];
  for (const path of await contentsOf(outputDir)) files.push(await describe(outputDir, path));

  const list: BuildFileList = { files };
  await writeFile(join(outputDir, BUILD_FILES_NAME), JSON.stringify(list, null, 2), 'utf8');
  return files;
}

/**
 * Reads the folder back and compares it against its own list.
 *
 * @throws when there is no list to compare against. "This cannot be verified"
 *   is a different answer from "this does not verify", and a caller that
 *   collapsed the two would report an unexported folder as a tampered build.
 */
export async function verifyBuild(outputDir: string): Promise<BuildVerification> {
  const listed = await readBuildFiles(outputDir);
  // Emptied as it is matched, so what is left over at the end is what the list
  // never mentioned — one pass, and no second set to keep in step with it.
  const present = new Set(await contentsOf(outputDir));

  const missing: string[] = [];
  const changed: string[] = [];
  for (const file of listed) {
    if (!present.delete(file.path)) {
      missing.push(file.path);
      continue;
    }
    const found = await describe(outputDir, file.path);
    // The size is compared too, though the digest already covers it: a
    // mismatch there is the readable half of the answer.
    if (found.sha256 !== file.sha256 || found.bytes !== file.bytes) changed.push(file.path);
  }

  const unexpected = [...present].sort();
  return {
    ok: missing.length === 0 && changed.length === 0 && unexpected.length === 0,
    missing,
    changed,
    unexpected,
  };
}

async function readBuildFiles(outputDir: string): Promise<readonly BuildFile[]> {
  let raw: string;
  try {
    raw = await readFile(join(outputDir, BUILD_FILES_NAME), 'utf8');
  } catch {
    throw new AssetError(
      `${BUILD_FILES_NAME} is not in this folder, so there is nothing to check it against.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new AssetError(`${BUILD_FILES_NAME} is not readable: ${String(cause)}`);
  }

  const files = (parsed as Partial<BuildFileList> | null)?.files;
  if (!Array.isArray(files)) throw new AssetError(`${BUILD_FILES_NAME} lists no files.`);
  return files;
}

/**
 * Every file under the build root, by path, sorted — minus the list itself.
 *
 * Depth first and by hand rather than `readdir(recursive)`: the result has to
 * carry `/` separators on every platform, since it is compared against what a
 * previous export wrote and a build folder travels between machines.
 */
async function contentsOf(root: string, from = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, from), { withFileTypes: true })) {
    const at = from === '' ? entry.name : `${from}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await contentsOf(root, at)));
    else if (at !== BUILD_FILES_NAME) found.push(at);
  }
  return from === '' ? found.sort() : found;
}

async function describe(root: string, path: string): Promise<BuildFile> {
  const file = join(root, ...path.split('/'));
  return { path, bytes: (await stat(file)).size, sha256: await hashFile(file) };
}

/**
 * Which asset kind owns each directory under `assets/`.
 *
 * Read off the importers rather than listed, for the reason `createProject`
 * makes the folders that way: the list that used to be written by hand named
 * four of the seven. One directory per kind today; two kinds sharing one would
 * put both on a single row, which is a cosmetic answer to a case that does not
 * exist.
 */
const KIND_BY_DIRECTORY = new Map<string, AssetKind>(
  Object.entries(ASSET_KIND_INFO).map(([kind, info]) => [info.directory, kind as AssetKind]),
);

/**
 * What the build weighs, from the list of what was written.
 *
 * Every file lands in exactly one row, and the rows sum to the total — which is
 * checked, because a breakdown that nearly adds up is worse than none.
 *
 * @param scriptFile The compiled bundle's name, or `null`. Passed in rather
 *   than assumed: the exporter chooses it, and the player is *told* it in the
 *   manifest rather than guessing, so this is not the place to guess either.
 */
export function sizeOf(files: readonly BuildFile[], scriptFile: string | null): BuildSize {
  const assets = Object.fromEntries(
    [...KIND_BY_DIRECTORY.values()].map((kind) => [kind, 0]),
  ) as Record<AssetKind, number>;
  const size: BuildSize = { total: 0, player: 0, scenes: 0, scripts: 0, assets };

  for (const file of files) {
    size.total += file.bytes;
    const [head, next] = file.path.split('/');
    const kind = head === 'assets' && next !== undefined ? KIND_BY_DIRECTORY.get(next) : undefined;

    if (kind !== undefined) size.assets[kind] += file.bytes;
    else if (head === 'scenes') size.scenes += file.bytes;
    else if (file.path === scriptFile) size.scripts += file.bytes;
    // Everything else, `build.json` included, and deliberately with no bucket
    // of its own: the page, the engine and the manifest are one fixed cost as
    // far as anyone reading this is concerned, and a row nothing lands in is a
    // row that has to be explained.
    else size.player += file.bytes;
  }

  return size;
}
