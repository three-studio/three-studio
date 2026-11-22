import {
  collectSceneAssets,
  componentAssets,
  componentEntities,
  createEmptyScene,
  createPhysicsSettings,
  createTransform,
  deleteComponent,
  insertEntity,
  liveScene,
  mergeScene,
  placePrefab,
  putComponent,
  removeSubtree,
  type AssetId,
  type ComponentDoc,
  type ComponentId,
  type ComponentTypeId,
  type CoreRegistries,
  type Disposable,
  type EntityId,
  type EntityTemplate,
  type MaterialDef,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type PrefabDoc,
  type RenderingSettings,
  type Registry,
  type SceneDoc,
  type SubsystemId,
  type Transform,
} from '@three-studio/core';
import {
  PerspectiveCamera,
  Scene,
  type Camera,
  type OrthographicCamera,
  type Object3D,
  type Renderer,
} from 'three/webgpu';
import { SceneBinder, bindScene } from '../SceneBinder';
import type { AssetCache } from '../assets/AssetCache';
import type { AudioClipCache } from '../audio/AudioClipCache';
import type { AudioContextLike } from '../audio/AudioContextLike';
import type { InputOptions } from '../input/Input';
import type { SceneApi } from '../sceneApi';
import type { SystemDefinition } from '../systems/ComponentSystem';
import type { StudioTime } from '../time/StudioTime';
import { forgetRenderLists } from './renderLists';
import { CameraClaims } from './cameras';
import { SubsystemMounts, type MountHooks } from './mounts';
import { LoadedScene } from './scenes';
import { SunService } from './sun';

/**
 * The parts of a frame a subsystem can claim, in the order a frame runs them:
 * `update` once per frame, `fixed` once per whole step of the project's fixed
 * step, `lateUpdate` once what moves has moved, `renderPrep` last before the
 * host draws.
 */
export const PHASES = ['update', 'fixed', 'lateUpdate', 'renderPrep'] as const;

export type Phase = (typeof PHASES)[number];

/**
 * `edit`: the document drawn and nothing simulated — the editor's edit view.
 * `play`: Play, a device, the player.
 */
export type WorldMode = 'edit' | 'play';

/**
 * What a world reads of the registries; a root's runtime registries are this,
 * whole.
 *
 * Written out rather than imported as `RuntimeRegistries`: the runtime's
 * activation registers subsystems whose files import this one, so naming its
 * registries here would close an import cycle.
 */
export type WorldRegistries = CoreRegistries & {
  readonly systems: Registry<ComponentTypeId, SystemDefinition>;
  readonly subsystems: Registry<SubsystemId, SubsystemDefinition>;
};

/**
 * Something that simulates in Play, registered as a system or a behaviour is:
 * the kernel's in `activateRuntime`, a module's by its runtime part, so that
 * the loop below names none of them.
 *
 * Declared beside `World`, which it is built for: in a file of its own it would
 * import the world, and the world it.
 */
export interface SubsystemDefinition {
  readonly id: SubsystemId;
  /**
   * Its place in each phase it claims, lowest first; 0 for a phase it says
   * nothing of, and two at one place run in the order they were registered.
   * Per phase, because one subsystem can need to go after a second in one
   * phase and before it in another.
   */
  readonly order?: { readonly [P in Phase]?: number };
  /**
   * The component types whose components it is handed one by one (see
   * `MountHooks`). Read once, when a world is made.
   */
  readonly mounts?: readonly ComponentTypeId[];
  /**
   * Builds it for one world in Play, after every subsystem registered before
   * it — each awaited — so it may read what those provide. Before any scene is
   * loaded: what it does to the page — a listener, a sound — waits for `start`.
   */
  create(world: World): Subsystem | Promise<Subsystem>;
}

/**
 * One subsystem of one world. A hook present is a phase claimed: there is no
 * list of phases to keep in step with the methods.
 */
export interface Subsystem extends Disposable, MountHooks {
  update?(delta: number): void;
  fixed?(step: number): void;
  lateUpdate?(delta: number): void;
  renderPrep?(delta: number): void;
  /**
   * What it finds wrong with the scene it was built for: said once, when the
   * world has been built, among the world's warnings. What it finds while it
   * runs goes to `world.warn` when it finds it.
   */
  diagnose?(): readonly string[];
  /** `scene` is being left, while everything of it is still readable: say goodbye, save what matters. */
  sceneUnload?(scene: LoadedScene): void;
  /**
   * A scene has started: it is in the document, and every component of the
   * types it mounts has been handed over and settled. Called at each scene's
   * start; before the first, no game code runs.
   */
  start?(): void;
}

/** One phase's hooks, bound once when the world is built. */
type Hook = (value: number) => void;

