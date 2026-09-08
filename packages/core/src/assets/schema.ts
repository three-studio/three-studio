import type { PrefabDoc } from '../scene/prefab';
import { ASSETS_DIR, type RenderingSettings } from '../project/schema';
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
 *
 * 4 — `build.json` carries the asset table, the materials and the prefabs that
 * were `assets.json`, `materials.json` and `prefabs.json` beside it. Six
 * requests before the first frame become three, and the three that go were
 * small, always needed, and always fetched. The files are no longer written;
 * the player falls back to them when the fields are absent, which is what makes
 * this additive from its side too.
 *
 * 5 — every scene is `scenes/<sceneId>.json`, and `scenes` lists ids rather
 * than files. **The first that is not additive**, and the one that shows why
 * the number is the mechanism and a per-field default is not: a moved file has
 * nothing to fall back to and nothing left where it was. The entry scene used
 * to be renamed to `scene.json` at the root while the rest went into `scenes/`,
 * and that asymmetry is what `sceneMap` — keyed by name *and* by id — existed
 * to undo.
 */
export const BUILD_FORMAT_VERSION = 5;

/**
 * Where a scene lives in a build, from its id alone.
 *
 * Derived on both sides rather than listed anywhere: the exporter writes here
 * and the player fetches here, and a path written twice is a path that can
 * disagree with itself. That is the whole of what replaced `sceneMap`.
 *
 * The id is normally `createId()`'s alphabet and needs no escaping, but a scene
 * file that carries no id of its own falls back to **its project path** — see
 * `discoverScenes` — so the result can contain slashes and spaces. The exporter
 * makes the directories and the player encodes the URL; neither assumes a flat
 * name.
 */
export function buildScenePath(sceneId: string): string {
  return `scenes/${sceneId}.json`;
}

/**
 * `build.json` — everything the player needs before the first frame except the
 * entry scene and the compiled scripts.
 *
 * Declared here rather than at either end, for the reason `ScriptBuildResult`
 * is declared in `bridge.ts`: it crosses a boundary neither side can import
 * across. The exporter writes it from the main process and the player reads it
 * in a browser, and it used to be stated three times — written from an
 * unannotated literal, read back through an interface kept by hand, and
 * restated in part a third time for the entry scene. That is exactly how the
 * script build result lost a field on one side.
 *
 * **An optional field is one an older build may not have**, never one the
 * exporter may skip. Each says which format added it, and the player says what
 * it does without it.
 */
export interface BuildManifest {
  /** Absent on a build written before builds were versioned. */
  formatVersion?: number;
  title: string;
  /**
   * Kept for a build written before `rendering` existed, and only for that.
   * Everything reads `rendering` now — see the fallback where it is read.
   */
  forceWebGL: boolean;
  /**
   * The project's rendering settings, whole.
   *
   * Absent on a build written before this field, and then filled from the
   * factory with `forceWebGL` taken from the field above — which is exactly
   * what those builds were exported against, since it was the only one of the
   * six the player ever read. The other five were thrown away: a project
   * asking for 4096 shadow maps, no antialiasing or a different exposure got
   * the defaults, and it went unnoticed because the defaults happened to agree.
   */
  rendering?: RenderingSettings;
  /**
   * Every scene in the build **by id**, entry point first; the rest ship for a
   * script to load later.
   *
   * Files, until format 5. What the id buys is that the path is `buildScenePath`
   * of it rather than something to look up — the end
   * of the chain: a reference is an id, never a name and never a path.
   */
  scenes: string[];
  /**
   * Scene name → id. An alias table, and deliberately not a second address.
   *
   * A script may name a level rather than hold its id, and a name is what an
   * author reads in the editor. Nothing is *found* by name: this resolves to an
   * id first, and the id is what says where the file is. Absent on a build
   * written before format 5.
   */
  sceneNames?: Record<string, string>;
  /**
   * Id of the scene shown while another loads, if the project has one.
   *
   * The id the project settings already hold, passed through. It was resolved
   * back into a name until format 5, on the grounds that the manifest should be
   * legible — which is a reason to print a build, not to address one.
   */
  loadingScene?: string | null;
  /**
   * Asset id → path under `assets/`, so nothing in a scene is a file name.
   *
   * Format 4. Before it this was `assets.json` beside the player.
   */
  assets?: Record<string, string>;
  /**
   * The shared materials a shipped scene links to, by asset id.
   *
   * Format 4; `materials.json` before it. Only the ones something references —
   * an unused material asset is no more part of a build than an unused texture.
   */
  materials?: Record<string, MaterialDef>;
  /**
   * The prefabs a shipped scene instances, by asset id, expanded before the
   * engine sees the scene.
   *
   * Format 4; `prefabs.json` before it.
   */
  prefabs?: Record<string, PrefabDoc>;
  /**
   * Images whose file name does not say how they store light.
   *
   * Ultra HDR and nothing else today: it is a `.jpg`, and without this the
   * player decodes it as an ordinary photograph — perfectly, and with every
   * stop above white gone. Absent on a build that had none, and on one written
   * before this field existed.
   */
  textureEncodings?: Record<string, TextureEncoding>;
  /**
   * What each asset was imported with.
   *
   * Absent on a build written before this field existed, and then every asset
   * falls back to its format's defaults — which is what those builds were
   * exported against anyway.
   */
  assetSettings?: Record<string, AssetSettings>;
  /**
   * The compiled behaviour bundle, or `null` when the project has none.
   *
   * Named here rather than probed for. A static server that answers 404s with
   * its index page — which many do — returns 200 and HTML for a file that is
   * not there, so asking the server whether the bundle exists is not a question
   * that can be answered reliably.
   */
  scripts: string | null;
}

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
  /**
   * The longest side this texture is allowed to reach, in pixels.
   *
   * Unity's "Max Size", and it exists for the same reason: a source image is
   * whatever the author was given, and an 8192-square photograph is 268 MB of
   * RGBA on the GPU for a prop nobody walks up to. The import writes a scaled
   * copy beside the source and everything loads that; the source is never
   * touched, so raising this and re-importing gets the detail back.
   *
   * A number rather than a dropdown of powers of two, which is what it wants to
   * be: `FieldOption` is string-valued, and giving the shared field vocabulary
   * numeric options for one setting is a bigger change than this is worth.
   */
  maxSize: number;
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
  /**
   * The longest side an image **inside this file** may reach, in pixels.
   *
   * Separate from `TextureSettings.maxSize` because an embedded image is not an
   * asset: it has no sidecar, no id and no row in the project, so there is
   * nowhere else to say it. A glTF carrying two 8192-square JPEGs is 166 MB of
   * download for a scene that will never resolve them.
   */
  maxTextureSize: number;
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
   * a header parser per format for three numbers of display.
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
 * What one mutation did to the asset tree, so the manifest can follow without
 * being rebuilt.
 *
 * The manifest used to be re-derived by a full scan after every mutation — from
 * fourteen call sites — and that cost 196 ms on a project of three thousand
 * assets: 130 ms of walking and stat-ing, plus a 1.2 MB manifest crossing the
 * process boundary. For a rename that touched one file.
 *
 * **The main process is the only side that can describe the change**, which is
 * why it says it rather than the renderer working it out. Deleting a model takes
 * the companion files named *inside* it; moving one carries them along and then
 * prunes whatever folders it emptied. A renderer that tried to predict either
 * would be a second copy of rules that live on disk.
 *
 * Asset paths are relative to the project root, folders to `assets/` — the same
 * two frames `AssetEntry.path` and `AssetEntry.folder` use, so applying a change
 * is a substitution and never a recomputation.
 */
