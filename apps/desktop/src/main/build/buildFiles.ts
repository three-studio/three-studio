import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASSET_KIND_INFO, type AssetKind, type BuildSize } from '@three-studio/core';
import { AssetError } from '../assetFiles';
import { foldKey, toBuildPath } from './buildPath';
import { digestOfFile, type PlannedFile } from './buildPlan';
import { walkFiles } from './walk';

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
 * **Written from the plan, not from a walk of the folder.** The walk said what
 * was on the disk, which was its argument — but the disk held more than the
 * build. Exported into a GitHub Pages repository it listed `.git/`, which every
 * commit changes, so every later export rewrote the list; and its 27 MB were
 * reported as the player's weight. The plan is what the writer writes, byte for
 * byte, so the list still says what is on the disk — the part of it that is
 * the build's.
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

/**
 * The list's shape, read by tools outside this repository — a CI job that
 * verifies a build before publishing it. Unlike `build.json`, which only ever
 * travels with its own player, this one keeps every field it has ever had.
 */
export const BUILD_FILES_VERSION = 1;

export interface BuildFile {
  /** Relative to the build root, `/`-separated, NFC. */
  path: string;
  bytes: number;
  /** SHA-256, lower-case hex, of the file as it was written. */
  sha256: string;
}

export interface BuildFileList {
  formatVersion: number;
  files: BuildFile[];
}

export interface BuildVerification {
  /** Nothing missing, nothing altered, and nothing there that should not be. */
  ok: boolean;
  missing: string[];
  changed: string[];
  /**
   * Under one of the build's own folders, and not in the list.
   *
   * Neither missing nor altered, and reported anyway: a file that appeared
   * after the export is exactly what an injected one looks like. The rest of
   * the folder is the author's, and a README beside a build is not news.
   */
  unexpected: string[];
}

/** What `files.json` holds for a plan: every file, with its size and digest. */
export function buildFileList(files: readonly PlannedFile[]): BuildFileList {
  return {
    formatVersion: BUILD_FILES_VERSION,
    files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  };
}

/**
 * Reads the folder back and compares it against its own list.
 *
 * Only under the names the list's paths start with — the build's own folders
 * and files. A `.git/` or a README beside the build is the author's business,
 * and so is a page added beside it: the player cannot reach one without a
 * change to `index.html` or `build.json`, and both are listed.
 *
 * @throws when there is no list to compare against, or one that cannot be read
 *   as a list. "This cannot be verified" is a different answer from "this does
 *   not verify", and a caller that collapsed the two would report an unexported
 *   folder as a tampered build.
 */
export async function verifyBuild(outputDir: string): Promise<BuildVerification> {
  const listed = await readBuildFiles(outputDir);
  const roots = new Set(listed.map((file) => file.path.split('/')[0]!));
  // Emptied as it is matched, so what is left over at the end is what the list
  // never mentioned — one pass, and no second set to keep in step with it.
  const present = new Map(
    (await walkFiles(outputDir, (name) => roots.has(name.normalize('NFC')))).map((found) => [
      found.path,
      found,
    ]),
  );

  const missing: string[] = [];
  const changed: string[] = [];
  for (const file of listed) {
    const found = present.get(file.path);
    if (found === undefined) {
      missing.push(file.path);
      continue;
    }
    present.delete(file.path);
    // A link where a file was written is a change whatever it points at: what
    // a host serves through it is not what was listed.
    if (found.symlink) {
      changed.push(file.path);
      continue;
    }
    const digest = await digestOfFile(found.absolute);
    // The size is compared too, though the digest already covers it: a
    // mismatch there is the readable half of the answer.
    if (digest.sha256 !== file.sha256 || digest.bytes !== file.bytes) changed.push(file.path);
  }

  const unexpected = [...present.keys()].sort();
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
  return parseBuildFileList(parsed).files;
}

function unreadable(reason: string): never {
  throw new AssetError(`${BUILD_FILES_NAME} cannot be checked against: ${reason}.`);
}

/**
 * The list as written, or why it cannot be checked against.
 *
 * Every field is proved rather than cast. The list is the one input a verifier
 * has no reason to trust — it is in the folder being verified — and a cast let
 * a path like `../../etc/passwd` send the verifier hashing files outside the
 * build, and a missing digest crash it.
 */
export function parseBuildFileList(value: unknown): BuildFileList {
  if (typeof value !== 'object' || value === null) unreadable('it is not an object');
  const { formatVersion, files } = value as { formatVersion?: unknown; files?: unknown };
  if (formatVersion !== BUILD_FILES_VERSION) {
    unreadable(`it is format ${String(formatVersion)}, and this reads ${BUILD_FILES_VERSION}`);
  }
  if (!Array.isArray(files)) unreadable('it lists no files');

  const seen = new Set<string>();
  const checked: BuildFile[] = [];
  for (const [index, entry] of (files as unknown[]).entries()) {
    if (typeof entry !== 'object' || entry === null) unreadable(`entry ${index} is not an object`);
    const { path, bytes, sha256 } = entry as { path?: unknown; bytes?: unknown; sha256?: unknown };
    if (typeof path !== 'string') unreadable(`entry ${index} has no path`);
    let valid: string;
    try {
      valid = toBuildPath(path as string);
    } catch (cause) {
      unreadable(cause instanceof Error ? cause.message.replace(/\.$/, '') : String(cause));
    }
    // A name the writer would never have written — decomposed, say — is a list
    // something else wrote.
    if (valid !== path) unreadable(`${String(path)} is not spelled the way an export spells it`);
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      unreadable(`${valid} has no size`);
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      unreadable(`${valid} has no SHA-256`);
    }
    const key = foldKey(toBuildPath(valid));
    if (seen.has(key)) unreadable(`${valid} is listed twice`);
    seen.add(key);
    checked.push({ path: valid, bytes: bytes as number, sha256: sha256 as string });
  }
  return { formatVersion: BUILD_FILES_VERSION, files: checked };
}

/**
 * What the build weighs, from what was planned.
 *
 * Every file lands in exactly one row, and the rows sum to the total — which is
 * checked, because a breakdown that nearly adds up is worse than none. The row
 * is the file's role, which the step that planned it set: the folder a file
 * lands in used to be read back as its kind, and an asset kept outside its
 * kind's default folder was counted as part of the player.
 */
export function sizeOf(files: readonly PlannedFile[]): BuildSize {
  const assets = Object.fromEntries(
    Object.keys(ASSET_KIND_INFO).map((kind) => [kind, 0]),
  ) as Record<AssetKind, number>;
  const size: BuildSize = { total: 0, player: 0, scenes: 0, scripts: 0, assets };

  for (const file of files) {
    size.total += file.bytes;
    switch (file.role.kind) {
      case 'scene':
        size.scenes += file.bytes;
        break;
      case 'scripts':
        size.scripts += file.bytes;
        break;
      case 'asset':
        size.assets[file.role.assetKind] = (size.assets[file.role.assetKind] ?? 0) + file.bytes;
        break;
      // The page, the engine and the manifest, deliberately one row: one fixed
      // cost as far as anyone reading this is concerned, and a row nothing
      // lands in is a row that has to be explained.
      case 'page':
      case 'player':
      case 'manifest':
        size.player += file.bytes;
        break;
    }
  }

  return size;
}