export interface WorldOptions {
  /**
   * The edit view's document, the editor's. In Play, the scene `World.play`
   * loads, starts and makes active, if any — a test's scene: a game loads its
   * own (`loadScene`).
   */
  document?: SceneDoc;
  /**
   * What the game is built from: the system that draws each type, and the
   * subsystems that simulate — among them the behaviours, each type's that
   * acts. Handed in by whoever hosts the world, so a vehicle, an animator or an
   * audio source is a registration and the loop below never learns that any of
   * them exist.
   */
  registries: WorldRegistries;
  /**
   * The window's clock: made by whoever owns the window's loop — the editor's
   * viewport, the player's root — and handed to every world it draws, since
   * three's `time` node is one per document.
   */
  time: StudioTime;
  /**
   * The project's loaded files, shared with every other world of the window:
   * Play draws the models the edit view already holds, with no second parse
   * and no second copy, and the audio engine reaches the files through its
   * resolver. The world holds what it draws and frees nothing; whoever made
   * the cache begins its frame.
   */
  assets: AssetCache;
  /**
   * Shared materials by asset id.
   *
   * Passed in rather than fetched, and before the first sync: a mesh is built
   * synchronously, so a material that arrived later would have to rebuild it.
   * Omitting this makes every linked material fall back to the embedded one —
   * which is exactly what play mode was doing before it was passed.
   */
  materials?: ReadonlyMap<AssetId, MaterialDef> | undefined;
  /**
   * The project's prefabs by asset id: what `instantiate` places. Omitted, a
   * game instantiates nothing.
   */
  prefabs?: ReadonlyMap<AssetId, PrefabDoc> | undefined;
  /**
   * The project's physics materials by asset id, read when the world is built.
   * Omitted, every collider that links one plays with its own values, and the
   * world says so.
   */
  physicsMaterials?: ReadonlyMap<AssetId, PhysicsMaterialDef> | undefined;
  /**
   * Gravity, the layers and the fixed step. Defaults when the project has none.
   * The step and its cap are the world's clock; physics reads the rest.
   */
  physicsSettings?: PhysicsSettings;
  /**
   * Receives input and takes pointer lock; normally the render canvas. Omitted,
   * the world has no `Input` — a test that presses nothing — and a player
   * controller declines to be built.
   */
  element?: HTMLElement;
  /**
   * How the game's `Input` listens. Omitted, keys are heard window-wide, which
   * is the exported player's choice; the editor hears them on `element` alone,
   * so that a key typed in one of its panels never reaches the game.
   */
  input?: InputOptions;
  /**
   * The audio context this world mixes into.
   *
   * Passed in rather than created, because it is shared: the editor's preview
   * uses the same one through its own root, a browser caps how many a
   * page may have, and each one needs its own user gesture before it makes a
   * sound. Omitting it is a game with no audio, which is what a test wants and
   * what a browser without Web Audio gets.
   */
  audioContext?: AudioContextLike | undefined;
  /**
   * A decoded-clip cache this world shares rather than owns.
   *
   * A `Game` owns it, and holds each scene's sounds in it from the scene's read
   * to its unload, so a sound the last level used is still in hand when the
   * next one asks for it.
   */
  audioCache?: AudioClipCache | undefined;
  /**
   * The device an analytic sky is captured on.
   *
   * Not what draws this world — the host still calls `frame` and renders
   * `world.scene` itself. It is here because a scene whose background is the
   * procedural sky needs that sky turned into a cubemap before anything can be
   * lit by it, and a cubemap is six draw calls. Omitting it leaves such a scene
   * on its background colour, unlit, rather than failing.
   */
  renderer?: Renderer | null;
  /**
   * The project's rendering settings.
   *
   * Required, and that is the point of it: it used to be absent entirely, so a
   * running game answered `shadowMapSize` with the binder's own 2048 whatever
   * the project said, and answered `batching` with a default of its own that
   * happened to match the editor's. Being required means the three modes — the
   * edit view, Play, and an exported build — cannot each quietly answer this
   * for themselves; `npm run typecheck` names any that tries.
   */
  rendering: RenderingSettings;
  /**
   * The classes of the compiled script bundle this world runs, decoded by
   * `scriptClassesOf`. Left out, none: a scene's scripts say they are not
   * compiled.
   *
   * Values of no known type here: the script API names the world, so naming
   * the API back would close an import cycle. The script behaviour checks each
   * class as it reads it.
   */
  scripts?: ReadonlyMap<AssetId, unknown>;
}

/** The edit view's world: its document is required, and is the editor's. */
export type EditWorldOptions = WorldOptions & { readonly document: SceneDoc };

/** How a scene is loaded into a running world. */
export interface LoadSceneOptions {
  /**
   * What a frame gives its build, in milliseconds: its entities are synced one
   * at a time as `frame` is called, until a frame has spent this long, and at
   * least one a frame. Absent, it is built before `loadScene` returns.
   */
  readonly buildBudgetMs?: number;
  /** Given back when the scene is unloaded, or refused. */
  readonly holds?: readonly Disposable[];
  /** What its scripts are given as `this.scenes`. */
  readonly scenes?: SceneApi | null;
}

