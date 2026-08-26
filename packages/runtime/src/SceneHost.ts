import {
  collectSceneAssets,
  expandPrefabs,
  type MaterialDef,
  type PrefabDoc,
  type SceneDoc,
} from '@three-studio/core';
import { Engine, type EngineOptions } from './Engine';
import { AudioClipCache } from './audio/AudioClipCache';
import { ModelCache } from './assets/ModelCache';
import type { SceneApi } from './behaviour/Behaviour';
import { NULL_ASSET_RESOLVER } from './assets/AssetResolver';

/**
 * Runs one scene at a time, and moves between them.
 *
 * A game is a sequence of scenes — a splash, a menu, its sub-pages, a first
 * level, a second — and the interesting part is what happens between two of
 * them. `Engine` builds a scene and tears one down; this decides when.
 *
 * Loading and showing are deliberately separate, which is the one thing Unity,
 * Unreal and Godot all agree on. Unity stalls `LoadSceneAsync` at 0.9 until
 * `allowSceneActivation`; Unreal loads a streaming level with
 * `bMakeVisibleAfterLoad` off. Both exist for the same reason: "ready" and
 * "showing" are different moments, and a game that cannot tell them apart
 * cannot put a Press Start between them.
 */

export interface SceneSource {
  /** Reads a scene document by its project-relative path. */
  read(path: string): Promise<SceneDoc>;
}

/** What everything a scene needs, other than the document itself. */
export interface SceneHostOptions extends Omit<EngineOptions, 'scene'> {
  source: SceneSource;
  materials?: Readonly<Record<string, MaterialDef>>;
  prefabs?: Readonly<Record<string, PrefabDoc>>;
  /**
   * Shown while another scene loads, by name. `null` swaps straight over.
   *
   * Loaded *single*, replacing what was on screen, and the target loads behind
   * it. That is the original Unity arrangement — the one from before additive
   * loading — and it works because a loading scene is small enough that its own
   * load is not worth showing anything for.
   */
  loadingScene?: string | null;
}

export interface SceneLoad {
  readonly path: string;
  /** 0 to 1 across the assets the scene needs. 1 before `ready` settles. */
  readonly progress: number;
  /** Settles when the scene could be shown. Rejects if the document is unreadable. */
  readonly ready: Promise<void>;
  readonly activated: boolean;
  readonly cancelled: boolean;
  /**
   * Shows it. Safe to call before `ready` — it waits.
   *
   * Doing nothing when already activated is deliberate: a Press Start button
   * and an "activate as soon as it is ready" both firing is an ordinary race,
   * not a mistake to report.
   */
  activate(): Promise<void>;
  /** Drops a load in flight. Its assets stay in the cache. */
  cancel(): void;
}

export class SceneHost implements SceneApi {
  /** Null until the first scene is activated. */
  engine: Engine | null = null;
  /** The path of the running scene, for scripts that branch on it. */
  current: string | null = null;
  /** Fired after each activation, for a player to hide its own chrome. */
  onSceneChanged: ((path: string, engine: Engine) => void) | null = null;

  private pending: LoadHandle | null = null;
  private disposed = false;
  /**
   * Warms assets before a scene exists to hold them.
   *
   * Shared with nothing — each `Engine` builds its own binder and cache — but
   * the browser's HTTP cache means a file fetched here is not fetched twice.
   * The alternative, keeping one cache across scenes, would hold every asset
   * of every level ever visited for the life of the game.
   */
  private readonly preloader: ModelCache;

  /**
   * Decoded clips, kept across scenes — the one cache that *is* shared.
   *
   * The opposite of the reasoning above, and for a reason the models cannot
   * offer: this one has a byte budget and evicts what nothing holds, so it
   * cannot grow into "every asset of every level ever visited". What it buys is
   * that a footstep the last level used is still decoded when the next one asks
   * for it, which is the common case rather than the exotic one.
   */
  private readonly clips: AudioClipCache | null;

  constructor(private readonly options: SceneHostOptions) {
    this.preloader = new ModelCache(options.resolver ?? NULL_ASSET_RESOLVER);
    this.clips =
      options.audioContext === undefined
        ? null
        : new AudioClipCache(options.audioContext, options.resolver ?? NULL_ASSET_RESOLVER);
  }

  /**
   * Starts fetching a scene. Returns immediately; the work is in the handle.
   *
   * A second call replaces the first: pressing two level buttons in a row
   * should land on the second, not race to whichever finished.
   */
  load(path: string): SceneLoad {
    this.pending?.cancel();
    const handle = new LoadHandle(path, this);
    this.pending = handle;
    handle.begin();

    // Put up first, so the wait has something on screen. Never for the loading
    // scene itself, which would be a loop.
    const loading = this.options.loadingScene;
    if (loading != null && loading !== path && this.current !== loading) {
      void this.showLoadingScene(loading);
    }
    return handle;
  }

  private async showLoadingScene(name: string): Promise<void> {
    try {
      await this.swap(name, await this.read(name));
    } catch (cause) {
      // Not fatal: the scene being loaded is the point, and going straight to
      // it is better than stopping because the interstitial is missing.
      console.warn(`[scene] loading scene "${name}" could not be shown`, cause);
    }
  }