export interface AssetChange {
  /** Files that moved and kept their identity: the sidecar travels with them. */
  moved: readonly { from: string; to: string }[];
  /** Files that are gone, companions included. */
  removed: readonly string[];
  addedFolders: readonly string[];
  removedFolders: readonly string[];
}

export function emptyAssetChange(): AssetChange {
  return { moved: [], removed: [], addedFolders: [], removedFolders: [] };
}

/**
 * The manifest as it stands after a change, without touching the disk.
 *
 * Order is preserved — the scan returns assets in walk order and the panel sorts
 * for itself, so a moved entry stays where it was rather than jumping to the end
 * of the list under the reader's cursor.
 *
 * A `from` naming an asset the manifest does not hold is ignored rather than
 * inserted: the manifest is a cache of the disk, and inventing an entry out of a
 * path would be inventing an id, a hash and a size with it.
 */
export function applyAssetChange(manifest: AssetManifest, change: AssetChange): AssetManifest {
  const gone = new Set(change.removed);
  const destination = new Map(change.moved.map((move) => [move.from, move.to]));

  const assets = manifest.assets
    .filter((asset) => !gone.has(asset.path))
    .map((asset) => {
      const to = destination.get(asset.path);
      if (to === undefined) return asset;
      return { ...asset, path: to, folder: folderOf(to) };
    });

  const removedFolders = new Set(change.removedFolders);
  const folders = [
    ...manifest.folders.filter((folder) => !removedFolders.has(folder)),
    ...change.addedFolders.filter((folder) => !manifest.folders.includes(folder)),
  ].sort();

  return { ...manifest, assets, folders };
}

/** The `folder` an asset at this project-relative path belongs to. */
function folderOf(path: string): string {
  const inside = path.startsWith(`${ASSETS_DIR}/`) ? path.slice(ASSETS_DIR.length + 1) : path;
  const cut = inside.lastIndexOf('/');
  return cut === -1 ? '' : inside.slice(0, cut);
}

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
 *
 * It listed `gif` and `avif` too, and both were unreachable: nothing imports
 * either, so no asset ever has that extension *and* the `texture` kind this
 * checks first. An allow list may be smaller than what the browser can decode;
 * it may not name things the project cannot contain, or it stops saying which
 * of the two it is.
 */
const PREVIEWABLE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp'];

export function hasImagePreview(asset: { kind: AssetKind; path: string }): boolean {
  if (asset.kind !== 'texture') return false;
  const extension = asset.path.toLowerCase().split('.').pop();
  return extension !== undefined && PREVIEWABLE_EXTENSIONS.includes(extension);
}

export function emptyManifest(): AssetManifest {
  return { version: ASSET_MANIFEST_VERSION, assets: [], folders: [] };
}
