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
import type { PreloadHold } from '../assets/AssetCache';
import { AudioClipCache } from '../audio/AudioClipCache';
import type { SceneApi, SceneLoadHandle } from '../sceneApi';
import type { LoadedScene } from '../world/scenes';
import { World, type WorldOptions } from '../world/World';

/**
 * A game: one world for the whole of it, into which its scenes load, start and
 * go.
 *
 * A game is a sequence of scenes — a splash, a menu, a first level, a second —
 * and the interesting part is what happens between two of them. The world
 * builds a scene hidden and starts it; this decides when.
 *
 * Loading and showing are deliberately separate, which is the one thing Unity,
 * Unreal and Godot all agree on. Unity stalls `LoadSceneAsync` at 0.9 until
 * `allowSceneActivation`; Unreal loads a streaming level with
 * `bMakeVisibleAfterLoad` off. Both exist for the same reason: "ready" and
 * "showing" are different moments, and a game that cannot tell them apart
 * cannot put a Press Start between them.
 *
 * One world rather than one per scene: its subsystems — physics, audio, input,
 * the scripts' façade — outlive every scene, so a switch makes no Rapier world
 * and a scene being built is mounted by nothing until it starts.
 */

export interface SceneSource {
  /** Reads a scene document by its id, or by the name a script holds. */
  read(scene: string): Promise<SceneDoc>;
}

/**
 * What a frame gives the build of a scene behind the loading scene, in
 * milliseconds: with the loading scene's own frame, it fits a frame at 60 Hz,
 * so the spinner keeps turning while the next level builds.
 */
const BUILD_BUDGET_MS = 12;

/** Everything a game's scenes need, other than the documents themselves. */
export interface GameOptions extends Omit<WorldOptions, 'document' | 'audioCache'> {
  readonly source: SceneSource;
  /**
   * Shown while a switch's target builds, by id. `null` switches straight over.
   *
   * Put up in place of the scene left, and the target builds behind it. That
   * is the original Unity arrangement — the one from before additive loading —
   * and it works because a loading scene is small enough that its own load is
   * not worth showing anything for.
   */
  readonly loadingScene?: SceneId | null;
}

/** A switch in flight, as a script and a host hold it. */
export interface SceneLoad extends SceneLoadHandle {
  readonly cancelled: boolean;
}

/** The library of a game handed no prefabs. */
const NO_PREFABS: ReadonlyMap<AssetId, PrefabDoc> = new Map();

/** The material table of a game handed none. */
const NO_MATERIALS: ReadonlyMap<AssetId, MaterialDef> = new Map();

export class Game implements Disposable {
  /** Fired each time the active scene changes, the loading scene included, for a host to follow. */
  onSceneChanged: ((asked: string, world: World) => void) | null = null;

  private made: World | null = null;
  private asked: string | null = null;
  private pending: Switch | null = null;
  /** The loading scene coming up, which a second switch waits for rather than loading it again. */
  private loadingUp: Promise<void> | null = null;
  /** A switch's target loaded at once and not started yet: a later switch takes it down. */
  private arriving: LoadedScene | null = null;
  /**
   * Moves with every activation and with `dispose`: an activation that finds it
   * moved after an await was replaced, and goes no further.
   */
  private switches = 0;
  private disposed = false;

  /**
   * Decoded clips, kept across scenes: a footstep the last level used is still
   * decoded when the next one asks for it. It has a byte budget and evicts what
   * nothing holds, so it cannot grow into every sound of every level visited.
   */
  private readonly clips: AudioClipCache | null;

  constructor(private readonly options: GameOptions) {
    this.clips =
      options.audioContext === undefined ? null : new AudioClipCache(options.audioContext, options.assets.resolver);
  }

  /** The game's one world, from `start` until `dispose`. */
  get world(): World | null {
    return this.made;
  }

  /** The active scene, by the name it was asked by: what a switch replaces. */
  get current(): string | null {
    return this.asked;
  }

