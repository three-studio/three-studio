import { dirname, posix, relative } from 'node:path';
import { ASSETS_DIR, type AssetEntry } from '@three-studio/core';
import { toPosix } from '../../assetFiles';
import { companionsOf } from '../../assetScan';
import { resolveInside } from '../../paths';
import { digestOfFile, type BuildPlan, type Digest } from '../buildPlan';
import type { ShippedAsset } from '../manifest';

export interface PlannedAssets {
  /** What the manifest says about each: where under `assets/` the player finds it. */
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
     *
     * Free in every other sense, because the indirection was already there: the
     * player never sees a file name, it reads `assets` in the manifest.
     */
    const digest: Digest = await digestOfFile(source);
    const name = hashedName(toPosix(relative(ASSETS_DIR, entry.path)), digest.sha256);
    const role = { kind: 'asset', assetId: entry.id, assetKind: entry.kind } as const;
    await plan.addFile(`assets/${name}`, source, role, digest);
    shipped.push({ entry, path: name });

    /*
     * A `.gltf` names its buffer and its images in the file, not by asset id,
     * so nothing a scene references accounts for them — the build would ship a
     * model with no geometry. Same for an `.obj` and its `.mtl`.
     *
     * Planned under their own names, and that is the point: the names are
     * written inside the model, relative to it, and the model has not moved —
     * only its own file name carries the hash. Hashing a companion would break
     * the reference that names it.
     *
     * Asked of the **original**, never of the copy: a `.gltf` names its siblings
     * relative to itself, and they sit beside the source rather than in the
     * cache. Resolved inside its folder, outside the `try`: a name that would
     * leave it is not a missing file, and must not be reported as one.
     */
    for (const companion of await companionsOf(original)) {
      const from = resolveInside(dirname(original), companion);
      let companionDigest: Digest;
      try {
        companionDigest = await digestOfFile(from);
      } catch {
        warnings.push(`${entry.name} refers to ${companion}, which is not in the project.`);
        continue;
      }
      await plan.addFile(
        posix.join('assets', posix.dirname(name), companion),
        from,
        role,
        companionDigest,
      );
    }
  }

  return { shipped, warnings };
}

/**
 * `textures/brick.png` and a digest -> `textures/brick.a1b2c3d4.png`.
 *
 * Eight hex characters, as Vite uses for the same job: thirty-two bits, so a
 * collision inside one build is not a thing that happens, and short enough that
 * the name still reads as the file it came from when someone opens the folder.
 *
 * The last dot only, so `Brick.material.json` becomes `Brick.material.<h>.json`
 * and still reads as a material. A leading dot is a whole name — `.gitkeep` is
 * not an extension — which is what `dot <= 0` says.
 */
export function hashedName(path: string, hash: string): string {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot <= 0 ? file : file.slice(0, dot);
  const extension = dot <= 0 ? '' : file.slice(dot);
  return `${directory}${stem}.${hash.slice(0, 8)}${extension}`;
}
