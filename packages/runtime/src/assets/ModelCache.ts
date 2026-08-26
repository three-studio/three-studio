import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import {
  LoadingManager,
  TextureLoader,
  type AnimationClip,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import type { AssetSettings, TextureEncoding } from '@three-studio/core';
import type { AssetResolver } from './AssetResolver';
import { applyModelSettings, applyTextureSettings } from './importSettings';
import { MODEL_EXTENSIONS, extensionOf, loadModelFromUrl } from './loadModel';
import { describeNodes, resolveNode, type ModelShape } from './modelNodes';

/** Read from the URL, because that is all the cache is given about an asset. */
const TEXTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'hdr', 'exr', 'ktx2']);
/** Formats whose extension already says they store light rather than pixels. */
const HDR_EXTENSIONS = new Set(['hdr', 'exr']);

/** A loaded master and whether its pixels have actually arrived. */
interface TextureEntry {
  master: Texture;
  ready: boolean;
}

/**
 * Copies onto a clone what the loader only learned by parsing the file.
 *
 * `DataTextureLoader` — which `HDRLoader` and `EXRLoader` are both built on —
 * returns a `DataTexture` **before** it has read a byte, and stamps the real
 * format on it afterwards in `_applyTexData`. A clone taken in between is
 * therefore a correct image described by the placeholder's defaults: 8-bit
 * unsigned, nearest-filtered, no mipmaps. Half-float data read as bytes is not
 * a subtle error — it is confetti, and it is what a Radiance sky looked like.
 *
 * Only what describes the pixels. Colour space, mapping and the UV transform
 * are the caller's: the binder sets a sky's mapping and reads its colour space
 * from the asset's encoding, and a material sets tiling per slot. Copying those
 * would undo both.
 */
function adoptDecodedParameters(clone: Texture, master: Texture): void {
  clone.type = master.type;
  clone.format = master.format;
  clone.internalFormat = master.internalFormat;
  clone.minFilter = master.minFilter;
  clone.magFilter = master.magFilter;
  clone.anisotropy = master.anisotropy;
  clone.generateMipmaps = master.generateMipmaps;
  clone.mipmaps = master.mipmaps;
  clone.flipY = master.flipY;
  clone.unpackAlignment = master.unpackAlignment;
}

/**
 * Loads and shares model files and textures.
 *
 * Caching by asset id matters as soon as a scene places the same prop more than
 * once: without it, a hundred trees means a hundred downloads and a hundred
 * copies of the same geometry on the GPU.
 *
 * DRACO and KTX2 are not wired up: their decoders are binaries that have to be
 * served next to the app *and* next to an exported build, which is a build
 * pipeline question rather than a loading one. Meshopt is, because it is a
 * plain module that bundles — and it is what glTF-Transform emits by default,
 * so it covers a good share of what people actually have.
 */
export class ModelCache {
  /**
   * One manager behind every loader.
   *
   * Loaders share their cache and their in-flight requests through it, so a
   * `.gltf` and the textures it pulls in are one pipeline rather than three —
   * and a progress indicator later is a listener here, not a change everywhere.
   */
  private readonly manager = new LoadingManager();
  private readonly textureLoader = new TextureLoader(this.manager);
  private readonly models = new Map<string, Promise<Object3D>>();
  /** One master per image; never rendered, only cloned from. */
  private readonly textures = new Map<string, TextureEntry>();
  /** Clones handed out before their image finished decoding. */
  private readonly awaitingImage = new Map<string, Texture[]>();
  /** Resolves when a texture's pixels have landed, so `preload` can wait. */
  private readonly textureSettled = new Map<string, Promise<void>>();

  constructor(private resolver: AssetResolver) {}

  setResolver(resolver: AssetResolver): void {
    this.resolver = resolver;
    void this.clear();
  }

  /**
   * Resolves to a fresh clone, because two entities pointing at the same model
   * must be independently transformable. Geometry and materials stay shared.
   */
  async loadModel(assetId: string): Promise<Object3D> {
    return (await this.master(assetId)).clone(true);
  }