/**
 * A running game: its scenes, built from their documents into one graph.
 *
 * The world owns the scene graph, physics and controllers, but neither the
 * renderer nor the frame loop — the host calls `frame(delta)` and draws
 * `world.scene` through `world.cameras.active`. That is what lets the editor
 * play a scene inside its own viewport while an exported build runs the exact
 * same code from a bare `requestAnimationFrame`.
 *
 * **Where post-processing would enter, and why nothing in here moves for it.**
 * There is no composer anywhere in this runtime, and no seam waiting to receive
 * one — the seam is the paragraph above. three's `RenderPipeline` is built out
 * of `pass(scene, camera)`, which is exactly the pair this class already hands
 * out, so a host trades its one `renderer.render(world.scene,
 * world.cameras.active)` for `pipeline.render()` and the world never learns
 * that anything changed. There are two such lines in the whole product:
 * `EditorViewport.draw` and the player's loop in `apps/web-template/src/main.ts`.
 * Neither the renderer nor the frame was ever the world's, so neither has to
 * be taken back to compose one.
 *
 * That is checked rather than assumed. `LauncherScene` already runs a
 * `RenderPipeline` — `pass()` plus `bloom()` — on a renderer straight out of
 * `createRenderer`, so nothing that factory configures stands in the way, and
 * the imports are ones this repo already bundles.
 *
 * The one thing to know before writing it: `RenderPipeline.render()` assigns
 * `NoToneMapping` to the renderer before drawing its quad, which reads exactly
 * like the project's tone mapping and exposure being dropped on the floor. They
 * are not. `_update()` rebuilds the output node as `renderOutput(node,
 * renderer.toneMapping, renderer.outputColorSpace)` whenever either moves, and
 * the exposure inside it is a `rendererReference` — so ACES and
 * `rendering.exposure` still arrive. What would drop them is composing with
 * `outputColorTransform = false` and no `renderOutput()` of one's own, and it
 * would drop them in an exported build while the edit view carried on looking
 * right: the same shape of divergence that `WorldOptions.rendering` was made
 * required to end.
 */
export class World {
  readonly scene = new Scene();
  readonly mode: WorldMode;
  /** What it was built with, which its subsystems read: the audio context, the asset cache. */
  readonly options: WorldOptions;
  /**
   * What it runs, as a document; `scene` is the graph a host draws.
   *
   * In Play, the running game's own: every started scene merged into it, and
   * changed through the calls below alone — `spawn`, `instantiate`, `destroy`,
   * `putComponent`, `deleteComponent` — and never by what moves: a pose a body
   * or a script gives an object stays on the object. Its environment is the
   * active scene's. In the edit view, the editor's as it was when the world was
   * made: the editor syncs the binder from its store.
   */
  readonly document: SceneDoc;
  /** The window's clock, shared with every other world of the window and with every node material. */
  readonly time: StudioTime;
  readonly binder: SceneBinder;
  /**
   * Which camera the world is drawn through: claimed by the scene's cameras as
   * they mount and by whatever drives one, and fitted to the host's canvas by
   * one rule (`setAspect`).
   */
  readonly cameras = new CameraClaims();
  /** What a surface that shades itself is lit by: a light, as it mounts, or the scene's sky. */
  readonly sun = new SunService();
  /**
   * One tick, in seconds: the project's fixed step.
   *
   * What a host advances `frame` by to move the game exactly one tick, as the
   * editor's Step does. The world's own clock, whether or not physics runs.
   */
  readonly fixedStep: number;
  /** The most ticks a frame runs: a frame longer than that many steps drops the rest. */
  private readonly maxSubsteps: number;
  /** Time taken in and not yet ticked, below one step once a frame has run. */
  private accumulator = 0;

  /** Reported to the host so it can surface a scene with no camera. */
  readonly warnings: string[] = [];
  /**
   * Notified whenever `warnings` grows.
   *
   * Handing the array to the host once was not enough: a script that fails on
   * frame 200 appends to an array the host already holds by reference, so the
   * text is there but nothing tells the UI to redraw.
   */
  onWarning: ((warnings: readonly string[]) => void) | null = null;

  /** In the order they were built, which is the order they were registered in. */
  private readonly subsystems: Subsystem[] = [];
  /**
   * Each phase's hooks in the order they run, bound once when the world is
   * built: a frame walks four arrays and looks nothing up.
   */
  private readonly hooks: { readonly [P in Phase]: Hook[] } = { update: [], fixed: [], lateUpdate: [], renderPrep: [] };
  /** What each subsystem is handed of the document, and was. */
  private readonly mounts = new SubsystemMounts();
  /**
   * The entities the next pass brings the drawing side and the subsystems in
   * line with, in the order they were touched; and the components it hands
   * back as they are, what they were built with having changed. Each swapped
   * with its spare when a pass begins, so that what a hook asks for during the
   * pass waits for the next one, and a pass makes no set.
   */
  private dirty = new Set<EntityId>();
  private spareDirty = new Set<EntityId>();
  private reread = new Set<ComponentDoc>();
  private spareReread = new Set<ComponentDoc>();
  /** What a pass changes, as it begins: see `handBackNamers`. */
  private readonly changed: EntityId[] = [];
  /** What `setAssetValues` gave each asset. */
  private readonly assetValuesOf = new Map<AssetId, object>();
  /** What `instantiate` places. */
  private readonly prefabs: ReadonlyMap<AssetId, PrefabDoc>;

