import type { AssetSettings, TextureEncoding } from '@three-studio/core';

/**
 * Turns an asset id into a URL the loaders can fetch.
 *
 * The runtime never learns where assets actually live. In the editor the URL is
 * a `studio-asset://` request served by the main process; in an exported web
 * build it is a relative path inside the bundle. Keeping that behind an
 * interface is what lets the same runtime serve both.
 */
export interface AssetResolver {
  /** `null` when the asset is unknown — a scene referencing a deleted file. */
  url: (assetId: string) => string | null;
  /**
   * How an image stores light, when its name cannot say.
   *
   * An Ultra HDR file is a `.jpg`, and only its gainmap metadata tells it from
   * a photograph — so the extension, which decides every other format, is not
   * enough. Worked out once when the asset was imported and carried here rather
   * than re-derived, because the alternative is fetching a file twice: once to
   * find out what it is and once to decode it.
   *
   * Optional so a resolver that does not know can say so by leaving it out;
   * `ModelCache` falls back to the extension, which is right for everything
   * except the one format that needs this.
   */
  encoding?: (assetId: string) => TextureEncoding | null;
  /**
   * What the author chose when the file was imported.
   *
   * The scale that turns Unreal's centimetres into metres, the colour space a
   * normal map has to be read in, the gain on a sound effect. Decided once, in
   * the import dialog, written into the sidecar, and applied here — so a model
   * is the size it was imported at in the editor, in play mode and in an
   * exported build alike.
   *
   * Optional, like `encoding`: a resolver that has no sidecars to read leaves it
   * out, and every consumer falls back to the format's defaults.
   */
  settings?: (assetId: string) => AssetSettings | null;
}

/** Used when no project is open; every lookup misses. */
export const NULL_ASSET_RESOLVER: AssetResolver = { url: () => null };