  /**
   * Starts on a document already in hand, skipping the read.
   *
   * The editor's Play does this: what it runs is the scene being edited, which
   * has unsaved changes and is not what is on disk. Everything after the first
   * swap goes through `load` like anywhere else.
   */
  async adopt(path: string, scene: SceneDoc): Promise<void> {
    await this.swap(path, scene);
  }

  /** Loads and shows in one step, for a script that has nothing to display. */
  async go(path: string): Promise<void> {
    const load = this.load(path);
    await load.activate();
  }

  update(delta: number): void {
    this.engine?.update(delta);
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.cancel();
    this.engine?.dispose();
    this.engine = null;
    this.current = null;
    // Cleared here and not in `Engine.dispose`, which is exactly the point of
    // sharing it: the engine goes away between scenes, the host does not.
    this.clips?.clear();
  }

  /** Used by a handle once its assets are in; not part of the public surface. */
  async swap(path: string, scene: SceneDoc): Promise<void> {
    if (this.disposed) return;

    // The outgoing scene is told before anything of it is taken apart, so a
    // behaviour can still read its own entities while saving state.
    this.engine?.notifySceneUnload();
    this.engine?.dispose();

    // Expanded here, once, for every caller. A scene arrives as a document —
    // read from disk or handed over by the editor — and an instance's contents
    // only exist after this. Doing it at each call site is three places to
    // forget, and the symptom is a level that loads with its props missing.
    const engine = await Engine.create({
      ...this.options,
      scene: expandPrefabs(scene, { get: (id) => this.options.prefabs?.[id] }).scene,
      scenes: this,
      // Handed over rather than built per engine, so the clips outlive the
      // scene that first asked for them.
      audioCache: this.clips ?? undefined,
    });

    // Checked again, because `Engine.create` awaits Rapier and every model the
    // scene needs — hundreds of milliseconds during which Stop can be pressed.
    // `dispose` ran while `this.engine` was still null, so it had nothing to
    // take down, and this line used to hand a fully built engine to a host
    // nobody holds any more. Its `Input` keeps listening on the canvas, and the
    // first click back in the editor asks for a pointer lock the editor never
    // wanted — which is how a stopped game was still grabbing the mouse.
    if (this.disposed) {
      engine.dispose();
      return;
    }

    this.engine = engine;
    this.current = path;
    this.onSceneChanged?.(path, engine);
  }

  read(path: string): Promise<SceneDoc> {
    return this.options.source.read(path);
  }

  assetsOf(scene: SceneDoc): string[] {
    return collectSceneAssets(scene, this.options.materials ?? {}, this.options.prefabs ?? {});
  }

  /**
   * Fetches one asset ahead of the swap.
   *
   * Through a cache of its own rather than the running engine's: the point is
   * to have everything in hand *before* the new engine exists, and the old
   * one's cache goes away with it.
   */
  async preloadAsset(assetId: string): Promise<void> {
    // A sound goes to the clip cache and nowhere near the model one, which
    // would silently do nothing with it: `ModelCache.preload` switches on the
    // extension and an unknown one simply returns.
    if (this.clips !== null && this.options.resolver?.settings?.(assetId)?.kind === 'audio') {
      const held = this.clips.acquire(assetId);
      await held.clip;
      // Given straight back: preloading means "have it ready", not "hold it
      // forever". The budget decides how long it stays.
      held.release();
      return;
    }
    return this.preloader.preload(assetId);
  }
}

class LoadHandle implements SceneLoad {
  progress = 0;
  activated = false;
  cancelled = false;
  readonly ready: Promise<void>;

  private settle!: () => void;
  private fail!: (reason: unknown) => void;
  private scene: SceneDoc | null = null;

  constructor(
    readonly path: string,
    private readonly host: SceneHost,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.settle = resolve;
      this.fail = reject;
    });
    // Nobody has to await `ready` — a script may only ever poll `progress` —
    // and an unhandled rejection would then be reported as a crash.
    this.ready.catch(() => {});
  }

  begin(): void {
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      const scene = await this.host.read(this.path);
      if (this.cancelled) return;
      this.scene = scene;

      const ids = this.host.assetsOf(scene);
      if (ids.length === 0) {
        this.progress = 1;
        this.settle();
        return;
      }

      // Counted as they land rather than by bytes: a per-file bar is honest
      // about how much is left, and byte totals are not known until the
      // headers arrive anyway.
      let done = 0;
      await Promise.all(
        ids.map(async (id) => {
          await this.host.preloadAsset(id);
          done += 1;
          if (!this.cancelled) this.progress = done / ids.length;
        }),
      );

      if (this.cancelled) return;
      this.progress = 1;
      this.settle();
    } catch (cause) {
      this.fail(cause);
    }
  }

  async activate(): Promise<void> {
    if (this.activated || this.cancelled) return;
    await this.ready;
    if (this.activated || this.cancelled || this.scene === null) return;

    this.activated = true;
    await this.host.swap(this.path, this.scene);
  }

  cancel(): void {
    if (this.activated) return;
    this.cancelled = true;
  }
}
