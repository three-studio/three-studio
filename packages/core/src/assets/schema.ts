import type { MaterialDef } from '../scene/schema';
export type AssetKind =
  | 'model'
  | 'texture'
  | 'material'
  | 'prefab'
  | 'shader'
  | 'audio'
  | 'script';

export const MATERIAL_ASSET_VERSION = 1;

/**
 * Shape of the files an exported build carries beside the player.
 *
 * The player and the data are written together but do not have to stay
 * together: a folder can be re-exported by a newer editor over an older
 * player, or a player dropped onto older data. Without a number the mismatch
 * shows up as an undefined field somewhere deep, which is the worst way to
 * find out.
 */
/**
 * 2 — `build.json` carries `textureEncodings`, naming the images whose file
 * name does not say how they store light. Additive: a player that does not
 * know the field decodes an Ultra HDR image as the JPEG it is, which is a sky
 * that casts no light rather than a build that fails to open.
 *
 * 3 — `build.json` carries `assetSettings`, what each asset was imported with.
 * The sidecars stay in the project, so without this a model exported at ×0.01
 * ships at its file's own scale and the build does not look like the editor.
 * Additive again, and `textureEncodings` stays: it is subsumed by this but a
 * player from before format 3 reads only that one.
 */
export const BUILD_FORMAT_VERSION = 3;

/**
 * On-disk shape of a preset material, `assets/materials/<name>.material.json`.
 *
 * The parameters are the same `MaterialDef` a mesh carries inline, which is
 * what makes extraction a move rather than a conversion: saving an embedded
 * material as an asset writes exactly what was already there.
 */
export interface MaterialAssetFile {
  version: number;
  material: MaterialDef;
}

/**
 * `assets/**\/*.meta.json`.
 *
 * 2 — a texture carries its `encoding`. The extension cannot answer it: an
 * Ultra HDR image is a `.jpg`, and only its gainmap metadata tells it from a
 * photograph. Sniffed from the bytes when the sidecar is written, so nothing
 * downstream has to read the file to find out what loader it needs.
 *
 * 3 — the import dialog's settings. A model says which `format` it is and
 * carries the trunk every model shares plus its format's own; a texture gains
 * `generateMipmaps` and `anisotropy`. Every new field fills from the format's
 * own factory, and the format itself fills from the extension, so a sidecar
 * written by version 2 upgrades without being asked anything.
 */
export const ASSET_META_VERSION = 3;
/** Sidecar written next to every asset: `tree.glb` -> `tree.glb.meta.json`. */
export const ASSET_META_SUFFIX = '.meta.json';

/**
 * How an image file stores light, which the extension can only half answer.
 *
 * `sdr` is an ordinary photograph or painted map. `hdr` is Radiance or OpenEXR,
 * which the extension does say. `ultrahdr` is the one that needs this field at
 * all: an Ultra HDR image **is a `.jpg`**, a base picture plus a gainmap, and
 * nothing but its metadata tells it from a holiday snap. Decided once, from the
 * bytes, when the sidecar is written — so no loader ever fetches a file twice
 * to find out what it is.
 *
 * It is the format worth having for a web build: a 2K sky is eight megabytes as
 * Radiance and about one as Ultra HDR, which for a game that has to download
 * before it starts is the difference between shipping the sky and not.
 */
export type TextureEncoding = 'sdr' | 'hdr' | 'ultrahdr';

export interface TextureSettings {
  kind: 'texture';
  /** Base-colour maps are sRGB; normal, roughness and metalness maps are not. */
  colorSpace: 'srgb' | 'linear';
  wrap: 'clamp' | 'repeat' | 'mirror';
  flipY: boolean;
  encoding: TextureEncoding;
  generateMipmaps: boolean;
  /**
   * Sharpness at grazing angles, in samples. 1 is off; ground and wall textures
   * are where it shows, and where its cost is worth paying.
   */
  anisotropy: number;
}

/**
 * What every model carries, whatever wrote it.
 *
 * `scale` is the field this whole dialog exists for: an FBX out of Unreal is in
 * centimetres, so an ordinary tree arrives 2746 units tall and swallows the
 * camera. Applied to the loaded root, not baked into the file — the bytes on
 * disk stay the author's.
 */
export interface ModelSettingsBase {
  kind: 'model';
  scale: number;
  /**
   * Which axis the file calls up.
   *
   * `z` rotates the root a quarter turn about X on load. Common, and not a
   * property of the format: glTF says Y-up in its spec and still arrives
   * rotated when it was converted from something that did not.
   */
  upAxis: 'y' | 'z';
  /** Builds a collider from the mesh when the model is placed. */
  generateColliders: boolean;
  /** Off drops the file's materials for three's default, which is faster to look at. */
  importMaterials: boolean;
  importAnimations: boolean;
}

export interface FbxModelSettings extends ModelSettingsBase {
  format: 'fbx';
  /**
   * What to do with `UCX_*` nodes.
   *
   * Unreal writes collision hulls into the FBX beside the geometry, under that
   * prefix by convention. Rendered, they are a box around the model; they are
   * also the empty normal layers that make three's FBXLoader throw, which is
   * what `patches/three+0.185.1.patch` is about.
   */
  collisionMeshes: 'ignore' | 'keep';
}

export interface GltfModelSettings extends ModelSettingsBase {
  format: 'gltf';
  /** A glTF scene can contain cameras and punctual lights; usually not wanted. */
  importCameras: boolean;
  importLights: boolean;
}

export interface ObjModelSettings extends ModelSettingsBase {
  format: 'obj';
  /** OBJ may declare no normals at all, and three shades those flat black. */
  computeNormals: boolean;
}

