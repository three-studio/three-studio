import { posix } from 'node:path';
import type { AssetEntry, BuildManifest, LaunchSnapshot, SceneEntry } from '@three-studio/core';
import { assembleManifest } from '../buildManifest';

/** What a launch is made of: the editor's memory, and what was read from disk for it. */
export interface LaunchContents {
  snapshot: LaunchSnapshot;
  /** The project's scenes as `discoverScenes` lists them, which is path order. */
  scenes: readonly SceneEntry[];
  /** Every asset in the project, as a scan lists them. */
  assets: readonly AssetEntry[];
  /** The project's name: a launch runs no build profile to borrow a title from. */
  title: string;
  /** The compiled bundle, or `null` when the project has no scripts. */
  scripts: string | null;
}

/**
 * Where a launch serves an asset under `assets/`: its id, then its source's
 * file name.
 *
 * The id is how the server finds it, so the name never has to be looked up.
 * The source's name even when a scaled copy is what is served, as an export
 * names its copies: the extension is what picks the player's loader, and the
 * model's companions — a glTF's buffer, an OBJ's material file — are named
 * relative to the source, beside which the server finds them.
 */
export function launchAssetPath(entry: AssetEntry): string {
  return `${entry.id}/${posix.basename(entry.path)}`;
}

/**
 * The `build.json` a device runs, from what is on screen.
 *
 * Pure: the caller reads the disk — the scene list, one scan, the script
 * build, the project's name — and this decides what the manifest lists. What
 * the manifest *says* about it is `assembleManifest`'s, as for an export.
 */
export function launchManifest(contents: LaunchContents): BuildManifest {
  const { snapshot, scenes, assets, title, scripts } = contents;
  const { entry } = snapshot;
  return assembleManifest({
    title,
    rendering: snapshot.rendering,
    physics: snapshot.physics,
    /*
     * The entry first, under the window's id and name, then every other scene:
     * Play can go to any of them, and so must a device. The entry is always
     * answered from the snapshot, so it needs no file of its own, and its file
     * is not listed a second time. A shadowed file is left out: its id answers
     * to the first file by path order, which is the one served.
     */
    scenes: [
      { id: entry.id, name: entry.name },
      ...scenes.filter((scene) => scene.id !== entry.id && scene.shadowedBy === null),
    ],
    loadingScene: snapshot.loadingScene,
    /*
     * Every asset rather than what the scenes link to: a script can load any
     * of them by id, which no walk of the scenes can see — Play can, so a
     * device has to. Scripts are the exception, shipped compiled in the bundle.
     */
    assets: assets
      .filter((asset) => asset.kind !== 'script')
      .map((asset) => ({ entry: asset, path: launchAssetPath(asset) })),
    // Whole, and with Prefab Mode's unsaved edits in them: what Play would run.
    materials: snapshot.materials,
    prefabs: snapshot.prefabs,
    scripts: scripts === null ? null : 'scripts.mjs',
  });
}