  /**
   * One node of a model, cloned **without its descendants**.
   *
   * What an unpacked model is built out of: each node became an entity of its
   * own, and each of those entities draws its own node. Cloning the subtree here
   * would draw every child twice — once under its parent's clone and once under
   * its own.
   *
   * And a clone rather than a `loadModel().getObjectByName()`, which is the
   * cost that decided the shape of this method: `loadModel` copies the whole
   * tree, so a two-hundred-node model unpacked would deep-clone the entire file
   * two hundred times to keep one node from each.
   *
   * The local transform is reset. It has been lifted onto the entity that
   * replaces the node — that is what makes the piece movable — and leaving it
   * here as well would place it twice as far along.
   *
   * @returns `null` for a node neither the path nor the name finds; see
   *   `resolveNode`.
   */
  async loadNode(assetId: string, path: string, name = ''): Promise<Object3D | null> {
    const node = resolveNode(await this.master(assetId), path, name);
    if (node === null) return null;

    const clone = node.clone(false);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    return clone;
  }

  /**
   * The shape of a model file, as plain data.
   *
   * The master never leaves this class — a caller holding it could edit the
   * object every clone in the project shares. `describeNodes` reads it and hands
   * back a description instead.
   */
  async modelShape(assetId: string): Promise<ModelShape> {
    return describeNodes(await this.master(assetId));
  }

  /**
   * The loaded file itself, shared and never handed out.
   *
   * The import settings are applied here, before it is cached: they describe the
   * file, and doing it per clone would repeat the work once per placement of the
   * same prop.
   */
  private async master(assetId: string): Promise<Object3D> {
    const cached = this.models.get(assetId);
    if (cached) return cached;

    const url = this.resolver.url(assetId);
    if (url === null) throw new Error(`Unknown model asset: ${assetId}`);

    const pending = loadModelFromUrl(url, this.manager).then((loaded) =>
      this.dressModel(assetId, loaded.object, loaded.animations),
    );
    this.models.set(assetId, pending);

    try {
      return await pending;
    } catch (error) {
      // A failed load must not poison the cache; a re-import should retry.
      this.models.delete(assetId);
      throw error;
    }
  }

  /**
   * A texture the caller owns and configures freely, backed by a shared image.
   *
   * Colour space and the UV transform live on the `Texture`, not on the
   * material, so two materials tiling the same image differently need two
   * `Texture` objects — but only one decode. `clone` shares `source`, which is
   * exactly that split. The caller disposes what it gets back; the master
   * belongs to this cache.
   *
   * Cloning has one trap, which is why it lives here rather than at the call
   * site: `TextureLoader.load` returns before the image exists and flags only
   * the texture it created. A clone taken before then would never be told the
   * image arrived, and would render blank forever.
   */
  instanceTexture(assetId: string): Texture | null {
    const url = this.resolver.url(assetId);
    if (url === null) return null;

    let entry = this.textures.get(assetId);
    if (!entry) {
      const created: TextureEntry = { master: undefined as unknown as Texture, ready: false };
      // The promise is made here rather than in `preload`, so the two share one
      // load however they are reached — a texture the binder asked for first
      // must not be fetched a second time by a loading bar.
      let settle = () => {};
      this.textureSettled.set(
        assetId,
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
      );
      created.master = this.textureLoaderFor(url, this.encodingOf(assetId)).load(
        url,
        () => {
          created.ready = true;
          const settings = this.settingsOf(assetId);
          for (const clone of this.awaitingImage.get(assetId) ?? []) {
            adoptDecodedParameters(clone, created.master);
            // After adoption, not before: `adoptDecodedParameters` copies the
            // decoded filtering and mipmaps off the master, which would
            // otherwise undo exactly the fields the author set at import.
            if (settings?.kind === 'texture') applyTextureSettings(clone, settings);
            clone.needsUpdate = true;
          }
          this.awaitingImage.delete(assetId);
          settle();
        },
        undefined,
        settle,
      );
      this.textures.set(assetId, created);
      entry = created;
    }

    const clone = entry.master.clone();
    const settings = this.settingsOf(assetId);
    if (settings?.kind === 'texture') applyTextureSettings(clone, settings);
    if (!entry.ready) {
      // `Texture.copy` ends with `needsUpdate = true`, so a clone taken before
      // the image lands is queued for upload with nothing to upload. Standing
      // the flag back down is what avoids that; the master's onLoad raises it
      // again when there is something to send.
      //
      // Tracked as a flag rather than read off the texture, because what an
      // unloaded one looks like depends on the loader: `TextureLoader` leaves
      // `image` null, and `HDRLoader` leaves a 1×1 `{ data: null }` that reads
      // as loaded. That mismatch was a WebGPU upload of a texture with no data.
      clone.version = 0;
      const waiting = this.awaitingImage.get(assetId);
      if (waiting) waiting.push(clone);
      else this.awaitingImage.set(assetId, [clone]);
    }
    return clone;
  }

