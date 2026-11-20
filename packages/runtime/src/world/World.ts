import {
  componentsOfType,
  createPhysicsSettings,
  entitiesWith,
  type AssetId,
  type ComponentDoc,
  type ComponentTypeId,
  type CoreRegistries,
  type Disposable,
  type EntityId,
  type MaterialDef,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type RenderingSettings,
  type Registry,
  type SceneDoc,
  type SubsystemId,
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
import { audioOf } from '../audio/audioOf';
import type { Behaviour, BehaviourContext, BehaviourDefinition } from '../behaviour/Behaviour';
import type { InputOptions } from '../input/Input';
import { inputOf } from '../input/inputOf';
import type { Touch } from '../physics/PhysicsApi';
import { collisionsOf, physicsOf } from '../physics/physicsOf';
import { NO_SCRIPTS, type ScriptClasses } from '../scripting/scriptBundle';
import type { SystemDefinition } from '../systems/ComponentSystem';
import { studioTime } from '../time/StudioTime';
import type { SceneApi } from '../behaviour/Behaviour';

/**
 * The parts of a frame a subsystem can claim, in the order a frame runs them:
 * `update` once per frame, `fixed` once per whole step of the project's fixed
 * step, `lateUpdate` once what moves has moved, `renderPrep` last before the
 * host draws.
 */
export const PHASES = ['update', 'fixed', 'lateUpdate', 'renderPrep'] as const;

export type Phase = (typeof PHASES)[number];

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
  readonly behaviours: Registry<ComponentTypeId, BehaviourDefinition>;
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
   * Builds it for one world in Play, after every subsystem registered before
   * it — each awaited — so it may read what those provide.
   */
  create(world: World): Subsystem | Promise<Subsystem>;
}

/**
 * One subsystem of one world. A hook present is a phase claimed: there is no
 * list of phases to keep in step with the methods.
 */
export interface Subsystem extends Disposable {
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
   * What the game is built from: the system that draws each type and the
   * behaviour of each type that acts. Handed in by whoever hosts the world, so
   * a vehicle, an animator or an audio source is a registration and the loop
   * below never learns that any of them exist.
   */
  registries: WorldRegistries;
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
   */
  scripts?: ScriptClasses;
}