  /**
   * Makes the world, then starts `scene`, a document in hand, as the first
   * active scene.
   *
   * The editor's Play does this: what it runs is the scene being edited, which
   * has unsaved changes and is not what is on disk. Every switch after it goes
   * through `load`.
   */
  async start(asked: string, scene: SceneDoc): Promise<void> {
    if (this.disposed || this.made !== null) return;
    // Asked for before the world is made, which Rapier's start makes slow: a
    // scene's models used to load through it, and asked for after, a model
    // waited for both.
    const holds = this.hold(scene);
    let world: World;
    try {
      world = await World.play({ ...this.options, audioCache: this.clips ?? undefined });
    } catch (cause) {
      release(holds);
      throw cause;
    }
    // Stopped while the world was made: `dispose` found nothing to take down,
    // and a world handed to a game nobody holds kept its `Input` listening on
    // the canvas — a stopped game still grabbing the mouse.
    if (this.disposed) {
      release(holds);
      world.dispose();
      return;
    }
    this.made = world;
    const entry = world.loadScene(this.expand(scene), { holds, scenes: this.apiFor(asked) });
    await Promise.all([entry.ready, landed(holds)]);
    if (this.disposed) return;
    this.show(world, asked, entry);
  }

  /**
   * Starts fetching a scene. Returns at once; the work is in the handle.
   *
   * A second call replaces the first: pressing two level buttons in a row
   * should land on the second, not race to whichever finished.
   */
  load(scene: string): SceneLoad {
    this.pending?.cancel();
    const next = new Switch(scene, (load) => this.activate(load), (load) => this.cancel(load));
    this.pending = next;
    void this.prepare(next);
    return next;
  }

  /** Loads and shows in one step, for a script that has nothing to display meanwhile. */
  async go(scene: string): Promise<void> {
    await this.load(scene).activate();
  }

  /** One frame of the world: its scenes playing, and those building behind them. */
  update(delta: number): void {
    this.made?.frame(delta);
  }

  /** What the world was asked since its last frame, taken without one: a paused host's. */
  reconcile(): void {
    this.made?.reconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.switches += 1;
    this.pending?.cancel();
    this.pending = null;
    // Gives back what each of its scenes holds.
    this.made?.dispose();
    this.made = null;
    this.asked = null;
    this.arriving = null;
    this.clips?.clear();
  }

  /**
   * Reads the target and holds what it names; puts the loading scene up when
   * there is one to put up, and builds the target behind it. `ready` once the
   * target's holds have landed and, behind the loading scene, it is built.
   */
  private async prepare(next: Switch): Promise<void> {
    try {
      const read = await this.options.source.read(next.path);
      if (next.cancelled || this.disposed) return;
      // Held before the loading scene goes up, which takes the scene left down:
      // with a build's cache, which keeps nothing nobody holds, what the target
      // shares with it would be freed and fetched again.
      next.take(this.hold(read));
      next.document = this.expand(read);

      const loading = this.options.loadingScene ?? null;
      if (loading !== null && loading !== next.path && this.asked !== loading) {
        this.loadingUp ??= this.showLoadingScene(loading).finally(() => {
          this.loadingUp = null;
        });
        await this.loadingUp;
        if (next.cancelled || this.disposed) return;
      }

      // Built over frames while the loading scene plays.
      const world = this.made;
      if (world !== null && loading !== null && this.asked === loading && next.path !== loading) {
        next.scene = world.loadScene(next.document, {
          buildBudgetMs: BUILD_BUDGET_MS,
          holds: next.handOver(),
          scenes: this.apiFor(next.path),
        });
      }
      await Promise.all([next.scene?.ready, next.whenLanded()]);
      if (next.cancelled) return;
      next.settle();
    } catch (cause) {
      next.fail(cause);
    }
  }

