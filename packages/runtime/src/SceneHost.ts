import {
  collectSceneAssets,
  expandPrefabs,
  type AssetId,
  type Disposable,
  type MaterialDef,
  type PrefabDoc,
  type SceneDoc,
  type SceneId,
} from '@three-studio/core';
import { World, type WorldOptions } from './world/World';
import type { PreloadHold } from './assets/AssetCache';
import { AudioClipCache } from './audio/AudioClipCache';
import type { SceneApi } from './sceneApi';

/**
 * Runs one scene at a time, and moves between them.
 *
 * A game is a sequence of scenes — a splash, a menu, its sub-pages, a first
 * level, a second — and the interesting part is what happens between two of
 * them. `World` builds a scene and tears one down; this decides when.
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
export interface SceneHostOptions extends Omit<WorldOptions, 'document'> {
  source: SceneSource;
  materials?: ReadonlyMap<AssetId, MaterialDef>;
  /**
   * Shown while another scene loads, by id. `null` swaps straight over.
   *
   * Loaded *single*, replacing what was on screen, and the target loads behind
   * it. That is the original Unity arrangement — the one from before additive
   * loading — and it works because a loading scene is small enough that its own
   * load is not worth showing anything for.
   */
  loadingScene?: SceneId | null;
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
  /**
   * Drops a load in flight. What it held is given back, and the cache's budget
   * decides what of it stays.
   */
  cancel(): void;
}

export class SceneHost implements SceneApi {
  /** Null until the first scene is activated. */
  world: World | null = null;
  /** The path of the running scene, for scripts that branch on it. */
  current: string | null = null;
  /** Fired after each activation, for a player to hide its own chrome. */
  onSceneChanged: ((path: string, world: World) => void) | null = null;

  private pending: LoadHandle | null = null;
  private disposed = false;

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
    this.clips =
      options.audioContext === undefined
        ? null
        : new AudioClipCache(options.audioContext, options.assets.resolver);
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

    // Put up so the wait has something on screen — never for the loading scene
    // itself, which would be a loop — but only once the target has read its
    // scene and holds what it needs. Put up at once, it took the scene being
    // left down first, and with a build's cache, which keeps nothing nobody
    // holds, that freed what the target shares with it, to be fetched again.
    const loading = this.options.loadingScene;
    handle.begin(
      loading != null && loading !== path && this.current !== loading
        ? () => this.showLoadingScene(loading)
        : null,
    );
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
    this.world?.frame(delta);
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.cancel();
    this.world?.dispose();
    this.world = null;
    this.current = null;
    // Cleared here and not in `World.dispose`, which is exactly the point of
    // sharing it: the world goes away between scenes, the host does not.
    this.clips?.clear();
  }

  /** Used by a handle once its assets are in; not part of the public surface. */
  async swap(path: string, scene: SceneDoc): Promise<void> {
    if (this.disposed) return;

    // The outgoing scene is told before anything of it is taken apart, so a
    // behaviour can still read its own entities while saving state.
    this.world?.notifySceneUnload();
    this.world?.dispose();

    // Expanded here, once, for every caller. A scene arrives as a document —
    // read from disk or handed over by the editor — and an instance's contents
    // only exist after this. Doing it at each call site is three places to
    // forget, and the symptom is a level that loads with its props missing.
    const world = await World.play({
      ...this.options,
      document: expandPrefabs(this.options.registries, scene, { get: (id) => this.options.prefabs?.get(id) }).scene,
      scenes: this.sceneApiFor(path),
      // Handed over rather than built per world, so the clips outlive the
      // scene that first asked for them.
      audioCache: this.clips ?? undefined,
    });

    // Checked again, because `World.play` awaits Rapier and every model the
    // scene needs — hundreds of milliseconds during which Stop can be pressed.
    // `dispose` ran while `this.world` was still null, so it had nothing to
    // take down, and this line used to hand a fully built world to a host
    // nobody holds any more. Its `Input` keeps listening on the canvas, and the
    // first click back in the editor asks for a pointer lock the editor never
    // wanted — which is how a stopped game was still grabbing the mouse.
    if (this.disposed) {
      world.dispose();
      return;
    }

    this.world = world;
    this.current = path;
    this.onSceneChanged?.(path, world);
  }

  /**
   * This host as one scene's scripts see it: `current` is always that scene.
   *
   * The host itself names a scene only once it runs, after `World.play` — and
   * every `onAwake` and `onStart` runs inside `World.play`. Handed the host,
   * a script asking where it was read `null` in the first scene and the name of
   * the scene just left in every later one, so a level restarting itself from
   * `onStart` restarted the previous one, or failed on `No scene "null"`.
   *
   * Fixed per scene rather than by naming the scene before building it: a
   * loading scene and the scene it stands in for can be built at the same time,
   * and one name on the host would answer one of them with the other's.
   */
  private sceneApiFor(path: string): SceneApi {
    return {
      current: path,
      load: (scene) => this.load(scene),
      go: (scene) => this.go(scene),
    };
  }

  read(path: string): Promise<SceneDoc> {
    return this.options.source.read(path);
  }

  assetsOf(scene: SceneDoc): AssetId[] {
    return collectSceneAssets(
      this.options.registries,
      scene,
      this.options.materials ?? new Map<AssetId, MaterialDef>(),
      this.options.prefabs ?? new Map<AssetId, PrefabDoc>(),
    );
  }

  /**
   * Holds one asset ahead of the swap: a sound in the clip cache, anything else
   * in the project's. The load gives the hold back once the new world holds
   * what it draws, or when it is cancelled.
   */
  preloadAsset(assetId: AssetId): PreloadHold {
    // A sound goes to the clip cache and nowhere near the asset one, which
    // would silently do nothing with it: `AssetCache.preload` switches on the
    // extension and holds nothing for one it does not load.
    if (this.clips !== null && this.options.assets.resolver.settings?.(assetId)?.kind === 'audio') {
      const held = this.clips.acquire(assetId);
      let holding = true;
      return {
        // A clip that failed arrives as `null`: settled, which is all a bar counts.
        ready: held.clip.then(() => undefined),
        dispose: () => {
          if (!holding) return;
          holding = false;
          held.release();
        },
      };
    }
    return this.options.assets.preload(assetId);
  }
}