/**
 * A running game, built from a scene document.
 *
 * The world owns the scene graph, physics and controllers, but neither the
 * renderer nor the frame loop — the host calls `frame(delta)` and draws
 * `world.scene` through `world.activeCamera`. That is what lets the editor
 * play a scene inside its own viewport while an exported build runs the exact
 * same code from a bare `requestAnimationFrame`.
 *
 * **Where post-processing would enter, and why nothing in here moves for it.**
 * There is no composer anywhere in this runtime, and no seam waiting to receive
 * one — the seam is the paragraph above. three's `RenderPipeline` is built out
 * of `pass(scene, camera)`, which is exactly the pair this class already hands
 * out, so a host trades its one `renderer.render(world.scene,
 * world.activeCamera)` for `pipeline.render()` and the world never learns
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
  /** What it was built with, which its subsystems read: the audio context, the asset cache. */
  readonly options: WorldOptions;
  /** The scene it runs, as a document. `scene` is the graph a host draws. */
  readonly document: SceneDoc;
  readonly binder: SceneBinder;
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

  /** Exposed for diagnostics; drive them through `frame`, not directly. */
  readonly behaviours: Behaviour[] = [];
  /** What the behaviours that hear what colliders touch listen with, on physics' channel. */
  private readonly listening: Disposable[] = [];

  /** In the order they were built, which is the order they were registered in. */
  private readonly subsystems: Subsystem[] = [];
  /**
   * Each phase's hooks in the order they run, bound once when the world is
   * built: a frame walks four arrays and looks nothing up.
   */
  private readonly hooks: { readonly [P in Phase]: Hook[] } = { update: [], fixed: [], lateUpdate: [], renderPrep: [] };

  private readonly fallbackCamera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  private context: BehaviourContext;
  private documentCamera: Camera | null = null;
  private disposed = false;

  private constructor(options: WorldOptions) {
    this.options = options;
    this.document = options.document;
    // The renderer is handed over rather than owned: this world still neither
    // draws nor holds a frame loop. Capturing an analytic sky into a cubemap is
    // the one thing the binder cannot do as a transform over data, and it needs
    // the device the host already has. The order of the rest is `bindScene`'s,
    // where it is written down.
    this.binder = bindScene(this.scene, options.document, {
      registries: options.registries,
      assets: options.assets,
      rendering: options.rendering,
      materials: options.materials,
      renderer: options.renderer,
    });
    const { fixedTimestep, maxSubsteps } = options.physicsSettings ?? createPhysicsSettings();
    this.fixedStep = fixedTimestep;
    this.maxSubsteps = maxSubsteps;
    this.context = this.behaviourContext();
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
   * What the behaviours are handed. Made again once the subsystems are built,
   * since input, physics and audio are subsystems', made after the world: a
   * behaviour is never built before that.
   */
  private behaviourContext(): BehaviourContext {
    return {
      scene: this.document,
      binder: this.binder,
      physics: physicsOf(this),
      input: inputOf(this),
      time: studioTime,
      scenes: this.options.scenes ?? null,
      audio: audioOf(this),
      scripts: this.options.scripts ?? NO_SCRIPTS,
      warn: this.warn,
    };
  }

  /**
   * A scene with no light at all renders black, and nothing else says so.
   *
   * Silent at runtime, as a physics set-up gone wrong is, and worse: while it
   * is edited, the Viewport lights such a scene with a default pair of its own,
   * so the author has already seen it lit. What is named here is therefore the
   * difference, not the absence — the same condition that switches the
   * editor's pair on, said from the side that does not have it. See
   * `viewport/editorProjection`.
   */
  private checkLighting(scene: SceneDoc): void {
    if (entitiesWith(scene, 'light').length > 0) return;
    this.warnings.push(
      'This scene has no lights, so it renders black. While you edit, the Viewport lights it with a default light that Play and a build do not have.',
    );
  }

  static async play(options: WorldOptions): Promise<World> {
    const world = new World(options);

    // Whatever fails below, nothing of a world nobody will hold stays alive: an
    // `Input` built before the throw would keep listening on the canvas, and any
    // other subsystem would keep what it holds.
    try {
      // Order matters, and each step needs the one before it:
      //
      //   subsystems  each in the order it was registered, awaited, so one
      //               may read what those before it provide — physics among
      //               them, built once the models are in;
      //   models      in before any behaviour, physics or none: a script
      //               reads its model's nodes from `onAwake`;
      //   behaviours  last: one looks its rigid body up when it is built, so a
      //               controller built earlier would find none and fly, and
      //               each reaches input, physics and audio through them.
      const definitions = options.registries.subsystems.values();
      for (const definition of definitions) world.subsystems.push(await definition.create(world));
      await world.binder.whenLoaded();
      world.schedule(definitions);
      world.context = world.behaviourContext();
      world.buildBehaviours(options.document, options.registries);
      world.pickCamera(options.document);
      // In the order they were built, which says physics' lines before audio's.
      for (const subsystem of world.subsystems) {
        for (const problem of subsystem.diagnose?.() ?? []) world.warn(problem);
      }
      world.checkLighting(options.document);
    } catch (cause) {
      world.dispose();
      throw cause;
    }

    return world;
  }

  /**
   * Files the hooks of the subsystems, built from `definitions` in that order,
   * in their phases' arrays by their order keys. Once, when the world is built,
   * so that a frame only walks the arrays.
   *
   * The behaviours' hooks go first, at 0 in the three phases they run in: they
   * are the world's until they are a subsystem of their own, and they sit
   * where they always ran — a tick after their fixed hook, the bodies drawn
   * before their late one, the ear placed after it.
   */
  private schedule(definitions: readonly SubsystemDefinition[]): void {
    const behaviours: Subsystem = {
      update: (delta) => {
        for (const behaviour of this.behaviours) behaviour.update?.(delta, this.context);
      },
      fixed: (step) => {
        for (const behaviour of this.behaviours) behaviour.fixedUpdate?.(step, this.context);
      },
      lateUpdate: () => {
        for (const behaviour of this.behaviours) behaviour.postUpdate?.(this.context);
      },
      dispose: () => {},
    };
    const scheduled = [
      { subsystem: behaviours, order: undefined },
      ...this.subsystems.map((subsystem, index) => ({ subsystem, order: definitions[index]?.order })),
    ];
    for (const phase of PHASES) {
      const claimed = scheduled.flatMap(({ subsystem, order }) => {
        const hook = subsystem[phase];
        const key = order?.[phase] ?? 0;
        return hook === undefined ? [] : [{ key, hook: hook.bind(subsystem) }];
      });
      // A stable sort: two at one key keep the order they were registered in.
      claimed.sort((a, b) => a.key - b.key);
      this.hooks[phase].push(...claimed.map(({ hook }) => hook));
    }
  }

  /**
   * A behaviour's camera wins over an authored one: if something is driving the
   * view — a player, a vehicle, a cutscene rig — that is the view you are in.
   */
  get activeCamera(): Camera {
    return this.behaviourCameras[0] ?? this.documentCamera ?? this.fallbackCamera;
  }

  private get behaviourCameras(): Camera[] {
    return this.behaviours.flatMap((behaviour) => (behaviour.camera ? [behaviour.camera] : []));
  }

  setViewportAspect(aspect: number): void {
    for (const camera of [this.fallbackCamera, ...this.behaviourCameras, this.documentCamera]) {
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
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
   * step of the project's fixed step, the `lateUpdate` hooks, then the
   * `renderPrep` hooks. The host draws afterwards.
   */
  frame(delta: number): void {
    if (this.disposed) return;

    // The frame boundary, for the binder's retire queue: the previous frame's
    // render has been submitted, so what it may still have been reading is safe
    // to free now. Nothing in a running game syncs the binder, so without this
    // anything retired on the way into Play would stay resident for the session.
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
    run(this.hooks.renderPrep, delta);

    // Last, once everything that moves has moved: a batch reads its members'
    // world matrices, and reading them before physics wrote back would draw
    // every batched object one frame behind.
    this.binder.updateBatches();
  }

  /**
   * Tells every behaviour the scene is going away, before anything is taken
   * apart.
   *
   * Separate from `dispose` because the two answer different questions: this
   * one is "we are leaving, save what matters" and still has a live scene to
   * read; `dispose` is the teardown itself. Unity splits them the same way
   * with `OnDisable` and `OnDestroy`.
   */
  notifySceneUnload(): void {
    if (this.disposed) return;
    for (const behaviour of this.behaviours) {
      try {
        behaviour.onSceneUnload?.();
      } catch (cause) {
        // One script refusing to leave must not strand the transition.
        console.error('[scene] onSceneUnload threw', cause);
      }
    }
  }

  dispose(): void {
    // Once: Rapier answers a world freed twice by throwing.
    if (this.disposed) return;
    this.disposed = true;
    for (const behaviour of this.behaviours) behaviour.dispose?.();
    this.behaviours.length = 0;
    for (const listening of this.listening) listening.dispose();
    this.listening.length = 0;
    // Last built first: one may hold what one built before it provides.
    for (let i = this.subsystems.length - 1; i >= 0; i -= 1) this.subsystems[i]?.dispose();
    this.subsystems.length = 0;
    this.binder.dispose();
    this.scene.clear();
  }

  /**
   * Instantiates a behaviour for every component that has one registered.
   *
   * The world deliberately does not name any component type here. A new kind
   * of controller is a registration, not an edit to this loop.
   */
  private buildBehaviours(scene: SceneDoc, registries: WorldRegistries): void {
    let cameraOwners = 0;
    const collisions = collisionsOf(this);

    // Driven by the registry and then by the tables of the types it names: a
    // scene of two thousand props with one player controller in it visits one
    // entity. It used to walk them all, and every component of each.
    for (const definition of registries.behaviours.values()) {
      for (const [entityId, held] of componentsOfType(scene, definition.id)) {
        const entity = scene.entities.get(entityId);
        const object = this.binder.getObject(entityId);
        if (!entity || !object) continue;

        for (const component of held.values()) {
          const behaviour = definition.create({ entity, object, component }, this.context);
          if (!behaviour) continue;

          this.behaviours.push(behaviour);
          if (behaviour.camera) cameraOwners += 1;
          // What its entity's colliders touch, and those of the children
          // riding its body when it is a body's: physics publishes to both.
          if (collisions && listens(behaviour)) {
            this.listening.push(collisions.listen(entityId, (touch) => this.hear(behaviour, touch)));
          }
        }
      }
    }

    if (cameraOwners > 1) {
      this.warnings.push(
        `${cameraOwners} components want to drive the camera; the first one wins.`,
      );
    }

    // Second pass. Everything now exists, so a behaviour can look another one
    // up regardless of which entity was built first.
    for (const behaviour of this.behaviours) behaviour.start?.(this.context);
  }

  /**
   * What one side of a pair heard, told to a behaviour on it.
   *
   * Unguarded, as `update` is: a script's hook is guarded by its own behaviour.
   */
  private hear(behaviour: Behaviour, touch: Touch): void {
    switch (touch.kind) {
      case 'collisionEnter': {
        // A copy each, so no listener can change what the next one hears.
        const { other, point, normal, impulse } = touch.collision;
        behaviour.onCollisionEnter?.(
          {
            other,
            point: { x: point.x, y: point.y, z: point.z },
            normal: { x: normal.x, y: normal.y, z: normal.z },
            impulse,
          },
          this.context,
        );
        break;
      }
      case 'collisionExit':
        behaviour.onCollisionExit?.(touch.other, this.context);
        break;
      case 'triggerEnter':
        behaviour.onTriggerEnter?.(touch.other, this.context);
        break;
      case 'triggerExit':
        behaviour.onTriggerExit?.(touch.other, this.context);
        break;
    }
  }

  private pickCamera(scene: SceneDoc): void {
    const cameras = this.binder.collectCameras(scene);
    const claiming = cameras.filter((entry) => entry.isMain);
    if (claiming.length > 1) {
      // Easy to reach without noticing: one prefab holding a main camera,
      // placed twice.
      this.warnings.push(`${claiming.length} cameras are marked main; the first one is used.`);
    }

    const main = claiming[0] ?? cameras[0];
    this.documentCamera = main?.camera ?? null;

    if (this.behaviourCameras.length === 0 && !this.documentCamera) {
      this.warnings.push('No camera and no player controller; using a default view.');
      this.fallbackCamera.position.set(8, 6, 12);
      this.fallbackCamera.lookAt(0, 0, 0);
    }
  }
}

/** Narrow a camera the binder produced, for hosts that need the concrete type. */
export function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return camera instanceof PerspectiveCamera;
}

export type { Object3D, OrthographicCamera };

/** Whether a behaviour hears what its entity's colliders touch. */
function listens(behaviour: Behaviour): boolean {
  return (
    behaviour.onCollisionEnter !== undefined ||
    behaviour.onCollisionExit !== undefined ||
    behaviour.onTriggerEnter !== undefined ||
    behaviour.onTriggerExit !== undefined
  );
}

/**
 * Runs one phase's hooks. An indexed loop over an array built once: a frame
 * makes no iterator, no closure and no array of its own.
 */
function run(hooks: readonly Hook[], value: number): void {
  for (let i = 0; i < hooks.length; i += 1) hooks[i]?.(value);
}
