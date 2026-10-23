import {
  BUILD_FORMAT_VERSION,
  type AssetEntry,
  type AssetSettings,
  type BuildManifest,
  type BuildScene,
  type MaterialDef,
  type PhysicsSettings,
  type PrefabDoc,
  type RenderingSettings,
  type TextureEncoding,
} from '@three-studio/core';

/**
 * One asset a build carries, and where the player finds it.
 *
 * The path is the caller's, relative to `build.json`: an export names a file by
 * its content, a device launch by the asset's id, and the manifest only has to
 * repeat it.
 */
export interface ShippedAsset {
  entry: AssetEntry;
  path: string;
}

/** Everything a caller has decided to ship, and where it put it. */
export interface ManifestContents {
  title: string;
  rendering: RenderingSettings;
  physics: PhysicsSettings;
  /** Entry point first; the rest ship for a script to load later. */
  scenes: readonly BuildScene[];
  loadingScene: string | null;
  assets: readonly ShippedAsset[];
  materials: Record<string, MaterialDef>;
  prefabs: Record<string, PrefabDoc>;
  /** The bundle's path relative to `build.json`, or `null` when there are no scripts. */
  scripts: string | null;
}

/**
 * What `build.json` says about what a build ships.
 *
 * The one place it is said. An export and a device launch choose differently —
 * one ships what its scenes reach and names files by their content, the other
 * ships everything under the asset's id — and the player cannot tell them
 * apart, so what a field means has to be decided once. Two literals kept in
 * step by hand is how the script build result lost a field on one side.
 *
 * Typed against `BuildManifest` in core: the reader is a browser and the writer
 * is the main process, so nothing but a shared declaration keeps them in step.
 * What each field means is on that type; what is decided here is below.
 *
 * **The same bytes for the same project, on any machine.** Every table is
 * filled in id order. They used to follow the order the asset scan met the
 * files in, which is whatever order the volume lists a folder in — so the same
 * project exported on two machines, or after a copy, showed a diff in a build
 * that had not changed. The scenes keep the caller's order, which means
 * something: the first is where the game starts.
 */
export function assembleManifest(contents: ManifestContents): BuildManifest {
  const assets: Record<string, string> = {};
  /**
   * Only the images whose file name does not already say what they are.
   *
   * Which today means Ultra HDR and nothing else: it is a `.jpg`, so the player
   * would send it through the ordinary image path and quietly lose every stop
   * of range above white — a sky that casts no light rather than a visible
   * failure. Radiance and OpenEXR are named by their extension and are not
   * listed, so this map is empty for almost every build.
   */
  const textureEncodings: Record<string, TextureEncoding> = {};
  /**
   * What the author chose at import, for every asset that ships.
   *
   * The player has no sidecars — they stay in the project — so without this a
   * model that is 2746 units in the file would be 2746 units in the build,
   * while the editor showed it at the scale it was imported at. A build that
   * does not look like the editor is the one bug an export must not have.
   */
  const assetSettings: Record<string, AssetSettings> = {};
  for (const { entry, path } of [...contents.assets].sort((a, b) =>
    byKey(a.entry.id, b.entry.id),
  )) {
    assets[entry.id] = path;
    if (entry.settings.kind === 'texture' && entry.settings.encoding === 'ultrahdr') {
      textureEncodings[entry.id] = entry.settings.encoding;
    }
    assetSettings[entry.id] = entry.settings;
  }

  return {
    formatVersion: BUILD_FORMAT_VERSION,
    title: contents.title,
    rendering: contents.rendering,
    physics: contents.physics,
    scenes: contents.scenes.map(({ id, name, path }) => ({ id, name, path })),
    loadingScene: contents.loadingScene,
    assets,
    materials: sortedRecord(contents.materials),
    prefabs: sortedRecord(contents.prefabs),
    textureEncodings,
    assetSettings,
    scripts: contents.scripts,
  };
}

/** Code-unit order: the same on every machine, whatever its locale. */
function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A record with its keys in code-unit order.
 *
 * Through `Object.fromEntries`, which defines each key as its own: a material
 * whose id were `__proto__` would otherwise be taken as the object's prototype.
 */
function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => byKey(a, b)));
}
