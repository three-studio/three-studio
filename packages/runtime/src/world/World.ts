import {
  colliderGeometry,
  componentsOfType,
  createPhysicsSettings,
  entitiesWith,
  findComponent,
  findComponents,
  hasComponent,
  jointEnds,
  layersTouch,
  linkedPhysicsMaterial,
  physicsBodies,
  type AssetId,
  type ComponentDoc,
  type ComponentTypeId,
  type CoreRegistries,
  type Disposable,
  type EntityId,
  type JointComponent,
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
import type { PhysicsApi } from '../physics/PhysicsApi';
import {
  PhysicsWorld,
  type ColliderOwner,
  type DebugLines,
  type PhysicsEvent,
} from '../physics/PhysicsWorld';
import { ownMeshes } from '../physics/meshShape';
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
  /** Gravity and the solver's step. Defaults when the project has none. */
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
  enablePhysics?: boolean;
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
   * Physics as the behaviours see it, `null` with physics off.
   *
   * The physics world's lifecycle stays private, so no host can step it out of
   * turn or free it a second time, which throws.
   */
  readonly physics: PhysicsApi | null;
  /**
   * One tick, in seconds: the project's fixed step.
   *
   * What a host advances `frame` by to move the game exactly one tick, as the
   * editor's Step does. Set with physics off too, from the same settings.
   */
  readonly fixedStep: number;

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
  /** The behaviours that hear what colliders touch, by the entity each sits on. */
  private readonly listeners = new Map<EntityId, Behaviour[]>();

  /** In the order they were built, which is the order they were registered in. */
  private readonly subsystems: Subsystem[] = [];
  /**
   * Each phase's hooks in the order they run, bound once when the world is
   * built: a frame walks four arrays and looks nothing up.
   */
  private readonly hooks: { readonly [P in Phase]: Hook[] } = { update: [], fixed: [], lateUpdate: [], renderPrep: [] };

  private readonly fallbackCamera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  private readonly physicsWorld: PhysicsWorld | null;
  private context: BehaviourContext;
  private documentCamera: Camera | null = null;
  private disposed = false;

  private constructor(
    options: WorldOptions,
    physicsSettings: PhysicsSettings,
    physics: PhysicsWorld | null,
  ) {
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
    this.physicsWorld = physics;
    this.physics = physics;
    this.fixedStep = physicsSettings.fixedTimestep;
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
   * since the input and the audio engine are subsystems', made after the world:
   * a behaviour is never built before that.
   */
  private behaviourContext(): BehaviourContext {
    return {
      scene: this.document,
      binder: this.binder,
      physics: this.physics,
      input: inputOf(this),
      time: studioTime,
      scenes: this.options.scenes ?? null,
      audio: audioOf(this),
      scripts: this.options.scripts ?? NO_SCRIPTS,
      warn: this.warn,
    };
  }

  /**
   * Reports set-ups that will not behave as the author expects.
   *
   * Every case here fails silently at runtime — a player with no collider just
   * flies, a rigid body with no collider just passes through the floor — which
   * makes them the hardest kind of mistake to find. Naming the entity and the
   * fix costs nothing and turns a mystery into a one-line correction.
   */
  private checkPhysicsSetup(
    scene: SceneDoc,
    settings: PhysicsSettings,
    physicsMaterials: ReadonlyMap<AssetId, PhysicsMaterialDef>,
  ): void {
    // Over the bodies the world builds, so the two cannot disagree: a body
    // whose colliders are on its children was warned about as having none.
    const bodies = physicsBodies(scene);
    const players = new Set(entitiesWith(scene, 'playerController'));
    // Which body each collider rides: the one whose type it is built for.
    const riding = new Map<EntityId, EntityId>();
    for (const [body, carried] of bodies) {
      for (const entityId of carried) riding.set(entityId, body);
    }
    const { warn } = this;

    // A mesh-derived collider on an entity with nothing to derive from falls
    // back to a box 2 cm across, which a player walks straight past. It
    // happened for real: physics used to be built before the glTF arrived.
    // That is fixed, but a model that fails to load reaches the same place,
    // and silently.
    for (const [entityId, bodyId] of riding) {
      const entity = scene.entities.get(entityId);
      if (!entity) continue;
      const meshes = findComponents(scene, entityId, 'collider').filter(
        (component) => component.shape.kind === 'mesh',
      );
      if (meshes.length === 0) continue;

      // Triangles on a dynamic body are built as their hull, which fills in
      // the very holes the author may have chosen triangles to keep. The body
      // may be a parent's, which is then the one to name.
      const bodyType = findComponent(scene, bodyId, 'rigidbody')?.bodyType;
      const hulled = meshes.some(({ shape }) => {
        const built = colliderGeometry(shape, [1, 1, 1], bodyType).shape;
        return shape.kind === 'mesh' && built.kind === 'mesh' && built.build !== shape.build;
      });
      if (hulled) {
        const body =
          bodyId === entityId ? 'its Rigid Body' : `the Rigid Body of "${scene.entities.get(bodyId)?.name}"`;
        warn(
          `"${entity.name}" moves with physics, so its mesh Collider is built as its convex hull rather than from its triangles: holes and hollows are filled in. Choose Convex parts to keep them, Convex hull to say so, or make ${body} Kinematic or Fixed.`,
        );
      }

      // Its own meshes alone: a group's children draw theirs. Moved, not
      // copied: given to its children and kept, it is still the tiny box.
      const object = this.binder.getObject(entityId);
      if (!object || ownMeshes(object).length === 0) {
        warn(
          `"${entity.name}" has a mesh Collider but draws no mesh of its own, so it is a tiny box nothing can stand on. A Collider is built from its own entity's meshes, not its children's: move it onto each child that should collide, or check that its model loaded.`,
        );
      }
    }

    // Something declares physics and has nothing to collide with. An empty
    // list is a Rigid Body's, level geometry being a collider's own; a player
    // is said by what it lacks itself.
    for (const [entityId, carried] of bodies) {
      const entity = scene.entities.get(entityId);
      if (!entity || carried.length > 0 || players.has(entityId)) continue;
      warn(
        `"${entity.name}" has a Rigid Body but no Collider, on it or on a child without a body of its own, so nothing can touch it. Add a Collider.`,
      );
    }
    // Its own: a character sweeps its entity's collider, never one riding its
    // body from a child.
    for (const entityId of players) {
      const entity = scene.entities.get(entityId);
      if (!entity || hasComponent(scene, entityId, 'collider')) continue;
      warn(
        `"${entity.name}" has a Player Controller but no Collider, so it flies instead of walking. Add a Collider.`,
      );
    }

    // A player's own capsule is not something to stand on, and counting it
    // was a false negative that hid the whole point of the check: a scene
    // whose only collider was the player's said nothing while the player fell
    // for ever. Nor is anything riding the player's body, which moves with it.
    const hasGround = [...bodies].some(([entityId, carried]) => carried.length > 0 && !players.has(entityId));
    if (players.size > 0 && !hasGround) {
      warn(
        'Nothing but the player has a Collider, so there is no ground to stand on. Add a Collider to whatever the player should walk on.',
      );
    } else if (this.physicsWorld) {
      // Nor is a sensor, nor a collider whose layer the player's passes
      // through. Unticking a pair while trying the matrix out is the quickest
      // way to a player that falls for ever, and nothing else says why.
      const solid = [...riding].flatMap(([entityId, body]) =>
        findComponents(scene, entityId, 'collider')
          .filter((collider) => !collider.isSensor)
          .map(({ layer }) => ({ body, layer })),
      );
      for (const entityId of players) {
        const entity = scene.entities.get(entityId);
        // The collider its character sweeps.
        const own = findComponent(scene, entityId, 'collider');
        if (!entity || !own) continue;
        const stands = solid.some(
          ({ body, layer }) => body !== entityId && layersTouch(settings.layers, own.layer, layer),
        );
        if (stands) continue;
        const name = settings.layers.find((layer) => layer.id === own.layer)?.name ?? 'Default';
        warn(
          `"${entity.name}" is on the layer "${name}", which touches the layer of no other Collider, so it falls through everything. Tick "${name}" against the ground's layer in Project Settings ▸ Physics.`,
        );
      }
    }

    // A collider naming a layer the table no longer has collides as Default,
    // and its Layer row only shows no choice. Removing a layer rewrites no
    // scene: the others are on disk.
    const layerIds = new Set(settings.layers.map((layer) => layer.id));
    for (const entityId of this.physicsWorld ? riding.keys() : []) {
      const entity = scene.entities.get(entityId);
      const colliders = findComponents(scene, entityId, 'collider');
      if (!entity || colliders.every((collider) => layerIds.has(collider.layer))) continue;
      warn(
        `"${entity.name}" has a Collider on a layer this project no longer has, so it collides as Default. Choose its Layer again.`,
      );
    }

    // A link to a physics material the project lacks plays the collider's own
    // values. The hierarchy marks it while editing; a device and a build have
    // no hierarchy, and a puck that grips where it was made to slide gives no
    // reason. `''` is a slot left empty, not a link.
    for (const entityId of this.physicsWorld ? riding.keys() : []) {
      const entity = scene.entities.get(entityId);
      const colliders = findComponents(scene, entityId, 'collider');
      const lost = colliders.some(
        ({ materialId }) => !!materialId && linkedPhysicsMaterial(materialId, physicsMaterials) === null,
      );
      if (!entity || !lost) continue;
      warn(
        `"${entity.name}" has a Collider whose physics material is not in this project, so it grips and bounces by its own values. Choose its Material again.`,
      );
    }

    // A joint the world left out is dropped silently, and one holding no body
    // the solver moves is built and does nothing: a door falls off its hinge,
    // or a gate on a Kinematic body never swings, and nothing else says why.
    // Read through the rule the build reads.
    for (const [entityId, held] of this.physicsWorld ? componentsOfType(scene, 'joint') : []) {
      for (const joint of held.values()) {
        const problem = joint.type === 'joint' ? jointProblem(scene, entityId, joint) : null;
        if (problem) warn(problem);
      }
    }

    // A behaviour hears through its entity's colliders, or a body's through
    // those of the children riding it: on an entity with neither it hears
    // nothing, and nothing says why. A Rigid Body with no collider anywhere is
    // said above. With physics off the line would be about the host, not the
    // scene.
    for (const entityId of this.physicsWorld ? this.listeners.keys() : []) {
      const entity = scene.entities.get(entityId);
      if (!entity || hasComponent(scene, entityId, 'collider') || hasComponent(scene, entityId, 'rigidbody')) {
        continue;
      }
      warn(
        `"${entity.name}" listens for collisions or triggers but has no Collider and no Rigid Body, so it never hears one. Add a Collider to it, or move the script onto the entity that has one.`,
      );
    }
  }

  /**
   * A scene with no light at all renders black, and nothing else says so.
   *
   * Silent at runtime like the rest of these, and worse than silent: while it
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
    // Resolved once, so physics ticks by the step the world tells its host.
    const physicsSettings = options.physicsSettings ?? createPhysicsSettings();
    const physics =
      options.enablePhysics === false ? null : await PhysicsWorld.create(physicsSettings);
    const world = new World(options, physicsSettings, physics);

    // Whatever fails below, nothing of a world nobody will hold stays alive: an
    // `Input` built before the throw would keep listening on the canvas, and any
    // other subsystem would keep what it holds.
    try {
      // Order matters, and each step needs the one before it:
      //
      //   models      a collider derived from a mesh needs the mesh, and a glTF
      //               arrives well after `sync` returns — building physics
      //               first gave an imported level a box around an empty group,
      //               which the player fell straight through;
      //   physics     a behaviour looks its rigid body up when it is
      //               constructed, so a controller built earlier would find
      //               none and fly;
      //   subsystems  each in the order it was registered, awaited, so one
      //               may read what those before it provide; and before the
      //               behaviours, which reach input and audio through them.
      await world.binder.whenLoaded();
      const physicsMaterials = options.physicsMaterials ?? new Map<AssetId, PhysicsMaterialDef>();
      physics?.build(options.document, world.binder, physicsMaterials);
      const definitions = options.registries.subsystems.values();
      for (const definition of definitions) world.subsystems.push(await definition.create(world));
      world.schedule(definitions);
      world.context = world.behaviourContext();
      world.buildBehaviours(options.document, options.registries);
      world.pickCamera(options.document);
      world.checkPhysicsSetup(options.document, physicsSettings, physicsMaterials);
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
   * Rapier's debug view as of the last tick, for a host to draw over the game;
   * `null` with physics off.
   *
   * Here and not on `physics`, which every behaviour and script is handed: what
   * the solver holds is the host's to show.
   */
  physicsDebug(): DebugLines | null {
    return this.physicsWorld?.debugLines() ?? null;
  }

  /**
   * A component's values, changed during Play, taken at once by what the
   * running game built from it, as if built with them; a component it built
   * nothing from changes nothing. The host's — the editor's live tuning — as
   * `physicsDebug` is: retuning the world is no behaviour's business.
   *
   * The physics world, the one part of the game built here that takes a tune,
   * is handed every component and keeps what it built from, so that the editor
   * names no type it tunes.
   */
  tune(entityId: EntityId, component: ComponentDoc): void {
    this.physicsWorld?.tune(entityId, component);
  }

  /**
   * An asset's values, changed during Play, taken by whatever the running game
   * built with that asset — never by the asset cache, which holds what loading
   * made and which no world writes. The tune goes with the world at Stop; Keep
   * writes the asset's file, which every world then reads through its library.
   */
  tuneAsset(assetId: AssetId, values: object): void {
    this.physicsWorld?.tuneAsset(assetId, values);
  }

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
    for (const behaviour of this.behaviours) behaviour.update?.(delta, this.context);
    run(this.hooks.update, delta);

    if (this.physicsWorld) {
      this.physicsWorld.step(
        delta,
        (step) => {
          for (const behaviour of this.behaviours) behaviour.fixedUpdate?.(step, this.context);
          run(this.hooks.fixed, step);
        },
        // After the tick they happened in and before the next one's
        // `fixedUpdate`, as Unity runs its collision messages.
        (events) => this.hear(events),
      );
      this.physicsWorld.writeBack();
    }

    for (const behaviour of this.behaviours) behaviour.postUpdate?.(this.context);
    // After `postUpdate`, so what is placed there — a camera following its
    // player, a listener riding it — is read where it ended the frame.
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
    this.listeners.clear();
    // Last built first: one may hold what one built before it provides.
    for (let i = this.subsystems.length - 1; i >= 0; i -= 1) this.subsystems[i]?.dispose();
    this.subsystems.length = 0;
    this.physicsWorld?.dispose();
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
          if (listens(behaviour)) {
            const listening = this.listeners.get(entityId) ?? [];
            listening.push(behaviour);
            this.listeners.set(entityId, listening);
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

  /** Hands each side of the tick's events to its listeners, `a`'s side first. */
  private hear(events: readonly PhysicsEvent[]): void {
    for (const event of events) {
      this.tell(event, event.a, event.b.entity, 1);
      this.tell(event, event.b, event.a.entity, -1);
    }
  }

  /**
   * One side of an event, told to the behaviours on its collider's entity,
   * then to those on its body's when that is another: a cart hears its wheels,
   * and a wheel with a script of its own hears itself. `other` is the other
   * side's collider's entity, and `sign` turns the contact's normal, which
   * pushes `a`, into the one that pushes this side.
   *
   * Unguarded, as `update` is: a script's hook is guarded by its own behaviour.
   */
  private tell(event: PhysicsEvent, side: ColliderOwner, other: EntityId, sign: 1 | -1): void {
    const listening = [
      ...(this.listeners.get(side.entity) ?? []),
      ...(side.body === side.entity ? [] : (this.listeners.get(side.body) ?? [])),
    ];
    for (const behaviour of listening) {
      switch (event.kind) {
        case 'collisionEnter': {
          // A copy each, so no listener can change what the next one hears.
          const { point, normal, impulse } = event.contact;
          behaviour.onCollisionEnter?.(
            {
              other,
              point: { x: point.x, y: point.y, z: point.z },
              normal: { x: sign * normal.x, y: sign * normal.y, z: sign * normal.z },
              impulse,
            },
            this.context,
          );
          break;
        }
        case 'collisionExit':
          behaviour.onCollisionExit?.(other, this.context);
          break;
        case 'triggerEnter':
          behaviour.onTriggerEnter?.(other, this.context);
          break;
        case 'triggerExit':
          behaviour.onTriggerExit?.(other, this.context);
          break;
      }
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

/** What keeps a joint from doing its work, said as `checkPhysicsSetup` says it, or `null`. */
function jointProblem(scene: SceneDoc, entityId: EntityId, joint: JointComponent): string | null {
  const name = scene.entities.get(entityId)?.name;
  const other = joint.connectedEntity === null ? undefined : scene.entities.get(joint.connectedEntity)?.name;
  const ends = jointEnds(scene, entityId, joint);
  if (!ends.holds) {
    switch (ends.why) {
      case 'gone':
        return `"${name}" has a Joint whose Connected Body is not in this scene, so it holds nothing. Choose its Connected Body again, or World to hold it to the world.`;
      case 'noBody':
        return `"${name}" has a Joint but moves with no body, so it holds nothing. Add a Rigid Body to it or to an entity above it.`;
      case 'otherNoBody':
        return `"${name}"'s Joint is connected to "${other}", which moves with no body, so it holds nothing. Give "${other}" a Rigid Body or a Collider, or choose World to hold "${name}" to the world.`;
      case 'same':
        return `"${name}"'s Joint is connected to "${other}", which moves with the same body, so it holds nothing. Choose another Connected Body.`;
    }
  }
  // The world is not Dynamic, and two Fixed bodies joined are harmless to build.
  const dynamic = (bodyId: EntityId | null) =>
    bodyId !== null && findComponent(scene, bodyId, 'rigidbody')?.bodyType === 'dynamic';
  if (dynamic(ends.own) || dynamic(ends.other)) return null;
  return `"${name}"'s Joint holds no Dynamic body, so it moves nothing. Make the Rigid Body of "${scene.entities.get(ends.own)?.name}" or of what it is connected to Dynamic.`;
}