  /**
   * What the author chose for an asset when they imported it.
   *
   * `null` from a resolver that has no sidecars to read, and every consumer
   * falls back to the format's own defaults rather than to nothing.
   */
  private settingsOf(assetId: string): AssetSettings | null {
    return this.resolver.settings?.(assetId) ?? null;
  }

  /** Applies a model's import settings, or leaves it as the file had it. */
  private dressModel(
    assetId: string,
    loaded: Object3D,
    animations: readonly AnimationClip[],
  ): Object3D {
    const settings = this.settingsOf(assetId);
    return settings?.kind === 'model'
      ? applyModelSettings(loaded, settings, animations)
      : loaded;
  }

  /**
   * How an asset stores light.
   *
   * From the resolver when it knows — an Ultra HDR file is a `.jpg` and only
   * its metadata says otherwise, which is settled at import — and from the
   * extension when it does not, which covers every other format.
   */
  private encodingOf(assetId: string): TextureEncoding {
    const declared = this.resolver.encoding?.(assetId) ?? null;
    if (declared !== null) return declared;

    const url = this.resolver.url(assetId);
    if (url === null) return 'sdr';
    return HDR_EXTENSIONS.has(extensionOf(url)) ? 'hdr' : 'sdr';
  }

  /**
   * True when the file holds linear light rather than sRGB pixels.
   *
   * Read from the encoding rather than from the texture, because a clone taken
   * before the image lands still carries `DataTexture`'s defaults — the loader
   * only stamps the real type and colour space once it has parsed the file, and
   * the binder needs the answer at build time. Getting it wrong on a background
   * is a sky that is visibly too dark or too bright, in either direction.
   */
  isLinearTexture(assetId: string): boolean {
    return this.encodingOf(assetId) !== 'sdr';
  }

  /**
   * Whether an asset's pixels have actually landed.
   *
   * `instanceTexture` hands back a usable object before the image exists, which
   * is right almost everywhere — a mesh is untextured for a frame and nobody
   * sees it. The sky is the exception: an image that is not there yet is not a
   * missing detail, it is the whole frame dropping to the clear colour for as
   * long as a ten-megabyte Radiance file takes to parse. Callers that would
   * rather keep showing the old one ask this first.
   */
  textureReady(assetId: string): boolean {
    return this.textures.get(assetId)?.ready === true;
  }

  /**
   * Resolves when `textureReady` would start answering true.
   *
   * Resolves immediately for an asset nothing has asked for yet: this reports
   * on a load, it does not start one. Call `instanceTexture` first.
   */
  async whenTextureReady(assetId: string): Promise<void> {
    if (this.textureReady(assetId)) return;
    await this.textureSettled.get(assetId);
  }