  /** Its scenes, in the order they were loaded: building, ready or started. */
  private readonly loaded: LoadedScene[] = [];
  /** The scene whose environment is drawn, and which a spawn with no parent joins. */
  private active: LoadedScene | null = null;
  /**
   * The scene of each top-level entity, a building scene's included: where the
   * drawing side hangs it (`SceneBinderOptions.rootOf`), and what `sceneOf`
   * walks up to.
   */
  private readonly topLevel = new Map<EntityId, LoadedScene>();
  /** One entity, as a budgeted build syncs them: the set is reused. */
  private readonly syncing = new Set<EntityId>();
  /** Inside `frame`, where a scene neither starts nor goes. */
  private inFrame = false;

  private disposed = false;

  private constructor(options: WorldOptions, mode: WorldMode, document: SceneDoc) {
    this.mode = mode;
    this.options = options;
    this.document = document;
    this.time = options.time;
    this.prefabs = options.prefabs ?? NO_PREFABS;
    // The renderer is handed over rather than owned: this world still neither
    // draws nor holds a frame loop. Capturing an analytic sky into a cubemap is
    // the one thing the binder cannot do as a transform over data, and it needs
    // the device the host already has.
    const binderOptions = {
      registries: options.registries,
      assets: options.assets,
      rendering: options.rendering,
      materials: options.materials,
      renderer: options.renderer,
      cameras: this.cameras,
      sun: this.sun,
      time: options.time,
      // A model lands after the sync that mounted it: what a subsystem built
      // from the entity's objects — a mesh collider — is built again from it.
      // Not for a scene still building, which no subsystem mounts yet, nor in
      // the edit view, whose document is the editor's to sync.
      landed:
        mode === 'play'
          ? (entityId: EntityId) => {
              if (this.document.entities.has(entityId)) this.readAgain(entityId);
            }
          : undefined,
      rootOf: mode === 'play' ? (entityId: EntityId) => this.topLevel.get(entityId)?.root : undefined,
    };
    if (mode === 'edit') {
      // Drawn at once, in the order `bindScene` writes down.
      this.binder = bindScene(this.scene, this.document, binderOptions);
    } else {
      // Empty: each scene is drawn under its own root as it loads.
      this.binder = new SceneBinder(binderOptions);
      this.scene.add(this.binder.root);
    }
    const { fixedTimestep, maxSubsteps } = options.physicsSettings ?? createPhysicsSettings();
    this.fixedStep = fixedTimestep;
    this.maxSubsteps = maxSubsteps;
  }

  /**
   * Says a problem once: where the editor lays it over the game, and where the
   * player writes it to the console.
   *
   * Repeats are dropped: a warning raised per frame would otherwise fill the
   * panel with one line per tick.
   */
  readonly warn = (message: string): void => {
    if (this.warnings.includes(message)) return;
    this.warnings.push(message);
    this.onWarning?.([...this.warnings]);
  };

  /**
   * The document drawn — its component systems mounted, the world's services
   * live — and nothing simulated: no subsystem is built, so its frame is the
   * arena's flush. The editor's edit view, which draws as Play does, by the
   * same systems mounted the same way.
   */
  static edit(options: EditWorldOptions): World {
    return new World(options, 'edit', options.document);
  }

  /**
   * Play's world, its services and subsystems made; with `document`, that scene
   * loaded at once, made active and started, once ready: Play's entry, a test's
   * scene.
   */
  static async play(options: WorldOptions): Promise<World> {
    const world = new World(options, 'play', liveScene(createEmptyScene('World')));
    const { document } = options;
    // The scene's files are asked for before the subsystems are made, which
    // the build that draws them waits for: Rapier's start is slow to make, and
    // a scene's models and images used to be loading through it, begun by the
    // binder as the world was made. Asked for after, a model waited for both.
    // Given back once it is built, when what draws them holds them.
    let preloads =
      document === undefined
        ? []
        : collectSceneAssets(options.registries, document, options.materials ?? NO_MATERIALS, world.prefabs).map(
            (assetId) => options.assets.preload(assetId),
          );
    const givePreloadsBack = (): void => {
      for (const hold of preloads) hold.dispose();
      preloads = [];
    };

    // Whatever fails below, nothing of a world nobody will hold stays alive: an
    // `Input` built before the throw would keep listening on the canvas, and any
    // other subsystem would keep what it holds.
    try {
      await world.makeSubsystems();
      if (document !== undefined) {
        const scene = world.loadScene(document);
        givePreloadsBack();
        await scene.ready;
        world.setActiveScene(scene);
        world.startScene(scene);
      }
    } catch (cause) {
      givePreloadsBack();
      world.dispose();
      throw cause;
    }
    return world;
  }

  /**
   * Its subsystems, each in the order it was registered, and awaited, so one
   * may read what those before it provide.
   */
  private async makeSubsystems(): Promise<void> {
    // Each in the order it was registered, and awaited, so one may read what
    // those before it provide: the behaviours, registered after input,
    // physics and audio, reach all three from the moment they are built —
    // a controller looks its rigid body up as it is made, and one made
    // before physics would find none and fly.
    const definitions = this.options.registries.subsystems.values();
    for (const definition of definitions) {
      const subsystem = await definition.create(this);
      this.subsystems.push(subsystem);
      this.mounts.route(subsystem, definition.mounts ?? []);
    }
    this.schedule(definitions);
  }

