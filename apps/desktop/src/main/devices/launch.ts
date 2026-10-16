import {
  createId,
  serializeScene,
  type AssetEntry,
  type BuildManifest,
  type LaunchSnapshot,
  type SceneEntry,
} from '@three-studio/core';
import { scanAssets } from '../assetScan';
import { discoverScenes, readProject } from '../project';
import { buildScripts } from '../scripts';
import { launchManifest } from './launchManifest';

/**
 * What the device server answers from, for one launch.
 *
 * Everything a device asks for that is not a file on disk is held here,
 * computed once as the launch is made: a phone asks for `build.json`, the scene
 * and the bundle every time it restarts, and none of them change until the
 * next launch.
 */
export interface Launch {
  readonly id: string;
  /** When it was made, in milliseconds since the epoch. */
  readonly at: number;
  readonly projectPath: string;
  /** The entry scene's name, as the window shows it. */
  readonly sceneName: string;
  /** The window's id for the entry scene: the one id answered from memory. */
  readonly entryId: string;
  /** The scene on screen, serialized once. */
  readonly entryJson: string;
  /**
   * As `launchManifest` made it. Kept whole rather than written once: the
   * launch options a device's renderer reads are written into it as it is
   * served, and they may change while the launch runs.
   */
  readonly manifest: BuildManifest;
  /** The compiled bundle, or `null` when the project has no scripts. */
  readonly scripts: string | null;
  /** Every asset a device may ask for, by id. Scripts are not among them: they ship compiled. */
  readonly assets: ReadonlyMap<string, AssetEntry>;
  /** The project's scenes, for every one but the entry, which is read from disk when asked for. */
  readonly scenes: readonly SceneEntry[];
}

/**
 * A launch, from the editor's snapshot and the project's files.
 *
 * Saves nothing, and copies nothing: what it writes is what Play writes — the
 * script entry under `.studio/`, and sidecars a scan repairs.
 *
 * One step after the other, never two at once. `buildScripts` scans the assets
 * itself, and a scan writes the sidecars it finds missing or stale: two at once
 * race on the same files, and a reader that catches one half-written adopts
 * the asset under a fresh id.
 *
 * The scripts come first, so that a project whose scripts do not compile is
 * refused before anything else is read — as Play refuses it, and in the
 * exporter's words.
 */
export async function prepareLaunch(
  projectPath: string,
  snapshot: LaunchSnapshot,
): Promise<Launch> {
  const compiled = await buildScripts(projectPath);
  if (compiled.errors.length > 0) {
    throw new Error(`Scripts did not compile:\n${compiled.errors.join('\n')}`);
  }
  const scripts = compiled.scriptCount > 0 ? compiled.code : null;
  const { assets } = await scanAssets(projectPath);
  const scenes = await discoverScenes(projectPath);
  // The project's name, not a build profile's title: a launch runs no profile.
  const { name: title } = await readProject(projectPath);
  const manifest = launchManifest({ snapshot, scenes, assets, title, scripts });

  return {
    id: createId(),
    at: Date.now(),
    projectPath,
    sceneName: snapshot.entry.name,
    entryId: snapshot.entry.id,
    entryJson: serializeScene(snapshot.entry.scene),
    manifest,
    scripts,
    assets: new Map(
      assets.filter((asset) => asset.kind !== 'script').map((asset) => [asset.id, asset]),
    ),
    scenes,
  };
}