  /**
   * Fetches an asset now, so nothing has to wait for it later.
   *
   * What a loading bar counts. Resolves whether the file arrived or not: a
   * scene with one broken texture still has to open, and the failure belongs in
   * the console rather than in a bar that never fills.
   */
  async preload(assetId: string): Promise<void> {
    const url = this.resolver.url(assetId);
    if (url === null) return;

    const extension = extensionOf(url);

    try {
      if (MODEL_EXTENSIONS.has(extension)) {
        await this.loadModel(assetId);
        return;
      }
      if (TEXTURE_EXTENSIONS.has(extension)) {
        // Goes through `instanceTexture` so the master and its waiting-clone
        // bookkeeping are the ones the binder will find; the clone is thrown
        // away, and it shares the image so that costs nothing.
        this.instanceTexture(assetId)?.dispose();
        await this.textureSettled.get(assetId);
      }
    } catch (cause) {
      console.warn(`[assets] could not preload ${assetId}`, cause);
    }
  }

  /**
   * The loader for an image format the browser cannot decode on its own.
   *
   * `TextureLoader` goes through an `<img>` element, which handles PNG, JPEG
   * and WebP and nothing else. Radiance and OpenEXR files went through it too
   * and came back as a texture with no image — no error anywhere, just a
   * surface that never appears. All three are plain modules, so this costs
   * nothing.
   *
   * Ultra HDR is the one chosen by `encoding` rather than by extension, because
   * it *is* a JPEG: sent through `TextureLoader` it decodes perfectly well and
   * quietly loses every stop of range above white, which looks like a sky that
   * casts no light rather than like a mistake.
   */
  private textureLoaderFor(
    url: string,
    encoding: TextureEncoding,
  ): {
    load: (
      url: string,
      onLoad: () => void,
      onProgress?: undefined,
      onError?: () => void,
    ) => Texture;
  } {
    const extension = extensionOf(url);

    if (encoding === 'ultrahdr') return new UltraHDRLoader(this.manager);
    if (extension === 'hdr') return new HDRLoader(this.manager);
    if (extension === 'exr') return new EXRLoader(this.manager);
    if (extension === 'ktx2') {
      // Basis has to be transcoded by a WASM binary that is not in the bundle,
      // and half-supporting a format is worse than saying so: the texture would
      // simply never appear.
      console.warn(
        `[assets] ${url} is a KTX2 texture, which needs the Basis transcoder. Import a PNG or a JPEG instead.`,
      );
    }
    return this.textureLoader;
  }

  /**
   * Frees everything the cache is holding.
   *
   * The loaded models matter as much as the textures, and were being dropped
   * rather than freed: `models` maps to a `Promise<Object3D>`, and clearing the
   * map only lets the JavaScript object go. The geometries and materials inside
   * it live on the GPU and outlive garbage collection entirely — which is a
   * whole level's worth of buffers per project change.
   *
   * The masters are the originals; `loadModel` hands out `clone(true)`, which
   * shares both. Disposing here therefore frees what every clone was using, and
   * is only safe because `clear()` means the cache and its clones are done.
   */
  async clear(): Promise<void> {
    for (const entry of this.textures.values()) entry.master.dispose();
    this.textures.clear();
    this.awaitingImage.clear();
    this.textureSettled.clear();

    const loaded = [...this.models.values()];
    this.models.clear();
    for (const pending of loaded) {
      // A load that failed has nothing to free, and its rejection was already
      // reported at the call site.
      const model = await pending.catch(() => null);
      model?.traverse((child) => {
        const mesh = child as { geometry?: { dispose(): void }; material?: unknown };
        mesh.geometry?.dispose();
        for (const material of materialsOf(mesh.material)) material.dispose();
      });
    }
  }
}

/** A mesh's material, or every one of them when it carries an array. */
function materialsOf(material: unknown): { dispose(): void }[] {
  if (Array.isArray(material)) return material as { dispose(): void }[];
  if (material && typeof (material as { dispose?: unknown }).dispose === 'function') {
    return [material as { dispose(): void }];
  }
  return [];
}