  /** Its scenes, in the order they were loaded: building, ready or started. */
  get scenes(): readonly LoadedScene[] {
    return this.loaded;
  }

  /** The scene whose environment is drawn, and which a spawn with no parent joins. */
  get activeScene(): LoadedScene | null {
    return this.active;
  }

  /**
   * Loads a scene apart from the document: a copy of its own (`liveScene`),
   * drawn under a root of its own, hidden, and mounted by no subsystem — no
   * game code reaches it — until `startScene`. Built before this returns, or
   * within `buildBudgetMs` a frame while the world plays.
   *
   * Refused when it is a loaded scene, or shares an entity id with one: two
   * scenes writing one record would each take the other's entity down with
   * them. `ready` then rejects saying which, nothing is drawn, its holds are
   * given back, and the world says so.
   */
  loadScene(document: SceneDoc, options: LoadSceneOptions = {}): LoadedScene {
    this.playing('loadScene');
    const scene = new LoadedScene(
      liveScene(document),
      options.scenes ?? null,
      options.buildBudgetMs,
      options.holds ?? [],
    );
    const refusal = this.refusalOf(scene);
    if (refusal !== null) {
      scene.unloaded = true;
      scene.giveHoldsBack();
      scene.failed(new Error(refusal));
      this.warn(refusal);
      return scene;
    }

    this.loaded.push(scene);
    this.binder.root.add(scene.root);
    for (const entity of scene.document.entities.values()) {
      if (entity.parent === null) this.topLevel.set(entity.id, scene);
    }
    // Each entity after its parent: a child synced before its parent's
    // container exists is hung from the root, and nothing hangs it again.
    scene.order = treeOrder(scene.document);
    // An empty scene has nothing to wait a frame for.
    if (scene.budgetMs === undefined || scene.order.length === 0) this.build(scene);
    return scene;
  }

  /** Why `scene` cannot load: a loaded scene, or an entity id one of the world's holds; `null` when it can. */
  private refusalOf(scene: LoadedScene): string | null {
    if (this.loaded.some(({ id }) => id === scene.id)) return `Scene "${scene.name}" is already loaded.`;
    for (const [id, entity] of scene.document.entities) {
      const holder = this.document.entities.has(id)
        ? (this.sceneOf(id)?.name ?? this.document.name)
        : this.loaded.find((other) => other.document.entities.has(id))?.name;
      if (holder === undefined) continue;
      return `Scene "${scene.name}" was not loaded: its entity "${entity.name}" (${id}) is in scene "${holder}" too.`;
    }
    return null;
  }

  /**
   * Syncs the next of a building scene's entities, from its own document: all
   * that is left without a budget, else one at a time until the budget is
   * spent, at least one. Its batches are left alone (`draw`): what is hidden
   * joins none, and they form once, at its start. Its last entity synced, it is
   * ready once nothing the drawing side loads is in flight.
   */
  private build(scene: LoadedScene): void {
    const { order, document } = scene;
    if (scene.budgetMs === undefined) {
      this.binder.draw(document, new Set(order.slice(scene.built)));
      scene.built = order.length;
    } else {
      const until = performance.now() + scene.budgetMs;
      while (scene.built < order.length) {
        const entityId = order[scene.built];
        scene.built += 1;
        if (entityId !== undefined) {
          this.syncing.add(entityId);
          this.binder.draw(document, this.syncing);
          this.syncing.clear();
        }
        if (performance.now() >= until) break;
      }
    }
    // A camera claims as it mounts, before its container hangs under the
    // scene's hidden root: chosen again, now that it does.
    this.cameras.refresh();
    if (scene.built === order.length) void this.whenBuilt(scene);
  }

  private async whenBuilt(scene: LoadedScene): Promise<void> {
    try {
      await this.binder.whenLoaded();
      scene.settled();
    } catch (cause) {
      scene.failed(cause);
    }
  }

  /**
   * Makes `scene` the active one: its environment is the document's, drawn
   * and lit — the sky captured —, and a spawn with no parent joins it.
   */
  setActiveScene(scene: LoadedScene): void {
    if (!this.loaded.includes(scene)) throw new Error(`setActiveScene: scene "${scene.name}" is not loaded`);
    this.active = scene;
    this.document.environment = scene.environment;
    this.binder.syncEnvironment(this.scene, this.document);
  }

  /**
   * Starts a ready scene: its records and components move into the document,
   * its root is shown, and one pass mounts it — the drawing side finds every
   * object as it built it —; then each subsystem's `start`, in registration
   * order: physics' step of no time, its behaviours made, every `onAwake`, then
   * every `onStart`; then what is wrong with the world said. Between frames.
   */
  startScene(scene: LoadedScene): void {
    this.betweenFrames('startScene');
    if (scene.started || scene.unloaded || this.disposed) return;
    if (!scene.isReady) throw new Error(`startScene: scene "${scene.name}" is not built yet; await its \`ready\``);
    mergeScene(this.document, scene.document);
    // Shown before the pass, whose sync then groups the batches once, with it.
    scene.root.visible = true;
    this.binder.invalidateBatches();
    for (const entityId of scene.order) this.dirty.add(entityId);
    this.reconcile();
    scene.isStarted = true;
    for (const subsystem of this.subsystems) subsystem.start?.();
    this.cameras.refresh();
    this.diagnose();
  }