  /**
   * Puts the loading scene up in place of the active one. Not fatal when it
   * cannot be: the scene asked for is the point, and going straight to it
   * beats stopping because the interstitial is missing.
   */
  private async showLoadingScene(id: SceneId): Promise<void> {
    const world = this.made;
    if (world === null) return;
    try {
      const read = await this.options.source.read(id);
      if (this.disposed) return;
      const holds = this.hold(read);
      const scene = world.loadScene(this.expand(read), { holds, scenes: this.apiFor(id) });
      await Promise.all([scene.ready, landed(holds)]);
      if (this.disposed) return;
      this.leave(world);
      this.show(world, id, scene);
    } catch (cause) {
      console.warn(`[scene] loading scene "${id}" could not be shown`, cause);
    }
  }

  /**
   * Shows a switch's target once it is ready, after an `await`: one a script
   * asks for in a hook runs once the frame is over, never inside it.
   *
   * Built behind the loading scene, the loading scene goes and the target
   * starts. Otherwise the scene left goes first, then the target is built at
   * once and started: two levels are never in memory together.
   */
  private async activate(next: Switch): Promise<void> {
    if (next.activated || next.cancelled) return;
    await next.decided;
    if (next.activated || next.cancelled || this.disposed) return;
    const world = this.made;
    const document = next.document;
    if (world === null || document === null) return;
    next.activated = true;
    if (this.pending === next) this.pending = null;
    const mine = ++this.switches;

    this.leave(world);
    if (next.scene !== null) {
      this.show(world, next.path, next.scene);
      return;
    }
    const scene = world.loadScene(document, { holds: next.handOver(), scenes: this.apiFor(next.path) });
    this.arriving = scene;
    try {
      await scene.ready;
    } catch (cause) {
      // Taken down by a switch that replaced it, or by Stop: nothing to say.
      if (this.switches !== mine) return;
      throw cause;
    }
    if (this.switches !== mine) return;
    this.arriving = null;
    this.show(world, next.path, scene);
  }

  /**
   * Drops a switch not yet shown: what it holds is given back, and a target
   * building behind the loading scene is unloaded once the frame is over — a
   * script may cancel from a hook, and a scene goes between frames.
   */
  private cancel(next: Switch): void {
    if (next.activated || next.cancelled) return;
    next.cancelled = true;
    if (this.pending === next) this.pending = null;
    next.release();
    const scene = next.scene;
    if (scene === null) return;
    queueMicrotask(() => {
      if (!this.disposed) this.made?.unloadScene(scene);
    });
  }

  /**
   * Takes the active scene down: its scripts hear they are left while all of
   * it is readable, then it goes, and its problems with it. A target an earlier
   * switch was still loading goes too.
   */
  private leave(world: World): void {
    if (this.arriving !== null) world.unloadScene(this.arriving);
    this.arriving = null;
    const left = world.activeScene;
    if (left !== null) world.unloadScene(left);
    world.clearWarnings();
  }

  private show(world: World, asked: string, scene: LoadedScene): void {
    world.setActiveScene(scene);
    world.startScene(scene);
    this.asked = asked;
    this.onSceneChanged?.(asked, world);
  }

  /**
   * The game as one scene's scripts see it: `current` is always that scene.
   *
   * Fixed per scene rather than read from the game: every `onAwake` and
   * `onStart` runs as a scene starts, before the game names it, and a loading
   * scene and the scene it stands in for are loaded at the same time — one name
   * on the game would answer one of them with the other's.
   */
  private apiFor(asked: string): SceneApi {
    return {
      current: asked,
      load: (scene) => this.load(scene),
      go: (scene) => this.go(scene),
    };
  }

  /** Expanded here, once, for every caller: an instance's contents only exist after this. */
  private expand(scene: SceneDoc): SceneDoc {
    return expandPrefabs(this.options.registries, scene, { get: (id) => this.options.prefabs?.get(id) }).scene;
  }

