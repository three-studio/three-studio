import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import {
  DataTexture,
  LoadingManager,
  TextureLoader,
  type AnimationClip,
  type Object3D,
  type Source,
  type Texture,
} from 'three/webgpu';
import {
  assetKindInfo,
  type AssetId,
  type AssetSettings,
  type CoreRegistries,
  type Disposable,
  type TextureEncoding,
} from '@three-studio/core';
import type { AssetResolver } from './AssetResolver';
import { applyModelSettings, applyTextureSettings } from './importSettings';
import { disposeModel, extensionOf, loadModelFromUrl, modelResources } from './loadModel';
import { describeNodes, resolveNode, type ModelShape } from './modelNodes';

/** Formats whose extension already says they store light rather than pixels. */
const HDR_EXTENSIONS: ReadonlySet<string> = new Set(['hdr', 'exr']);

/** A placement of a model, and what keeps the file loaded while it is drawn. */
export interface ModelHold extends Disposable {
  /**
   * The whole file or one node of it, cloned for this placement alone: its
   * geometry, materials and images are the master's, shared by every hold.
   * `null` for a node the file does not have.
   */
  readonly object: Promise<Object3D | null>;
}

/** A texture of an image, and what keeps the image decoded while it is drawn. */
export interface TextureHold extends Disposable {
  /**
   * The holder's own clone, configured as it likes — colour space and the UV
   * transform live on the `Texture`, so two materials tiling one image
   * differently need two — over the one decoded image. Disposing the hold
   * disposes it, then gives the image back.
   */
  readonly texture: Texture;
}

/** A file held ahead of whoever will draw it. */
export interface PreloadHold extends Disposable {
  /** Settles once the file has arrived or failed: what a loading bar counts. */
  readonly ready: Promise<void>;
}

/** A model file as the cache keeps it. */
interface ModelEntry {
  readonly kind: 'model';
  readonly id: AssetId;
  holds: number;
  /** About what freeing it gives back, counted once it lands. */
  bytes: number;
  landed: boolean;
  /** The file, dressed by its import settings: never drawn, only cloned. */
  readonly master: Promise<Object3D>;
  /** The same once it has landed, which is what eviction frees. */
  object: Object3D | null;
}

/** An image as the cache keeps it. */
interface ImageEntry {
  readonly kind: 'image';
  readonly id: AssetId;
  holds: number;
  bytes: number;
  /** Whether the pixels have arrived: what `textureReady` answers. */
  landed: boolean;
  /** Made by the loader before a byte has arrived. Never drawn, only cloned. */
  readonly master: Texture;
  /** Settles when the image has landed or failed. */
  readonly settled: Promise<void>;
  /** Clones handed out before the image landed, told when it does. */
  readonly waiting: Set<Texture>;
}

type Entry = ModelEntry | ImageEntry;

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
 * The project's loaded models and images, shared by every world that draws
 * the project, and freed once nothing holds them.
 *
 * **A holder takes a hold and gives it back; it never frees.** A model's
 * geometry and images, and an image's pixels, are shared by every placement in
 * every world — the edit view and Play alike — so no single holder can know
 * that it was the last. Each scene once kept a cache of its own and freed it
 * wholesale with the scene: Play parsed a second copy of every model the edit
 * view already held, an editing session kept every model it had ever loaded,
 * and nothing freed a model's textures at all.
 *
 * **What nothing holds stays while it fits the idle budget**, oldest out first:
 * an undo of a delete, or a second Play, then finds the model where it was.
 * Every entry costs at least a byte, so a budget of 0 keeps nothing.
 *
 * **What is evicted is freed at the next `beginFrame`**, never at the release:
 * the frame in flight may still be drawing it, and freeing a buffer a pass is
 * encoding is a crash, not a dropped frame. The window's loop begins the frame,
 * once — never an engine or a binder, two of which may share one window, and a
 * second flush in one frame would free what its first half had just let go of.
 *
 * DRACO and KTX2 are not wired up: their decoders are binaries that have to be
 * served next to the app *and* next to an exported build, which is a build
 * pipeline question rather than a loading one. Meshopt is, because it is a
 * plain module that bundles — and it is what glTF-Transform emits by default,
 * so it covers a good share of what people actually have.
 */