  /**
   * Takes `scene` out between frames: a started one tells every subsystem it
   * is left while all of it is readable, then leaves the document — its
   * behaviours' `onDestroy`, its bodies, its objects —; a building one's
   * objects are taken down. Its root goes, its holds are given back; with the
   * active scene gone, none is active until another is made so.
   */
  unloadScene(scene: LoadedScene): void {
    this.betweenFrames('unloadScene');
    if (!this.loaded.includes(scene)) return;
    if (scene.started) for (const subsystem of this.subsystems) subsystem.sceneUnload?.(scene);
    this.drop(scene);
  }

  private drop(scene: LoadedScene): void {
    scene.unloaded = true;
    if (scene.started) {
      for (const [entityId, owner] of this.topLevel) {
        if (owner !== scene) continue;
        for (const removed of removeSubtree(this.document, entityId)) this.dirty.add(removed);
      }
      this.reconcile();
    } else {
      // Drawn from its own document, which the world's never held: taken down
      // by a sync of what was drawn against no entity.
      this.binder.draw({ ...this.document, entities: new Map() }, new Set(scene.order.slice(0, scene.built)));
    }
    for (const [entityId, owner] of this.topLevel) if (owner === scene) this.topLevel.delete(entityId);
    scene.root.removeFromParent();
    // The renderer's lists hold what this scene last drew, and the one `Scene`
    // of a world kept across switches would keep them: see `forgetRenderLists`.
    forgetRenderLists(this.options.renderer);
    this.loaded.splice(this.loaded.indexOf(scene), 1);
    if (this.active === scene) this.active = null;
    scene.giveHoldsBack();
    scene.failed(new Error(`Scene "${scene.name}" was unloaded before it was ready.`));
    this.cameras.refresh();
  }

  /**
   * The scene `entityId` belongs to: its top ancestor's. `null` for an entity
   * the document does not hold — one of a scene still building — or spawned
   * when no scene was active. A walk up its parents, at events only.
   */
  sceneOf(entityId: EntityId): LoadedScene | null {
    let top = entityId;
    let record = this.document.entities.get(top);
    if (record === undefined) return null;
    while (record.parent !== null) {
      top = record.parent;
      const parent = this.document.entities.get(top);
      if (parent === undefined) break;
      record = parent;
    }
    return this.topLevel.get(top) ?? null;
  }

  /** Forgets what was said: the warnings of a scene that was replaced go with it. */
  clearWarnings(): void {
    this.warnings.length = 0;
    this.onWarning?.([]);
  }

  /** Refuses a scene operation inside `frame`: a hook asks for one, and it runs once the frame is over. */
  private betweenFrames(call: string): void {
    if (this.inFrame) throw new Error(`${call}: a scene starts and goes between frames, not inside one`);
  }

  /**
   * Files the hooks of the subsystems, built from `definitions` in that order,
   * in their phases' arrays by their order keys. Once, when the world is built,
   * so that a frame only walks the arrays.
   */
  private schedule(definitions: readonly SubsystemDefinition[]): void {
    for (const phase of PHASES) {
      const claimed = this.subsystems.flatMap((subsystem, index) => {
        const hook = subsystem[phase];
        const key = definitions[index]?.order?.[phase] ?? 0;
        return hook === undefined ? [] : [{ key, hook: hook.bind(subsystem) }];
      });
      // A stable sort: two at one key keep the order they were registered in.
      claimed.sort((a, b) => a.key - b.key);
      this.hooks[phase].push(...claimed.map(({ hook }) => hook));
    }
  }

  /**
   * Says what is wrong with the world once a scene has started: what the
   * drawing side found — two main cameras, no light —, then each subsystem in
   * the order it was built, then the view, which nothing may have claimed.
   */
  private diagnose(): void {
    for (const problem of this.binder.diagnose()) this.warn(problem);
    for (const subsystem of this.subsystems) {
      for (const problem of subsystem.diagnose?.() ?? []) this.warn(problem);
    }
    for (const problem of this.cameras.diagnose()) this.warn(problem);
  }

  /**
   * How far the clock has run into the next tick, from 0 up to below 1: what a
   * body drawn between its last two ticks is drawn at.
   */
  get fixedAlpha(): number {
    return this.accumulator / this.fixedStep;
  }

  /**
   * One frame of `delta` seconds: the `update` hooks, a `fixed` pass per whole
   * step of the project's fixed step, the `lateUpdate` hooks, the document's
   * changes reconciled, each building scene's share of its build, then the
   * `renderPrep` hooks. The host draws afterwards.
   */
  frame(delta: number): void {
    if (this.disposed) return;

    // The frame boundary, for the binder's retire queue: the previous frame's
    // render has been submitted, so what it may still have been reading — what
    // the last pass took down, what was retired on the way into Play — is safe
    // to free now.
    this.binder.beginFrame();
    this.inFrame = true;
    try {
      this.phases(delta);
    } finally {
      this.inFrame = false;
    }
  }