  /**
   * A hold on each asset `scene` names, from its read to its unload, the
   * contents of the prefabs its scripts can instantiate included: drawn by
   * nothing at start, such a prefab's model would otherwise be freed a frame
   * after its last instance went, under a build's idle budget of nothing, and
   * loaded again for the next — a spawner's every crate a fetch.
   */
  private hold(scene: SceneDoc): PreloadHold[] {
    const prefabs = this.options.prefabs ?? NO_PREFABS;
    const materials = this.options.materials ?? NO_MATERIALS;
    return collectSceneAssets(this.options.registries, scene, materials, prefabs, new Set(prefabs.keys())).map((id) =>
      this.preload(id),
    );
  }

  /** One asset held: a sound in the clip cache, anything else in the project's. */
  private preload(assetId: AssetId): PreloadHold {
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

function release(holds: readonly Disposable[]): void {
  for (const hold of holds) hold.dispose();
}

function landed(holds: readonly PreloadHold[]): Promise<unknown> {
  return Promise.all(holds.map(({ ready }) => ready));
}

/** One switch: its target read and held, maybe built, until it is shown or dropped. */
class Switch implements SceneLoad {
  activated = false;
  cancelled = false;
  readonly ready: Promise<void>;
  /** Settles at `ready`, or when it is dropped: what `activate` waits for. */
  readonly decided: Promise<void>;
  /** The target, its prefabs expanded, once read. */
  document: SceneDoc | null = null;
  /** The target built behind the loading scene, which holds what it read from then. */
  scene: LoadedScene | null = null;

  private holds: readonly PreloadHold[] = [];
  /** Whether `holds` are still its own to give back, rather than a scene's. */
  private owned = false;
  private landedCount = 0;
  private done = false;
  private resolve = (): void => {};
  private reject = (_cause: unknown): void => {};
  private drop = (): void => {};

  constructor(
    readonly path: string,
    private readonly onActivate: (load: Switch) => Promise<void>,
    private readonly onCancel: (load: Switch) => void,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // Nobody has to await `ready` — a script may only ever poll `progress` —
    // and an unhandled rejection would then be reported as a crash.
    this.ready.catch(() => {});
    this.decided = new Promise<void>((resolve, reject) => {
      this.drop = resolve;
      this.ready.then(resolve, reject);
    });
    this.decided.catch(() => {});
  }

  /**
   * 0 to 1 across what it holds landing and, behind the loading scene, its
   * entities built: counted per file and per entity rather than by bytes,
   * which are not known until the headers arrive.
   */
  get progress(): number {
    if (this.done) return 1;
    const total = this.holds.length + (this.scene?.order.length ?? 0);
    return total === 0 ? 0 : (this.landedCount + (this.scene?.built ?? 0)) / total;
  }

  /**
   * Shows it. Safe to call before `ready` — it waits.
   *
   * Doing nothing when already activated is deliberate: a Press Start button
   * and an "activate as soon as it is ready" both firing is an ordinary race,
   * not a mistake to report.
   */
  activate(): Promise<void> {
    return this.onActivate(this);
  }

  /** Drops it, if not shown yet. What it held is given back, and the cache's budget decides what stays. */
  cancel(): void {
    this.onCancel(this);
    this.drop();
  }

  take(holds: readonly PreloadHold[]): void {
    this.holds = holds;
    this.owned = true;
  }

  /** Its holds, now the scene's: given back at its unload. */
  handOver(): readonly PreloadHold[] {
    this.owned = false;
    return this.holds;
  }

  whenLanded(): Promise<unknown> {
    return Promise.all(
      this.holds.map(async ({ ready }) => {
        await ready;
        this.landedCount += 1;
      }),
    );
  }

  release(): void {
    if (!this.owned) return;
    this.owned = false;
    release(this.holds);
  }

  settle(): void {
    this.done = true;
    this.resolve();
  }

  fail(cause: unknown): void {
    this.reject(cause);
  }
}