export class AssetCache {
  /** The project's one way to its files; the audio engine reads it too. */
  readonly resolver: AssetResolver;
  /**
   * One manager behind every loader.
   *
   * Loaders share their cache and their in-flight requests through it, so a
   * `.gltf` and the textures it pulls in are one pipeline rather than three —
   * and a progress indicator later is a listener here, not a change everywhere.
   */
  private readonly manager = new LoadingManager();
  private readonly textureLoader = new TextureLoader(this.manager);
  private readonly models = new Map<AssetId, ModelEntry>();
  private readonly images = new Map<AssetId, ImageEntry>();
  /**
   * Landed entries nothing holds, in the order they were let go: the first is
   * the oldest, and a hold takes an entry back out. No sort, ever.
   */
  private readonly idle = new Set<Entry>();
  private idleBytes = 0;
  private idleBudgetBytes: number;
  /** Evicted, and waiting for the frame that may still draw them to pass. */
  private readonly evicted: Entry[] = [];
  private disposed = false;
  /**
   * What `preload` opens as a model, and what as an image. Read from the URL,
   * because that is all the cache is given about an asset.
   *
   * The importers' lists rather than lists of its own: a model importer exists
   * because `loadModelFromUrl` can open the format, and the importers are what
   * say a file is a texture, so writing either out again here was a second
   * list that could only ever disagree with them.
   */
  private readonly modelExtensions: ReadonlySet<string>;
  private readonly textureExtensions: ReadonlySet<string>;

  constructor(
    registries: CoreRegistries,
    options: { readonly resolver: AssetResolver; readonly idleBudgetBytes: number },
  ) {
    this.resolver = options.resolver;
    this.idleBudgetBytes = options.idleBudgetBytes;
    const kinds = assetKindInfo(registries);
    this.modelExtensions = new Set(kinds.get('model')?.extensions);
    this.textureExtensions = new Set(kinds.get('texture')?.extensions);
  }

  /**
   * Whether this asset can be loaded at all.
   *
   * `AssetResolver.url` already documents its `null` as "a scene referencing a
   * deleted file", which is an ordinary state and not a failure — so it is worth
   * asking before loading rather than finding out by catching. `ModelSystem`
   * asks, and draws a placeholder instead of nothing.
   */
  knows(assetId: AssetId): boolean {
    return this.resolver.url(assetId) !== null;
  }

  /**
   * A placement of a model: the whole file, or one node of it.
   *
   * Taken at once, before anything is awaited, so a model still loading is
   * held: a holder unmounted mid-load gives back what it took, and a remount
   * finds the load already under way.
   *
   * A node is cloned **without its descendants**. Each node of an unpacked
   * model is an entity of its own drawing its own node, so cloning the subtree
   * would draw every child twice. Its local transform is reset too: it was
   * lifted onto the entity that replaces the node, and leaving it here as well
   * would place the piece twice as far along. And a clone of the one node
   * rather than of the whole file: a two-hundred-node model unpacked would
   * otherwise deep-clone itself two hundred times to keep one node of each.
   */
  holdModel(assetId: AssetId, node: { readonly path: string; readonly name: string } | null): ModelHold {
    const entry = this.modelEntry(assetId);
    const release = this.take(entry);
    return {
      object: entry.master.then((master) => (node === null ? master.clone(true) : nodeOf(master, node))),
      dispose: release,
    };
  }

  /**
   * A texture of an image, configured and owned by the holder.
   *
   * Cloning has one trap, which is why it lives here rather than at the call
   * site: the loader returns before the image exists and flags only the texture
   * it created. A clone taken before then would never be told the image
   * arrived, and would render blank forever.
   *
   * @returns `null` when the project does not know the asset.
   */
  holdTexture(assetId: AssetId): TextureHold | null {
    const entry = this.imageEntry(assetId);
    if (entry === null) return null;
    const release = this.take(entry);

    const texture = entry.master.clone();
    const settings = this.settingsOf(assetId);
    if (settings?.kind === 'texture') applyTextureSettings(texture, settings);
    if (!entry.landed) {
      // `Texture.copy` ends with `needsUpdate = true`, so a clone taken before
      // the image lands is queued for upload with nothing to upload. Standing
      // the flag back down is what avoids that; the landing raises it again
      // when there is something to send.
      //
      // Tracked by the entry rather than read off the texture, because what an
      // unloaded one looks like depends on the loader: `TextureLoader` leaves
      // `image` null, and `HDRLoader` leaves a 1×1 `{ data: null }` that reads
      // as loaded. That mismatch was a WebGPU upload of a texture with no data.
      texture.version = 0;
      entry.waiting.add(texture);
    }

    let held = true;
    return {
      texture,
      dispose: () => {
        if (!held) return;
        held = false;
        // Out of the waiting list first: a clone already disposed must never be
        // flagged for upload when the image lands after.
        entry.waiting.delete(texture);
        texture.dispose();
        release();
      },
    };
  }

