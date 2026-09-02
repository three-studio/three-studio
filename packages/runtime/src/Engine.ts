import {
  componentsOfType,
  entitiesWith,
  hasComponent,
  type MaterialDef,
  type PhysicsSettings,
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
import { SceneBinder } from './SceneBinder';
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
import { Input } from './input/Input';
import { PhysicsWorld } from './physics/PhysicsWorld';
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
   * The audio context this engine mixes into.
   *
   * Passed in rather than created, because it is shared: the editor's preview
   * uses the same one through its own root (ADR-4), a browser caps how many a
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
  /** Draws meshes that share a geometry and material in one call. On by default. */
  batching?: boolean;
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
 */
export class Engine {
  readonly scene = new Scene();
  readonly binder: SceneBinder;
  readonly input: Input;
  readonly physics: PhysicsWorld | null;
  /** `null` when the host handed over no context. */
  readonly audio: AudioEngine | null;

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

  private readonly fallbackCamera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  private readonly context: BehaviourContext;
  private documentCamera: Camera | null = null;
  private disposed = false;
  /** How many `audioListener` components the scene holds. Decides the fallback. */
  private listenerOwners = 0;

  private constructor(options: EngineOptions, physics: PhysicsWorld | null) {
    this.binder = new SceneBinder(options.resolver);
    this.input = new Input(options.domElement);
    this.physics = physics;

    // On for a running game, off in the editor: a batch is one object, so the
    // gizmo and the outline would have nothing per entity to attach to.
    this.binder.batching = options.batching ?? true;
    if (options.materials) this.binder.setMaterialLibrary(options.materials);
    this.scene.add(this.binder.root);
    this.binder.sync(options.scene);
    // Handed over rather than owned: this engine still neither draws nor holds
    // a frame loop. Capturing an analytic sky into a cubemap is the one thing
    // the binder cannot do as a transform over data, and it needs the device
    // the host already has.
    this.binder.renderer = options.renderer ?? null;
    this.binder.syncEnvironment(this.scene, options.scene);

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
    const colliders = entitiesWith(scene, 'collider');
    const players = entitiesWith(scene, 'playerController');

    // A mesh-derived collider on an entity with nothing to derive from falls
    // back to a box around an empty group — a few centimetres across, which
    // a player walks straight past. It happened for real: physics used to be
    // built before the glTF arrived. That is fixed, but a model that fails
    // to load reaches the same place, and silently.
    for (const entityId of colliders) {
      const entity = scene.entities[entityId];
      if (!entity) continue;
      const derived = Object.values(scene.components.collider[entityId] ?? {}).some(
        (component) => component.shape === 'trimesh' || component.shape === 'convexHull',
      );
      if (!derived) continue;

      const object = this.binder.getObject(entityId);
      let hasGeometry = false;
      object?.traverse((child) => {
        if ((child as { isMesh?: boolean }).isMesh === true) hasGeometry = true;
      });
      if (!hasGeometry) {
        this.warnings.push(
          `"${entity.name}" has a mesh-derived Collider but no geometry to derive it from, so it is a tiny box nothing can stand on. Check that its model loaded.`,
        );
      }
    }

    // Both halves are now driven by the table of the component that is *there*,
    // which is the whole shape of the check: something declares physics and is
    // missing its collider. It used to be a walk of every entity in the scene.
    for (const entityId of [...players, ...entitiesWith(scene, 'rigidbody')]) {
      const entity = scene.entities[entityId];
      if (!entity || hasComponent(scene, entityId, 'collider')) continue;
      this.warnings.push(
        hasComponent(scene, entityId, 'playerController')
          ? `"${entity.name}" has a Player Controller but no Collider, so it flies instead of walking. Add a Collider.`
          : `"${entity.name}" has a Rigid Body but no Collider, so nothing can touch it. Add a Collider.`,
      );
    }

    // A player's own capsule is not something to stand on, and counting it
    // was a false negative that hid the whole point of the check: a scene
    // whose only collider was the player's said nothing while the player fell
    // for ever.
    const hasGround = colliders.some((entityId) => !players.includes(entityId));
    const hasPlayer = players.length > 0;
    if (hasPlayer && !hasGround) {
      this.warnings.push(
        'Nothing but the player has a Collider, so there is no ground to stand on. Add a Collider to whatever the player should walk on.',
      );
    }
  }

  static async create(options: EngineOptions): Promise<Engine> {
    const physics =
      options.enablePhysics === false ? null : await PhysicsWorld.create(options.physicsSettings);
    const engine = new Engine(options, physics);

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

    if (this.physics) {
      this.physics.step(delta, (step) => {
        for (const behaviour of this.behaviours) behaviour.fixedUpdate?.(step, this.context);
      });
      this.physics.writeBack(this.binder);
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
   * better than a silent scene (ADR-9). With several, the first behaviour to
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
    this.input.dispose();
    this.audio?.dispose();
    this.physics?.dispose();
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

function unit(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, -1] : [x / length, y / length, z / length];
}
