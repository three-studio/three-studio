import { createHash } from 'node:crypto';
import { dirname, posix, relative } from 'node:path';
import { ASSETS_DIR, BUILD_LAYOUT, type AssetEntry } from '@three-studio/core';
import { toPosix } from '../../assetFiles';
import { companionsOf } from '../../assetScan';
import { resolveInside } from '../../paths';
import { digestOfFile, type BuildPlan, type Digest, type FileRole } from '../buildPlan';
import type { ShippedAsset } from '../manifest';

export interface PlannedAssets {
  /** What the manifest says about each: where the player finds it, relative to `build.json`. */
  shipped: ShippedAsset[];
  warnings: string[];
}

/**
 * The assets a build ships, each named by its content, with the side files a
 * model names.
 *
 * @param assets The ones to ship, scripts excluded — they ship compiled. Read
 *   in the order given, which the caller makes the same on every machine.
 * @param onAsset Called before each one: on a project with a few hundred
 *   textures this is the part that takes the time, and a bar that sits still
 *   reads as a hang.
 */
export async function planAssets(
  plan: BuildPlan,
  projectPath: string,
  assets: readonly AssetEntry[],
  onAsset: (done: number, total: number) => void = () => {},
): Promise<PlannedAssets> {
  const shipped: ShippedAsset[] = [];
  const warnings: string[] = [];

  for (const [index, entry] of assets.entries()) {
    onAsset(index, assets.length);
    const original = resolveInside(projectPath, entry.path);
    // The scaled copy is what ships. It is the largest single saving a build
    // has: a museum scan carrying two 8192-square JPEGs is 166 MB of download
    // for a player who will never resolve them.
    const source =
      entry.importedPath === null ? original : resolveInside(projectPath, entry.importedPath);

    /*
     * Named by its content, so a re-export is never served from a stale cache.
     *
     * The player bundle has been hashed by Vite since the first build; the
     * project's own files kept their names, so a site somebody had already
     * visited went on showing the texture they had already downloaded. A
     * production bug, and a silent one — the build was right and the browser
     * was serving something else.
     *
     * Hashed **here**, from the bytes, and deliberately not from `entry.hash`:
     * that one is the digest taken at import and refreshed only when the editor
     * itself rewrites a material or a prefab. A texture edited in Photoshop
     * keeps its sidecar hash for ever, which is exactly the case this is for.
     */
    const digest = await digestOfFile(source);
    const inAssets = toPosix(relative(ASSETS_DIR, entry.path));
    const role: FileRole = { kind: 'asset', assetId: entry.id, assetKind: entry.kind };

    /*
     * A `.gltf` names its buffer and its images in the file, not by asset id,
     * so nothing a scene references accounts for them — the build would ship a
     * model with no geometry. Same for an `.obj` and its `.mtl`.
     *
     * Asked of the **original**, never of the copy: a `.gltf` names its
     * siblings relative to itself, and they sit beside the source rather than
     * in the cache. Resolved inside its folder, outside the `try`: a name that
     * would leave it is not a missing file, and must not be reported as one.
     */
    const companions: { name: string; from: string; digest: Digest }[] = [];
    for (const name of await companionsOf(original)) {
      const from = resolveInside(dirname(original), name);
      try {
        companions.push({ name, from, digest: await digestOfFile(from) });
      } catch {
        warnings.push(`${entry.name} refers to ${name}, which is not in the project.`);
      }
    }

    if (companions.length === 0) {
      const path = `assets/${hashedName(inAssets, digest.sha256)}`;
      await plan.addFile(`${BUILD_LAYOUT.game}/${path}`, source, role, digest);
      shipped.push({ entry, path });
      continue;
    }

    /*
     * A model with side files ships as a folder named by everything in it.
     *
     * The side files cannot be renamed — their names are written inside the
     * model, relative to it — so they used to keep their names beside a hashed
     * model. A texture edited after an export then kept its URL, and a visitor
     * who had seen the model was served the old texture from the cache: the bug
     * hashing the names was for, back by the side door. A folder hashed over
     * the model and every side file changes when any of them does, and the
     * references inside the model resolve exactly as they did.
     */
    const folder = `assets/${packageName(inAssets, packageHash(digest, companions))}`;
    const model = `${folder}/${posix.basename(inAssets)}`;
    await plan.addFile(`${BUILD_LAYOUT.game}/${model}`, source, role, digest);
    for (const companion of companions) {
      await plan.addFile(
        `${BUILD_LAYOUT.game}/${folder}/${companion.name}`,
        companion.from,
        role,
        companion.digest,
      );
    }
    shipped.push({ entry, path: model });
  }

  return { shipped, warnings };
}

/** The digest a package is named by: the model's, and each side file's under its name. */
function packageHash(model: Digest, companions: readonly { name: string; digest: Digest }[]): string {
  const hash = createHash('sha256').update(model.sha256);
  const sorted = [...companions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, digest } of sorted) hash.update(`\n${name}\t${digest.sha256}`);
  return hash.digest('hex');
}

/** `textures/brick.png` → its folder, its name without the extension, and the extension. */
function splitName(path: string): { directory: string; stem: string; extension: string } {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    directory,
    stem: dot <= 0 ? file : file.slice(0, dot),
    extension: dot <= 0 ? '' : file.slice(dot),
  };
}

/**
 * `textures/brick.png` and a digest → `textures/brick.a1b2c3d4.png`.
 *
 * Eight hex characters, as the player's own chunks use: thirty-two bits, so a
 * collision inside one build is not a thing that happens, and short enough that
 * the name still reads as the file it came from when someone opens the folder.
 *
 * The last dot only, so `Brick.material.json` becomes `Brick.material.<h>.json`
 * and still reads as a material. A leading dot is a whole name — `.gitkeep` is
 * not an extension — which is what `dot <= 0` says.
 */
export function hashedName(path: string, hash: string): string {
  const { directory, stem, extension } = splitName(path);
  return `${directory}${stem}.${hash.slice(0, 8)}${extension}`;
}

/** `models/Tri/Tri.gltf` and a digest → `models/Tri/Tri.a1b2c3d4`, the folder its package ships in. */
function packageName(path: string, hash: string): string {
  const { directory, stem } = splitName(path);
  return `${directory}${stem}.${hash.slice(0, 8)}`;
}