  /**
   * Holds an asset ahead of whoever will draw it: what a loading bar counts.
   *
   * `ready` settles whether the file arrived or not — a scene with one broken
   * texture still has to open, and the failure belongs in the console rather
   * than in a bar that never fills. A kind the cache does not load (a sound, a
   * script) is held by nothing and ready at once. How long the hold lasts is
   * the caller's to decide.
   */
  preload(assetId: AssetId): PreloadHold {
    const url = this.resolver.url(assetId);
    const extension = url === null ? '' : extensionOf(url);

    if (this.modelExtensions.has(extension)) {
      const entry = this.modelEntry(assetId);
      return {
        ready: entry.master.then(
          () => undefined,
          (cause: unknown) => {
            console.warn(`[assets] could not preload ${assetId}`, cause);
          },
        ),
        dispose: this.take(entry),
      };
    }

    const image = this.textureExtensions.has(extension) ? this.imageEntry(assetId) : null;
    if (image !== null) return { ready: image.settled, dispose: this.take(image) };
    return { ready: Promise.resolve(), dispose: () => {} };
  }

  /**
   * The shape of a model file, as plain data, held for the read alone.
   *
   * The master never leaves this class — a caller holding it could edit the
   * object every clone in the project shares. `describeNodes` reads it and hands
   * back a description instead.
   */
  async modelShape(assetId: AssetId): Promise<ModelShape> {
    const entry = this.modelEntry(assetId);
    const release = this.take(entry);
    try {
      return describeNodes(await entry.master);
    } finally {
      release();
    }
  }

  /**
   * Whether an image's pixels have actually landed.
   *
   * `holdTexture` hands back a usable object before the image exists, which is
   * right almost everywhere — a mesh is untextured for a frame and nobody sees
   * it. The sky is the exception: an image that is not there yet is not a
   * missing detail, it is the whole frame dropping to the clear colour for as
   * long as a ten-megabyte Radiance file takes to parse. Callers that would
   * rather keep showing the old one ask this first.
   */
  textureReady(assetId: AssetId): boolean {
    return this.images.get(assetId)?.landed === true;
  }