export type ModelSettings = FbxModelSettings | GltfModelSettings | ObjModelSettings;

export interface ScriptSettings {
  kind: 'script';
}

export interface PrefabSettings {
  kind: 'prefab';
}

export interface MaterialSettings {
  kind: 'material';
  /**
   * `preset` is a serialized `MaterialDef` — plain PBR parameters.
   * `tsl` is a module that builds a `NodeMaterial` from three's node graph, and
   * is what a future node editor will emit.
   */
  authoring: 'preset' | 'tsl';
}

export interface ShaderSettings {
  kind: 'shader';
  /**
   * A `render` shader feeds a material through TSL's `wgslFn`; a `compute`
   * shader is dispatched directly, which is how GPU culling, particles and
   * foliage scattering will work.
   */
  stage: 'render' | 'compute';
}

export interface AudioSettings {
  kind: 'audio';
  /**
   * Unity calls this "load type". A decoded `AudioBuffer` costs roughly ten
   * times the file size in RAM, so minutes-long music streams while short
   * effects are decoded once and reused.
   */
  loadMode: 'decode' | 'stream';
  /** Applied on top of each source's own volume. */
  gain: number;
  /** Collapses stereo to mono, which positional audio needs anyway. */
  forceMono: boolean;

  /*
   * What the file turned out to be, read once when it was decoded.
   *
   * Optional, and absent for two legitimate reasons: a file dropped into
   * `assets/` from outside the editor never passed through the import dialog,
   * and a file this browser cannot decode has no facts to report. The browser is
   * the only thing here that can read them — there is no `decodeAudioData` under
   * Node — so the main process cannot fill them in, and asking it to would mean
   * a header parser per format for three numbers of display. See ADR-6.
   */
  /** Length in seconds, at the file's own rate. */
  seconds?: number;
  channels?: number;
  sampleRate?: number;
}

export type AssetSettings =
  | TextureSettings
  | ModelSettings
  | ScriptSettings
  | MaterialSettings
  | PrefabSettings
  | ShaderSettings
  | AudioSettings;

/**
 * The `.meta.json` sidecar, and the source of truth for an asset's identity.
 *
 * Modelled on Unity's `.meta` files rather than a central manifest, which buys
 * three things a manifest cannot:
 *
 *   * Moving or renaming a file in Finder breaks nothing — the id travels with
 *     the file, and scenes only ever reference ids.
 *   * The sidecar is versioned alongside its asset in git, so importing on two
 *     branches does not conflict in one shared file.
 *   * Dropping files straight into `assets/` outside the editor works: the
 *     scan adopts them and writes their sidecar.
 */
export interface AssetMeta {
  version: number;
  id: string;
  kind: AssetKind;
  importedAt: number;
  /** SHA-256 of the file at import, for duplicate detection. */
  hash: string;
  settings: AssetSettings;
}

/** An asset as the editor sees it: its sidecar plus facts about the file. */
export interface AssetEntry {
  id: string;
  /** File name without extension. */
  name: string;
  kind: AssetKind;
  /** Path relative to the project root, always with forward slashes. */
  path: string;
  /** Containing directory relative to `assets/`; `''` at the top level. */
  folder: string;
  sizeBytes: number;
  modifiedAt: number;
  importedAt: number;
  hash: string;
  settings: AssetSettings;
}

/**
 * A rebuilt view of the asset tree. Derived from the sidecars by scanning, so
 * it is a cache — never the authority, and safe to delete.
 */
export interface AssetManifest {
  version: number;
  assets: AssetEntry[];
  /** Every folder under `assets/`, relative to it, for the folder tree. */
  folders: string[];
}

export const ASSET_MANIFEST_VERSION = 1;

/**
 * Outcome of an import.
 *
 * `duplicates` and `unsupported` are all but empty now that a session answers
 * both before anything is written: the dialog shows an identical file as a
 * conflict on its row and an unimportable one as a row that cannot be ticked,
 * so by the time a commit runs the author has already decided. They stay
 * because a commit can still be handed a plan naming a file its session never
 * staged — a dialog left open across a project change — and saying so is better
 * than importing nothing without a word.
 */
export interface AssetImportResult {
  imported: AssetEntry[];
  /** An identical file is already in the project. */
  duplicates: { fileName: string; existingPath: string }[];
  /** No importer claims that extension. */
  unsupported: string[];
}

/** True for material assets authored as a TSL module rather than a preset. */
export function isTslMaterial(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.material.ts') || lower.endsWith('.material.js');
}

/**
 * What an `<img>` can decode, which is not the same as what we can import.
 *
 * Radiance, OpenEXR and KTX2 are texture assets like any other and go through
 * their own loaders at render time. No browser decodes them, so a preview built
 * for one is not a wrong image but a broken one — and a broken tile reads as a
 * failed import rather than as a file the editor simply cannot draw small.
 *
 * An allow list rather than a deny list: a format added to `ASSET_KIND_INFO`
 * because some loader handles it is not thereby something an `<img>` handles,
 * and the failure of guessing the other way round is silent.
 */
const PREVIEWABLE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'];

export function hasImagePreview(asset: { kind: AssetKind; path: string }): boolean {
  if (asset.kind !== 'texture') return false;
  const extension = asset.path.toLowerCase().split('.').pop();
  return extension !== undefined && PREVIEWABLE_EXTENSIONS.includes(extension);
}

export function emptyManifest(): AssetManifest {
  return { version: ASSET_MANIFEST_VERSION, assets: [], folders: [] };
}