  private phases(delta: number): void {
    // Aiming runs at display rate; movement runs inside the fixed step, because
    // a kinematic body is commanded with a target position rather than an
    // impulse — issuing two targets between one step discards the first.
    run(this.hooks.update, delta);

    // Whole steps only: a variable step would make a stack of boxes settle
    // differently on a 60 Hz and a 144 Hz display. Capped, so a frame that
    // took a second — a tab brought back — runs a few ticks and drops the
    // rest, rather than freezing to catch up.
    this.accumulator += Math.min(delta, this.fixedStep * this.maxSubsteps);
    let ticks = 0;
    while (this.accumulator >= this.fixedStep && ticks < this.maxSubsteps) {
      run(this.hooks.fixed, this.fixedStep);
      this.accumulator -= this.fixedStep;
      ticks += 1;
    }

    run(this.hooks.lateUpdate, delta);
    // What the frame spawned is drawn in it, and what it destroyed is gone
    // before it is drawn, as Unity's `Destroy` and Godot's `queue_free` take
    // effect: an entity destroyed in a hook keeps that frame's other hooks.
    this.reconcile();
    // Indexed, and a scene that fails dropped where it stands: a scene half
    // built is no scene to start, and whoever waits to show it hears why.
    for (let i = 0; i < this.loaded.length; i += 1) {
      const scene = this.loaded[i];
      if (scene === undefined || scene.built === scene.order.length || !scene.building) continue;
      try {
        this.build(scene);
      } catch (cause) {
        scene.failed(cause);
        this.drop(scene);
        i -= 1;
      }
    }
    run(this.hooks.renderPrep, delta);
  }

  /**
   * Brings the drawing side and every subsystem in line with what the document
   * was asked since the last pass (see `SubsystemMounts.pass`). Once a frame,
   * from `frame`; a paused host, which runs no frame, calls it to show what it
   * changed. Nothing asked, it returns at once and makes nothing.
   */
  reconcile(): void {
    if (this.disposed || this.dirty.size === 0) return;
    const dirty = this.dirty;
    const reread = this.reread;
    this.dirty = this.spareDirty;
    this.reread = this.spareReread;
    this.spareDirty = dirty;
    this.spareReread = reread;
    this.handBackNamers(dirty, reread);
    this.mounts.pass(this.document, dirty, reread, this.binder);
    dirty.clear();
    reread.clear();
  }

  /**
   * Adds to a pass each mounted component naming an entity it changes, handed
   * back as it is: a subsystem is told of a water's light as the binder tells
   * the water's system (`SceneBinder.namersOf`). From what is changed when the
   * pass begins, not from what this adds: a namer is not changed by being read
   * again.
   */
  private handBackNamers(dirty: Set<EntityId>, reread: Set<ComponentDoc>): void {
    for (const entityId of dirty) this.changed.push(entityId);
    for (const entityId of this.changed) {
      for (const namer of this.binder.namersOf(entityId)) {
        for (const type of this.mounts.types()) {
          for (const component of this.document.components.get(type)?.get(namer)?.values() ?? []) {
            if (!componentEntities(this.options.registries, component).includes(entityId)) continue;
            dirty.add(namer);
            reread.add(component);
          }
        }
      }
    }
    this.changed.length = 0;
  }

  /**
   * Adds an entity, under `parent` or at the root: in the document and drawn at
   * once, mounted at the next pass. Its id is its template's, a fresh one;
   * `null`, with nothing added, for an id the document holds or a parent it
   * does not.
   *
   * Drawn from the call because the transform lives in the drawing: a script
   * holding the handle of what it just spawned has a container to move at
   * once, and the subsystems mount at the pass from the objects as it left
   * them, so a body is made where the script put its entity. The pass's sync
   * finds them unchanged — the binder writes a transform for a new record only
   * — so this is the same work as the pass's, done earlier; all but the
   * batches, which the pass groups once for everything the frame placed.
   */
  spawn(template: EntityTemplate, parent: EntityId | null = null): EntityId | null {
    this.playing('spawn');
    if (!insertEntity(this.document, template, parent)) return null;
    if (parent === null) this.joinActive(template.entity.id);
    this.binder.draw(this.document, new Set([template.entity.id]));
    this.dirty.add(template.entity.id);
    return template.entity.id;
  }

  /**
   * Places a prefab, its contents under the placement, as an expansion places
   * them (`placePrefab`): in the document and drawn at once, as `spawn` draws,
   * mounted at the next pass. Answers the placement; `null` for a prefab this
   * world was not handed, or a parent the document does not hold.
   */
  instantiate(
    prefab: AssetId,
    place: { readonly parent?: EntityId | null; readonly transform?: Transform } = {},
  ): EntityId | null {
    this.playing('instantiate');
    const placed = placePrefab(this.options.registries, this.document, this.prefabs, {
      prefab,
      parent: place.parent ?? null,
      transform: place.transform ?? createTransform(),
    });
    if (placed === null) return null;
    if (place.parent == null) this.joinActive(placed.root);
    this.binder.draw(this.document, new Set(placed.entities));
    for (const entityId of placed.entities) this.dirty.add(entityId);
    return placed.root;
  }

