import {
  componentAssets,
  componentEntities,
  createPhysicsSettings,
  createTransform,
  deleteComponent,
  insertEntity,
  liveScene,
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
import { CameraClaims } from './cameras';
import { SubsystemMounts, type MountHooks } from './mounts';
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
   * it — each awaited — so it may read what those provide.
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
  /** The scene is being left, while everything is still readable: say goodbye, save what matters. */
  sceneUnload?(): void;
  /**
   * Its world starts: the scene is built, and every component of the types it
   * mounts has been handed to it. Before this no game code runs.
   */
  start?(): void;
  /**
   * A component's values, changed during Play, for what the subsystem built
   * from it to take as if built with them; a component it built nothing from
   * changes nothing. The editor's live tuning.
   */
  tune?(entityId: EntityId, component: ComponentDoc): void;
  /** The same for an asset's values: whatever it built with the asset takes them. */
  tuneAsset?(assetId: AssetId, values: object): void;
}

/** One phase's hooks, bound once when the world is built. */
type Hook = (value: number) => void;

export interface WorldOptions {
  document: SceneDoc;
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
   * A decoded-clip cache to share with the worlds that come after this one.
   *
   * `SceneHost` owns it, so a sound the last level used is still in hand when
   * the next one asks for it.
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
   * Lets scripts move to another scene. Supplied by whatever is hosting this
   * world; a world built on its own does not have a next scene to go to.
   */
  scenes?: SceneApi | null;
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

/**
 * A running game, built from a scene document.
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
   * The scene it runs, as a document; `scene` is the graph a host draws.
   *
   * In Play, the running game's own copy (`liveScene`), changed through the
   * calls below alone — `spawn`, `instantiate`, `destroy`, `putComponent`,
   * `deleteComponent` — and never by what moves: a pose a body or a script
   * gives an object stays on the object. In the edit view, the editor's as it
   * was when the world was made: the editor syncs the binder from its store.
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

  private disposed = false;

  private constructor(options: WorldOptions, mode: WorldMode) {
    this.mode = mode;
    this.options = options;
    this.document = mode === 'play' ? liveScene(options.document) : options.document;
    this.time = options.time;
    this.prefabs = options.prefabs ?? NO_PREFABS;
    // The renderer is handed over rather than owned: this world still neither
    // draws nor holds a frame loop. Capturing an analytic sky into a cubemap is
    // the one thing the binder cannot do as a transform over data, and it needs
    // the device the host already has. The order of the rest is `bindScene`'s,
    // where it is written down.
    this.binder = bindScene(this.scene, this.document, {
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
      // Not in the edit view, whose document is the editor's to sync.
      landed: mode === 'play' ? (entityId) => this.readAgain(entityId) : undefined,
    });
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
  static edit(options: WorldOptions): World {
    return new World(options, 'edit');
  }

  /**
   * The document drawn, then every registered subsystem built in turn and
   * handed the components of the types it mounts, then the world started:
   * Play, a device, the player.
   */
  static async play(options: WorldOptions): Promise<World> {
    const world = new World(options, 'play');

    // Whatever fails below, nothing of a world nobody will hold stays alive: an
    // `Input` built before the throw would keep listening on the canvas, and any
    // other subsystem would keep what it holds.
    try {
      // Each in the order it was registered, and awaited, so one may read what
      // those before it provide: the behaviours, registered after input,
      // physics and audio, reach all three from the moment they are built —
      // a controller looks its rigid body up as it is made, and one made
      // before physics would find none and fly.
      const definitions = options.registries.subsystems.values();
      for (const definition of definitions) {
        const subsystem = await definition.create(world);
        world.subsystems.push(subsystem);
        world.mounts.route(subsystem, definition.mounts ?? []);
      }
      world.schedule(definitions);
      // One pass over the whole document hands every subsystem what it mounts;
      // the drawing side, synced by `bindScene`, finds nothing to change.
      for (const entityId of world.document.entities.keys()) world.dirty.add(entityId);
      world.reconcile();
      world.start();
    } catch (cause) {
      world.dispose();
      throw cause;
    }

    return world;
  }

  /**
   * Starts the game built: each subsystem's `start`, in registration order —
   * the behaviours made, every `onAwake`, then every `onStart` —, then what is
   * wrong with the scene said. The phases run from the next frame.
   */
  start(): void {
    for (const subsystem of this.subsystems) subsystem.start?.();
    this.diagnose();
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
   * Says what is wrong with the scene once the world is built: what the
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
   * A component's values, changed during Play, taken at once by what the
   * running game built from it, as if built with them; a component it built
   * nothing from changes nothing. The host's — the editor's live tuning —:
   * retuning the world is no behaviour's business.
   *
   * Handed to every subsystem that takes a tune, so that neither the world nor
   * the editor names a type it tunes.
   */
  tune(entityId: EntityId, component: ComponentDoc): void {
    for (const subsystem of this.subsystems) subsystem.tune?.(entityId, component);
  }

  /**
   * An asset's values, changed during Play, taken by whatever the running game
   * built with that asset — never by the asset cache, which holds what loading
   * made and which no world writes. The tune goes with the world at Stop; Keep
   * writes the asset's file, which every world then reads through its library.
   */
  tuneAsset(assetId: AssetId, values: object): void {
    for (const subsystem of this.subsystems) subsystem.tuneAsset?.(assetId, values);
  }

  /**
   * One frame of `delta` seconds: the `update` hooks, a `fixed` pass per whole
   * step of the project's fixed step, the `lateUpdate` hooks, the document's
   * changes reconciled, then the `renderPrep` hooks. The host draws afterwards.
   */
  frame(delta: number): void {
    if (this.disposed) return;

    // The frame boundary, for the binder's retire queue: the previous frame's
    // render has been submitted, so what it may still have been reading — what
    // the last pass took down, what was retired on the way into Play — is safe
    // to free now.
    this.binder.beginFrame();

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
   * Adds an entity, under `parent` or at the root: in the document at once,
   * drawn and mounted at the next pass. Its id is its template's, a fresh one;
   * `null`, with nothing added, for an id the document holds or a parent it
   * does not.
   */
  spawn(template: EntityTemplate, parent: EntityId | null = null): EntityId | null {
    this.playing('spawn');
    if (!insertEntity(this.document, template, parent)) return null;
    this.dirty.add(template.entity.id);
    return template.entity.id;
  }

  /**
   * Places a prefab, its contents under the placement, as an expansion places
   * them (`placePrefab`): in the document at once, drawn and mounted at the
   * next pass. Answers the placement; `null` for a prefab this world was not
   * handed, or a parent the document does not hold.
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
    for (const removed of removeSubtree(this.document, entityId)) this.dirty.add(removed);
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

  /**
   * Tells every subsystem the scene is going away, before anything is taken
   * apart: the behaviours tell theirs, which still have a live scene to read.
   */
  notifySceneUnload(): void {
    if (this.disposed) return;
    for (const subsystem of this.subsystems) subsystem.sceneUnload?.();
  }

  dispose(): void {
    // Once: Rapier answers a world freed twice by throwing.
    if (this.disposed) return;
    this.disposed = true;
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

export type { Object3D, OrthographicCamera };


/**
 * Runs one phase's hooks. An indexed loop over an array built once: a frame
 * makes no iterator, no closure and no array of its own.
 */
function run(hooks: readonly Hook[], value: number): void {
  for (let i = 0; i < hooks.length; i += 1) hooks[i]?.(value);
}