  /**
   * Resolves when `textureReady` would start answering true, or the load failed.
   *
   * Resolves at once for an image nothing holds: this reports on a load, it
   * does not start one.
   */
  async whenTextureReady(assetId: AssetId): Promise<void> {
    await this.images.get(assetId)?.settled;
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
  isLinearTexture(assetId: AssetId): boolean {
    return this.encodingOf(assetId) !== 'sdr';
  }

  /** What may stay loaded with nothing holding it. A lower budget evicts at once. */
  setIdleBudgetBytes(bytes: number): void {
    this.idleBudgetBytes = bytes;
    this.trim();
  }

  /** Frees what was evicted before the frame in flight. Once per frame, by the window's loop. */
  beginFrame(): void {
    if (this.evicted.length === 0) return;
    for (const entry of this.evicted) free(entry);
    this.evicted.length = 0;
  }

  /** For the tests, and for a checkpoint reading the editor through its devtools. */
  get stats(): { readonly entries: number; readonly held: number; readonly idleBytes: number } {
    let held = 0;
    for (const entry of this.models.values()) held += entry.holds;
    for (const entry of this.images.values()) held += entry.holds;
    return { entries: this.models.size + this.images.size, held, idleBytes: this.idleBytes };
  }

  /**
   * Frees everything, held or not, and what waits for a frame.
   *
   * The window is going and nothing draws any more, so there is no frame to
   * wait for. A load still in flight is freed when it lands.
   */
  dispose(): void {
    this.disposed = true;
    for (const entry of [...this.models.values(), ...this.images.values()]) {
      if (entry.landed) this.evicted.push(entry);
    }
    this.models.clear();
    this.images.clear();
    this.idle.clear();
    this.idleBytes = 0;
    this.beginFrame();
  }

  /** The entry of a model file, its load started by the first to ask. */
  private modelEntry(assetId: AssetId): ModelEntry {
    const found = this.models.get(assetId);
    if (found !== undefined) return found;

    const url = this.resolver.url(assetId);
    const master =
      url === null
        ? // Callers ask `knows` first; this is the asset that goes away between
          // that question and this answer.
          Promise.reject(new Error(`Unknown model asset: ${assetId}`))
        : loadModelFromUrl(url, this.manager).then((loaded) =>
            this.dressModel(assetId, loaded.object, loaded.animations),
          );
    const entry: ModelEntry = { kind: 'model', id: assetId, holds: 0, bytes: 0, landed: false, master, object: null };
    this.models.set(assetId, entry);

    // Registered before any hold's clone, so the entry has landed by the time a
    // placement is made. A failure is reported by the holders, and forgotten
    // here: kept, it would answer every later hold, a re-import's included.
    void master.then(
      (object) => {
        entry.object = object;
        this.land(entry, modelBytes(object));
      },
      () => {
        this.forget(entry);
      },
    );
    return entry;
  }

  /** The entry of an image, its load started by the first to ask; `null` for an asset the project lacks. */
  private imageEntry(assetId: AssetId): ImageEntry | null {
    const found = this.images.get(assetId);
    if (found !== undefined) return found;

    const url = this.resolver.url(assetId);
    if (url === null) return null;

    let settle = (): void => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const entry: ImageEntry = {
      kind: 'image',
      id: assetId,
      holds: 0,
      bytes: 0,
      landed: false,
      settled,
      waiting: new Set(),
      master: this.textureLoaderFor(url, this.encodingOf(assetId)).load(
        url,
        () => {
          this.imageLanded(entry);
          settle();
        },
        undefined,
        () => {
          this.forget(entry);
          settle();
        },
      ),
    };
    this.images.set(assetId, entry);
    return entry;
  }

  /** Tells every clone taken early that its pixels are here. */
  private imageLanded(entry: ImageEntry): void {
    const settings = this.settingsOf(entry.id);
    for (const clone of entry.waiting) {
      adoptDecodedParameters(clone, entry.master);
      // After adoption, not before: `adoptDecodedParameters` copies the decoded
      // filtering and mipmaps off the master, which would otherwise undo
      // exactly the fields the author set at import.
      if (settings?.kind === 'texture') applyTextureSettings(clone, settings);
      clone.needsUpdate = true;
    }
    entry.waiting.clear();
    this.land(entry, imageBytes(entry.master));
  }

  /**
   * A file has arrived: its bytes count from now on, and with no hold left it
   * is idle. Every entry costs at least a byte, which is what makes a budget
   * of 0 keep nothing.
   */
  private land(entry: Entry, bytes: number): void {
    entry.landed = true;
    entry.bytes = Math.max(1, bytes);
    if (this.disposed) {
      free(entry);
      return;
    }
    if (entry.holds === 0) this.makeIdle(entry);
  }

  /**
   * Counts a hold, and hands back what gives it back.
   *
   * Once: a second call does nothing. And to that entry only, while its id
   * still names it — the rule `Registry` keeps for a registration — so a hold
   * kept past an eviction can never give back a later load of the same file.
   */
  private take(entry: Entry): () => void {
    if (this.idle.delete(entry)) this.idleBytes -= entry.bytes;
    entry.holds += 1;

    let held = true;
    return () => {
      if (!held) return;
      held = false;
      entry.holds -= 1;
      if (entry.holds === 0 && entry.landed && this.owns(entry)) this.makeIdle(entry);
    };
  }

  private makeIdle(entry: Entry): void {
    this.idle.add(entry);
    this.idleBytes += entry.bytes;
    this.trim();
  }

  /** Evicts the oldest idle entries until the rest fit the budget. */
  private trim(): void {
    for (const entry of this.idle) {
      if (this.idleBytes <= this.idleBudgetBytes) return;
      this.idle.delete(entry);
      this.idleBytes -= entry.bytes;
      this.forget(entry);
      this.evicted.push(entry);
    }
  }

  private owns(entry: Entry): boolean {
    return (entry.kind === 'model' ? this.models.get(entry.id) : this.images.get(entry.id)) === entry;
  }

  /** Takes an entry out of the cache, so the next hold of its id loads afresh. */
  private forget(entry: Entry): void {
    if (!this.owns(entry)) return;
    if (entry.kind === 'model') this.models.delete(entry.id);
    else this.images.delete(entry.id);
  }

  /**
   * What the author chose for an asset when they imported it.
   *
   * `null` from a resolver that has no sidecars to read, and every consumer
   * falls back to the format's own defaults rather than to nothing.
   */
  private settingsOf(assetId: AssetId): AssetSettings | null {
    return this.resolver.settings?.(assetId) ?? null;
  }

  /**
   * Applies a model's import settings, or leaves it as the file had it.
   *
   * Here, before it is kept: they describe the file, and applying them per
   * clone would repeat the work once per placement of the same prop.
   */
  private dressModel(assetId: AssetId, loaded: Object3D, animations: readonly AnimationClip[]): Object3D {
    const settings = this.settingsOf(assetId);
    return settings?.kind === 'model' ? applyModelSettings(loaded, settings, animations) : loaded;
  }

  /**
   * How an asset stores light.
   *
   * From the resolver when it knows — an Ultra HDR file is a `.jpg` and only
   * its metadata says otherwise, which is settled at import — and from the
   * extension when it does not, which covers every other format.
   */
  private encodingOf(assetId: AssetId): TextureEncoding {
    const declared = this.resolver.encoding?.(assetId) ?? null;
    if (declared !== null) return declared;

    const url = this.resolver.url(assetId);
    if (url === null) return 'sdr';
    return HDR_EXTENSIONS.has(extensionOf(url)) ? 'hdr' : 'sdr';
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
    load: (url: string, onLoad: () => void, onProgress?: undefined, onError?: () => void) => Texture;
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
}

/**
 * One node of a model, cloned without its descendants and with its local
 * transform reset; see `AssetCache.holdModel`.
 */
function nodeOf(master: Object3D, node: { readonly path: string; readonly name: string }): Object3D | null {
  const found = resolveNode(master, node.path, node.name);
  if (found === null) return null;

  const clone = found.clone(false);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.scale.set(1, 1, 1);
  return clone;
}

/**
 * Gives back what loading made: a model's whole tree, its textures included,
 * or an image's master — never drawn, so freeing it frees the decoded pixels.
 */
function free(entry: Entry): void {
  if (entry.kind === 'image') entry.master.dispose();
  else if (entry.object !== null) disposeModel(entry.object);
}

/*
 * What an entry is worth to the budget: an estimate of what freeing it gives
 * back, counted once when the file lands, and used for nothing but eviction.
 */

/** Each distinct geometry's arrays, and each distinct image. */
function modelBytes(object: Object3D): number {
  const { geometries, textures } = modelResources(object);

  // By array, not by attribute: interleaved attributes share one.
  const arrays = new Set<ArrayBufferView>();
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute.array);
    for (const targets of Object.values(geometry.morphAttributes)) {
      for (const attribute of targets ?? []) arrays.add(attribute.array);
    }
    const index = geometry.getIndex();
    if (index !== null) arrays.add(index.array);
  }

  let bytes = 0;
  for (const array of arrays) bytes += array.byteLength;
  // By source, not by texture: a glTF that samples one image twice clones it.
  const sources = new Set<Source<unknown>>();
  for (const texture of textures) {
    if (sources.has(texture.source)) continue;
    sources.add(texture.source);
    bytes += imageBytes(texture);
  }
  return bytes;
}

/**
 * An image decoded: its data's bytes for a `DataTexture` (HDR, EXR), and four
 * per pixel for what a browser decoded, a third more when mipmapped.
 *
 * Read off the image structurally, since what `image` holds is the loader's
 * business: an `<img>`, an `ImageBitmap`, or nothing yet.
 */
function imageBytes(texture: Texture): number {
  if (texture instanceof DataTexture) return texture.image.data?.byteLength ?? 0;

  const image: unknown = texture.image;
  if (typeof image !== 'object' || image === null || !('width' in image) || !('height' in image)) return 0;
  const { width, height } = image;
  if (typeof width !== 'number' || typeof height !== 'number') return 0;
  return width * height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
}