  /**
   * Takes the entity and everything under it out of the document, a
   * placement's contents included; its objects, bodies and behaviours go at the
   * next pass.
   */
  destroy(entityId: EntityId): void {
    this.playing('destroy');
    for (const removed of removeSubtree(this.document, entityId)) {
      this.dirty.add(removed);
      this.topLevel.delete(removed);
    }
  }

  /** Files a top-level entity a game placed under the active scene: hung from its root, gone with it. */
  private joinActive(entityId: EntityId): void {
    if (this.active !== null) this.topLevel.set(entityId, this.active);
  }

  /**
   * Adds a component to an entity, or replaces the one under its id. `false`,
   * with nothing written, for an entity the document does not hold.
   */
  putComponent(entityId: EntityId, component: ComponentDoc): boolean {
    this.playing('putComponent');
    if (!this.document.entities.has(entityId)) return false;
    putComponent(this.document, entityId, component);
    this.dirty.add(entityId);
    return true;
  }

  /** Takes one component off an entity; `false` when it carried none under that id. */
  deleteComponent(entityId: EntityId, componentId: ComponentId): boolean {
    this.playing('deleteComponent');
    if (!deleteComponent(this.document, entityId, componentId)) return false;
    this.dirty.add(entityId);
    return true;
  }

  /**
   * The values this world plays an asset with from now on, in place of its
   * file's: each component naming it is handed back to the subsystems mounting
   * it at the next pass, to read them through `assetValues`.
   *
   * Never the asset cache's, which holds what loading made and which no world
   * writes: the values go with the world at Stop, and Keep writes the asset's
   * file, which every world then reads.
   */
  setAssetValues(assetId: AssetId, values: object): void {
    this.playing('setAssetValues');
    this.assetValuesOf.set(assetId, values);
    for (const type of this.mounts.types()) {
      for (const [entityId, held] of this.document.components.get(type) ?? []) {
        for (const component of held.values()) {
          if (!componentAssets(this.options.registries, component).includes(assetId)) continue;
          this.dirty.add(entityId);
          this.reread.add(component);
        }
      }
    }
  }

  /** What `setAssetValues` last gave an asset; `undefined` while its file's values stand. */
  assetValues(assetId: AssetId): object | undefined {
    return this.assetValuesOf.get(assetId);
  }

  /** Hands the entity's components back to the subsystems mounting them at the next pass, as they are. */
  private readAgain(entityId: EntityId): void {
    this.dirty.add(entityId);
    for (const type of this.mounts.types()) {
      for (const component of this.document.components.get(type)?.get(entityId)?.values() ?? []) {
        this.reread.add(component);
      }
    }
  }

  /** Refuses a change to an edit world's document, which is the editor's, changed through its store. */
  private playing(call: string): void {
    if (this.mode === 'edit') throw new Error(`${call}: an edit world's document is the editor's to change`);
  }

  dispose(): void {
    // Once: Rapier answers a world freed twice by throwing.
    if (this.disposed) return;
    this.disposed = true;
    for (const scene of this.loaded) {
      scene.unloaded = true;
      scene.giveHoldsBack();
      scene.failed(new Error('The world was disposed before the scene was ready.'));
    }
    this.loaded.length = 0;
    this.active = null;
    // Last built first: one may hold what one built before it provides.
    for (let i = this.subsystems.length - 1; i >= 0; i -= 1) this.subsystems[i]?.dispose();
    this.subsystems.length = 0;
    this.binder.dispose();
    this.scene.clear();
  }
}

/** Narrow a camera the binder produced, for hosts that need the concrete type. */
export function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return camera instanceof PerspectiveCamera;
}

/** The library of a world handed no prefabs. */
const NO_PREFABS: ReadonlyMap<AssetId, PrefabDoc> = new Map();

/** The material table of a world handed none. */
const NO_MATERIALS: ReadonlyMap<AssetId, MaterialDef> = new Map();

/**
 * The document's entities, each after its parent: the roots in their order,
 * each followed by its subtree, then whatever no root reaches, in table order.
 */
function treeOrder(document: SceneDoc): EntityId[] {
  const order: EntityId[] = [];
  const seen = new Set<EntityId>();
  const stack: EntityId[] = [];
  const from = (start: EntityId): void => {
    stack.push(start);
    while (stack.length > 0) {
      const entityId = stack.pop();
      const entity = entityId === undefined ? undefined : document.entities.get(entityId);
      if (entityId === undefined || entity === undefined || seen.has(entityId)) continue;
      seen.add(entityId);
      order.push(entityId);
      // Reversed onto the stack, so that the first child comes off first.
      for (let i = entity.children.length - 1; i >= 0; i -= 1) {
        const child = entity.children[i];
        if (child !== undefined) stack.push(child);
      }
    }
  };
  for (const root of document.rootOrder) from(root);
  for (const entityId of document.entities.keys()) from(entityId);
  return order;
}

export type { Object3D, OrthographicCamera };


/**
 * Runs one phase's hooks. An indexed loop over an array built once: a frame
 * makes no iterator, no closure and no array of its own.
 */
function run(hooks: readonly Hook[], value: number): void {
  for (let i = 0; i < hooks.length; i += 1) hooks[i]?.(value);
}
