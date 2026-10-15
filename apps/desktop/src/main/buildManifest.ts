import {
  BUILD_FORMAT_VERSION,
  type AssetEntry,
  type AssetSettings,
  type BuildManifest,
  type MaterialDef,
  type PrefabDoc,
  type RenderingSettings,
  type SceneEntry,
  type TextureEncoding,
} from '@three-studio/core';

/**
 * One asset a build carries, and where under `assets/` the player finds it.
 *
 * The path is the caller's: an export names a file by its content hash, a
 * device launch by the asset's id, and the manifest only has to repeat it.
 */
export interface ShippedAsset {
  entry: AssetEntry;
  path: string;
}

/** Everything a caller has decided to ship. */
export interface ManifestContents {
  title: string;
  rendering: RenderingSettings;
  /** Entry point first; the rest ship for a script to load later. */
  scenes: readonly Pick<SceneEntry, 'id' | 'name'>[];
  loadingScene: string | null;
  assets: readonly ShippedAsset[];
  materials: Record<string, MaterialDef>;
  prefabs: Record<string, PrefabDoc>;
  /** The bundle's path beside `build.json`, or `null` when there are no scripts. */
  scripts: string | null;
}

/**
 * What `build.json` says about what a build ships.
 *
 * The one place it is said. An export and a device launch choose differently —
 * one ships what its scenes reach and names files by their hash, the other
 * ships everything under the asset's id — and the player cannot tell them
 * apart, so what a field means has to be decided once. Two literals kept in
 * step by hand is how the script build result lost a field on one side.
 *
 * Typed against `BuildManifest` in core: the reader is a browser and the writer
 * is the main process, so nothing but a shared declaration keeps them in step.
 * What each field means is on that type; what is decided here is below.
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
  for (const { entry, path } of contents.assets) {
    assets[entry.id] = path;
    if (entry.settings.kind === 'texture' && entry.settings.encoding === 'ultrahdr') {
      textureEncodings[entry.id] = entry.settings.encoding;
    }
    assetSettings[entry.id] = entry.settings;
  }

  /*
   * An alias, not an address: a script may name a level, and the name is what
   * an author reads in the editor. Nothing is found by it — see `sceneNames`.
   *
   * The first scene under a name keeps it. The entry is listed first, so when a
   * scene in another folder shares its name the entry still answers to it, as
   * `scenes.current` does in Play; the last one used to win, which left the
   * entry reachable by its id alone.
   *
   * Through a `Map` and `Object.fromEntries` rather than by assigning into an
   * object: a scene may be called `constructor`, which every object already
   * answers to, or `__proto__`, which an assignment would take as the object's
   * prototype instead of a name.
   */
  const names = new Map<string, string>();
  for (const { id, name } of contents.scenes) {
    if (!names.has(name)) names.set(name, id);
  }

  return {
    formatVersion: BUILD_FORMAT_VERSION,
    title: contents.title,
    // Kept beside `rendering`, which subsumes it: a build written before that
    // field carries only this one, and a player from then still falls back to
    // it. Persisted data gains fields; it does not lose them.
    forceWebGL: contents.rendering.forceWebGL,
    rendering: contents.rendering,
    scenes: contents.scenes.map(({ id }) => id),
    sceneNames: Object.fromEntries(names),
    // The id the project already holds, passed through. An id naming a scene
    // this build does not ship reaches the player as a loading scene it cannot
    // read, which it says out loud — where dropping it here was silent.
    loadingScene: contents.loadingScene,
    assets,
    materials: contents.materials,
    prefabs: contents.prefabs,
    textureEncodings,
    assetSettings,
    scripts: contents.scripts,
  };
}
