import type { ComponentDoc, ComponentType, EntityDoc, SceneDoc } from '@three-studio/core';
import type { Camera, Object3D } from 'three/webgpu';
import type { AudioEngine } from '../audio/AudioEngine';
import type { SceneBinder } from '../SceneBinder';
import type { Input } from '../input/Input';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StudioTime } from '../time/StudioTime';

/**
 * A scene being fetched.
 *
 * Declared here rather than beside `SceneHost` so a behaviour can hold one
 * without the engine depending on the thing that runs it — the host builds
 * engines, and an engine that imported the host would be a cycle.
 */
export interface SceneLoadHandle {
  readonly path: string;
  /** 0 to 1 across the assets the scene needs. */
  readonly progress: number;
  /** Settles when it could be shown. */
  readonly ready: Promise<void>;
  readonly activated: boolean;
  /** Shows it, waiting for `ready` first if it has to. */
  activate(): Promise<void>;
  cancel(): void;
}

/** Moving between scenes, from inside a script. */
export interface SceneApi {
  /**
   * The running scene's name, for a script that branches on where it is.
   *
   * The name is the indicative half of a scene's identity and can be changed
   * by whoever is using the editor; a script that must not break when it is
   * should hold the scene's id instead, which `load` and `go` also accept.
   */
  readonly current: string | null;
  /** Starts fetching, without showing. Poll `progress`, then `activate()`. */
  load(scene: string): SceneLoadHandle;
  /** Fetches and shows, for a transition with nothing to display meanwhile. */
  go(scene: string): Promise<void>;
}

/** What a behaviour is given access to. Deliberately narrow. */
export interface BehaviourContext {
  readonly scene: SceneDoc;
  readonly binder: SceneBinder;
  readonly physics: PhysicsWorld | null;
  readonly input: Input;
  /**
   * The one clock, shared with the shaders.
   *
   * `time.elapsed` is the same number every node material is reading, so a
   * script and the surface it animates cannot drift apart. Writing
   * `time.timescale` is how a script asks for slow motion; it slows the drawing
   * with the simulation, which is the whole point of there being one clock.
   */
  readonly time: StudioTime;
  /**
   * `null` when the engine is running on its own — the editor's Play used to,
   * and a test does. A script that changes scenes has to say what it wants to
   * happen then, rather than have one silently do nothing.
   */
  readonly scenes: SceneApi | null;
  /**
   * The mixer everything audible goes through.
   *
   * `null` when the host handed over no audio context — a test, or a browser
   * with no Web Audio. An audio behaviour asked to build itself against `null`
   * declines, so the component is inert rather than throwing once a frame.
   */
  readonly audio: AudioEngine | null;
  /** Surfaces a problem in the editor's game view. */
  warn: (message: string) => void;
}

/**
 * A component's runtime behaviour.
 *
 * Three phases, because they answer different questions:
 *
 *  - `update` runs once per displayed frame, for anything that must feel as
 *    responsive as the screen — aiming, input latching.
 *  - `fixedUpdate` runs once per physics tick. Anything that commands a body
 *    belongs here: a kinematic body takes a target position rather than an
 *    impulse, so issuing two targets between one step silently discards the
 *    first.
 *  - `postUpdate` runs after physics has resolved, which is where a camera has
 *    to be placed or it trails its subject by a frame.
 */
export interface Behaviour {
  /**
   * Runs once, after *every* behaviour in the scene has been constructed.
   *
   * Construction order follows the entity table, so a behaviour built early
   * cannot see one built later. Doing cross-references here instead removes
   * that ordering entirely — the same reason Unity separates Awake from Start.
   */
  start?: (ctx: BehaviourContext) => void;
  update?: (delta: number, ctx: BehaviourContext) => void;
  fixedUpdate?: (step: number, ctx: BehaviourContext) => void;
  postUpdate?: (ctx: BehaviourContext) => void;
  /** A camera the game should be rendered through, if this behaviour owns one. */
  readonly camera?: Camera;
  /** The scene is being left, while everything is still readable. */
  onSceneUnload?: () => void;
  dispose?: () => void;
}

export interface BehaviourTarget {
  readonly entity: EntityDoc;
  /** The bound object carrying the entity's transform. */
  readonly object: Object3D;
  readonly component: ComponentDoc;
}

export type BehaviourFactory = (
  target: BehaviourTarget,
  ctx: BehaviourContext,
) => Behaviour | null;

const factories = new Map<ComponentType, BehaviourFactory>();

/**
 * Registers the runtime behaviour for a component type.
 *
 * This is the seam that makes features into blocks: a vehicle controller, an
 * animator, an audio source and a user script are all "a component type plus a
 * factory", and none of them requires the engine loop to know they exist.
 */
export function registerBehaviour(type: ComponentType, factory: BehaviourFactory): void {
  factories.set(type, factory);
}

export function behaviourFactoryFor(type: ComponentType): BehaviourFactory | undefined {
  return factories.get(type);
}

/**
 * Every type that has a behaviour, so the engine can start from the component
 * tables rather than from the entity table.
 *
 * Two or three types out of eleven have one, and a scene has two thousand
 * entities: asking the registry which types matter and then reading those
 * tables visits the components that exist instead of every entity that might
 * have one.
 */
export function typesWithBehaviour(): readonly ComponentType[] {
  return [...factories.keys()];
}