class LoadHandle implements SceneLoad {
  progress = 0;
  activated = false;
  cancelled = false;
  readonly ready: Promise<void>;

  private settle = (): void => {};
  private fail = (_reason: unknown): void => {};
  private scene: SceneDoc | null = null;
  /**
   * What the scene needs, held from the moment it is read until the new world
   * holds it too — so a file the scene being left shares with it never drops to
   * no holder in between.
   */
  private holds: readonly Disposable[] = [];
  /** Settles once the loading scene is up, or at once when there is none. */
  private interstitial: Promise<void> = Promise.resolve();

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

  /** @param showLoading Puts the loading scene up, once this load holds what it needs. */
  begin(showLoading: (() => Promise<void>) | null): void {
    void this.run(showLoading);
  }

  private async run(showLoading: (() => Promise<void>) | null): Promise<void> {
    try {
      const scene = await this.host.read(this.path);
      if (this.cancelled) return;
      this.scene = scene;

      const ids = this.host.assetsOf(scene);
      const holds = ids.map((id) => this.host.preloadAsset(id));
      this.holds = holds;
      // `activate` waits for it: the loading scene's swap and the target's must
      // not run at once, nor the loading scene come up over the target.
      if (showLoading !== null) this.interstitial = showLoading();

      // Counted as they land rather than by bytes: a per-file bar is honest
      // about how much is left, and byte totals are not known until the
      // headers arrive anyway.
      let done = 0;
      await Promise.all(
        holds.map(async (hold) => {
          await hold.ready;
          done += 1;
          if (!this.cancelled) this.progress = done / holds.length;
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
    await this.interstitial;
    if (this.activated || this.cancelled || this.scene === null) return;

    this.activated = true;
    try {
      await this.host.swap(this.path, this.scene);
    } finally {
      // The new world holds what it draws by now — or failed to be built,
      // and holds nothing that should stay pinned for it.
      this.giveBack();
    }
  }

  cancel(): void {
    if (this.activated) return;
    this.cancelled = true;
    this.giveBack();
  }

  private giveBack(): void {
    for (const hold of this.holds) hold.dispose();
    this.holds = [];
  }
}
