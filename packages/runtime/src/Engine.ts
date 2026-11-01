import {
  colliderGeometry,
  componentsOfType,
  createPhysicsSettings,
  entitiesWith,
  findComponent,
  hasComponent,
  physicsBodies,
  type MaterialDef,
  type PhysicsSettings,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import {
  PerspectiveCamera,
  Scene,
  type Camera,
  type OrthographicCamera,
  type Object3D,
  type Renderer,
} from 'three/webgpu';
import { SceneBinder, bindScene } from './SceneBinder';
import type { AssetResolver } from './assets/AssetResolver';
import { AudioEngine } from './audio/AudioEngine';
import type { AudioClipCache } from './audio/AudioClipCache';
import type { AudioContextLike } from './audio/AudioContextLike';
import {
  behaviourFactoryFor,
  typesWithBehaviour,
  type Behaviour,
  type BehaviourContext,
} from './behaviour/Behaviour';
// Importing a controller registers it. Adding a vehicle, an animator or an
// audio source is one more import here plus its own `registerBehaviour` call —
// the loop below never learns that any of them exist.
import './behaviour/audio';
import './controllers/PlayerController';
import './scripting/ScriptHost';
import { Input, type InputOptions } from './input/Input';
import type { PhysicsApi } from './physics/PhysicsApi';
import { PhysicsWorld, type ColliderOwner, type PhysicsEvent } from './physics/PhysicsWorld';
import { ownMeshes } from './physics/meshShape';
import { studioTime } from './time/StudioTime';
import type { SceneApi } from './behaviour/Behaviour';

export interface EngineOptions {
  scene: SceneDoc;
  resolver: AssetResolver;
  /**
   * Shared materials by asset id.
   *
   * Passed in rather than fetched, and before the first sync: a mesh is built
   * synchronously, so a material that arrived later would have to rebuild it.
   * Omitting this makes every linked material fall back to the embedded one —
   * which is exactly what play mode was doing before it was passed.
   */
  materials?: Readonly<Record<string, MaterialDef>>;
  /** Gravity and the solver's step. Defaults when the project has none. */
  physicsSettings?: PhysicsSettings;
  /** Receives input and takes pointer lock; normally the render canvas. */
  domElement: HTMLElement;
  /**
   * How the game's `Input` listens. Omitted, keys are heard window-wide, which
   * is the exported player's choice; the editor hears them on `domElement`
   * alone, so that a key typed in one of its panels never reaches the game.
   */
  input?: InputOptions;
  /**
   * The audio context this engine mixes into.
   *
   * Passed in rather than created, because it is shared: the editor's preview
   * uses the same one through its own root, a browser caps how many a
   * page may have, and each one needs its own user gesture before it makes a
   * sound. Omitting it is a game with no audio, which is what a test wants and
   * what a browser without Web Audio gets.
   */
  audioContext?: AudioContextLike;
  /**
   * A decoded-clip cache to share with the engines that come after this one.
   *
   * `SceneHost` owns it, so a sound the last level used is still in hand when
   * the next one asks for it.
   */
  audioCache?: AudioClipCache;
  /**
   * The device an analytic sky is captured on.
   *
   * Not what draws this engine — the host still calls `update` and renders
   * `engine.scene` itself. It is here because a scene whose background is the
   * procedural sky needs that sky turned into a cubemap before anything can be
   * lit by it, and a cubemap is six draw calls. Omitting it leaves such a scene
   * on its background colour, unlit, rather than failing.
   */
  renderer?: Renderer | null;
  enablePhysics?: boolean;
  /**
   * The project's rendering settings.
   *
   * Required, and that is the point of it: it used to be absent entirely, so an
   * engine answered `shadowMapSize` with the binder's own 2048 whatever the
   * project said, and answered `batching` with a default of its own that
   * happened to match the editor's. Being required means the three modes — the
   * edit view, Play, and an exported build — cannot each quietly answer this
   * for themselves; `npm run typecheck` names any that tries.
   */
  rendering: RenderingSettings;
  /**
   * Lets scripts move to another scene. Supplied by whatever is hosting this
   * engine; an engine built on its own does not have a next scene to go to.
   */
  scenes?: SceneApi | null;
}

/**
 * A running game, built from a scene document.
 *
 * The engine owns the scene graph, physics and controllers, but neither the
 * renderer nor the frame loop — the host calls `update(delta)` and draws
 * `engine.scene` through `engine.activeCamera`. That is what lets the editor
 * play a scene inside its own viewport while an exported build runs the exact
 * same code from a bare `requestAnimationFrame`.
 *
 * **Where post-processing would enter, and why nothing in here moves for it.**
 * There is no composer anywhere in this runtime, and no seam waiting to receive
 * one — the seam is the paragraph above. three's `RenderPipeline` is built out
 * of `pass(scene, camera)`, which is exactly the pair this class already hands
 * out, so a host trades its one `renderer.render(engine.scene,
 * engine.activeCamera)` for `pipeline.render()` and the engine never learns
 * that anything changed. There are two such lines in the whole product:
 * `EditorViewport.draw` and the player's loop in `apps/web-template/src/main.ts`.
 * Neither the renderer nor the frame was ever the engine's, so neither has to
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
 * right: the same shape of divergence that `EngineOptions.rendering` was made
 * required to end.
 */
export class Engine {
  readonly scene = new Scene();
  readonly binder: SceneBinder;
  readonly input: Input;
  /**
   * Physics as the behaviours see it, `null` with physics off.
   *
   * The world's lifecycle stays private, so no host can step it out of turn or
   * free it a second time, which throws.
   */
  readonly physics: PhysicsApi | null;
  /** `null` when the host handed over no context. */
  readonly audio: AudioEngine | null;
  /**
   * One tick, in seconds: the project's fixed step.
   *
   * What a host advances `update` by to move the game exactly one tick, as the
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

  /** Exposed for diagnostics; drive them through `update`, not directly. */
  readonly behaviours: Behaviour[] = [];
  /** The behaviours that hear what colliders touch, by the entity each sits on. */
  private readonly listeners = new Map<string, Behaviour[]>();

  private readonly fallbackCamera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  private readonly world: PhysicsWorld | null;
  private readonly context: BehaviourContext;
  private documentCamera: Camera | null = null;
  private disposed = false;
  /** How many `audioListener` components the scene holds. Decides the fallback. */
  private listenerOwners = 0;

  private constructor(
    options: EngineOptions,
    physicsSettings: PhysicsSettings,
    physics: PhysicsWorld | null,
  ) {
    // The renderer is handed over rather than owned: this engine still neither
    // draws nor holds a frame loop. Capturing an analytic sky into a cubemap is
    // the one thing the binder cannot do as a transform over data, and it needs
    // the device the host already has. The order of the rest is `bindScene`'s,
    // where it is written down.
    this.binder = bindScene(this.scene, options.scene, {
      resolver: options.resolver,
      rendering: options.rendering,
      materials: options.materials,
      renderer: options.renderer,
    });
    this.input = new Input(options.domElement, options.input);
    this.world = physics;
    this.physics = physics;
    this.fixedStep = physicsSettings.fixedTimestep;

    this.audio =
      options.audioContext === undefined
        ? null
        : new AudioEngine({
            context: options.audioContext,
            resolver: options.resolver,
            cache: options.audioCache,
            onWarning: (message) => this.context.warn(message),
          });

    this.context = {
      scene: options.scene,
      binder: this.binder,
      physics,
      input: this.input,
      time: studioTime,
      scenes: options.scenes ?? null,
      audio: this.audio,
      warn: (message) => {
        // Repeats are dropped: a warning raised per frame would otherwise fill
        // the panel with one line per tick.
        if (this.warnings.includes(message)) return;
        this.warnings.push(message);
        this.onWarning?.([...this.warnings]);
      },
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
  private checkPhysicsSetup(scene: SceneDoc): void {
    // Over the bodies the world builds, so the two cannot disagree: a body
    // whose colliders are on its children was warned about as having none.
    const bodies = physicsBodies(scene);
    const players = new Set(entitiesWith(scene, 'playerController'));
    // Which body each collider rides: the one whose type it is built for.
    const riding = new Map<string, string>();
    for (const [body, carried] of bodies) {
      for (const entityId of carried) riding.set(entityId, body);
    }
    // Through the context, as every warning is, so a line is said once.
    const { warn } = this.context;

    // A mesh-derived collider on an entity with nothing to derive from falls
    // back to a box 2 cm across, which a player walks straight past. It
    // happened for real: physics used to be built before the glTF arrived.
    // That is fixed, but a model that fails to load reaches the same place,
    // and silently.
    for (const [entityId, bodyId] of riding) {
      const entity = scene.entities[entityId];
      if (!entity) continue;
      const meshes = Object.values(scene.components.collider[entityId] ?? {}).filter(
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
          bodyId === entityId ? 'its Rigid Body' : `the Rigid Body of "${scene.entities[bodyId]?.name}"`;
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
      const entity = scene.entities[entityId];
      if (!entity || carried.length > 0 || players.has(entityId)) continue;
      warn(
        `"${entity.name}" has a Rigid Body but no Collider, on it or on a child without a body of its own, so nothing can touch it. Add a Collider.`,
      );
    }
    // Its own: a character sweeps its entity's collider, never one riding its
    // body from a child.
    for (const entityId of players) {
      const entity = scene.entities[entityId];
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
    }

    // A behaviour hears through its entity's colliders, or a body's through
    // those of the children riding it: on an entity with neither it hears
    // nothing, and nothing says why. A Rigid Body with no collider anywhere is
    // said above. With physics off the line would be about the host, not the
    // scene.
    for (const entityId of this.world ? this.listeners.keys() : []) {
      const entity = scene.entities[entityId];
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

  static async create(options: EngineOptions): Promise<Engine> {
    // Resolved once, so the world ticks by the step the engine tells its host.
    const physicsSettings = options.physicsSettings ?? createPhysicsSettings();
    const physics =
      options.enablePhysics === false ? null : await PhysicsWorld.create(physicsSettings);
    const engine = new Engine(options, physicsSettings, physics);

    // Order matters, and each step needs the one before it:
    //
    //   models    a collider derived from a mesh needs the mesh, and a glTF
    //             arrives well after `sync` returns — building physics first
    //             gave an imported level a box around an empty group, which
    //             the player fell straight through;
    //   physics   a behaviour looks its rigid body up when it is constructed,
    //             so a controller built earlier would find none and fly.
    await engine.binder.whenLoaded();
    physics?.build(options.scene, engine.binder);
    engine.buildBehaviours(options.scene);
    engine.pickCamera(options.scene);
    engine.checkPhysicsSetup(options.scene);
    engine.checkAudioSetup(options.scene);
    engine.checkLighting(options.scene);

    return engine;
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

  update(delta: number): void {
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

    if (this.world) {
      this.world.step(
        delta,
        (step) => {
          for (const behaviour of this.behaviours) behaviour.fixedUpdate?.(step, this.context);
        },
        // After the tick they happened in and before the next one's
        // `fixedUpdate`, as Unity runs its collision messages.
        (events) => this.hear(events),
      );
      this.world.writeBack();
    }

    for (const behaviour of this.behaviours) behaviour.postUpdate?.(this.context);

    // After `postUpdate`, so a listener that rides the player is read at the
    // position the player ended the frame at, and the fallback below sees the
    // camera where it actually is.
    if (this.audio) {
      if (this.listenerOwners === 0) this.writeListenerFromCamera();
      this.audio.update();
    }

    // Last, once everything that moves has moved: a batch reads its members'
    // world matrices, and reading them before physics wrote back would draw
    // every batched object one frame behind.
    this.binder.updateBatches();
  }

  /**
   * Counts the ears, and says when a scene has the wrong number of them.
   *
   * The count is also what decides the fallback: with no `audioListener`
   * anywhere the engine places the ear on whatever camera the game is rendered
   * through, which is right far more often than it is wrong and is very much
   * better than a silent scene. With several, the first behaviour to
   * write each frame wins, and saying so is the whole value of the warning —
   * two ears is a bug that sounds like a mixing problem.
   */
  private checkAudioSetup(scene: SceneDoc): void {
    if (this.audio === null) return;
    this.listenerOwners = entitiesWith(scene, 'audioListener').length;
    if (this.listenerOwners > 1) {
      this.context.warn(
        `${this.listenerOwners} entities carry an Audio Listener; only one ear is placed and the others are ignored.`,
      );
    }
  }

  /** The ear on the camera, for a scene that never named one. */
  private writeListenerFromCamera(): void {
    const camera = this.activeCamera;
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    this.audio?.setListener(
      [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0],
      // A camera looks down its own −Z, which is also what the audio side means
      // by forward — see `behaviour/audio.ts`.
      unit(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)),
      unit(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0),
    );
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
    this.disposed = true;
    for (const behaviour of this.behaviours) behaviour.dispose?.();
    this.behaviours.length = 0;
    this.listeners.clear();
    this.input.dispose();
    this.audio?.dispose();
    this.world?.dispose();
    this.binder.dispose();
    this.scene.clear();
  }

  /**
   * Instantiates a behaviour for every component that has one registered.
   *
   * The engine deliberately does not name any component type here. A new kind
   * of controller is a registration, not an edit to this loop.
   */
  private buildBehaviours(scene: SceneDoc): void {
    let cameraOwners = 0;

    // Driven by the registry and then by the tables of the types it names: a
    // scene of two thousand props with one player controller in it visits one
    // entity. It used to walk them all, and every component of each.
    for (const type of typesWithBehaviour()) {
      const factory = behaviourFactoryFor(type);
      if (!factory) continue;

      for (const [entityId, held] of Object.entries(componentsOfType(scene, type))) {
        const entity = scene.entities[entityId];
        const object = this.binder.getObject(entityId);
        if (!entity || !object) continue;

        for (const component of Object.values(held)) {
          const behaviour = factory({ entity, object, component }, this.context);
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
  private tell(event: PhysicsEvent, side: ColliderOwner, other: string, sign: 1 | -1): void {
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
  return (camera as PerspectiveCamera).isPerspectiveCamera === true;
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

function unit(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, -1] : [x / length, y / length, z / length];
}
