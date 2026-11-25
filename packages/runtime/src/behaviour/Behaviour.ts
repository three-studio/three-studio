import type { ComponentDoc, ComponentType, EntityDoc } from '@three-studio/core';
import type { Camera, Object3D } from 'three/webgpu';
import type { Collision } from '../physics/PhysicsApi';
import type { World } from '../world/World';

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
 *
 * After each physics tick, four hooks hear what the entity's colliders, and
 * those of children riding its body, started or stopped touching in it. A
 * plugin hears collisions by being a behaviour on the entity.
 */
export interface Behaviour {
  /**
   * Runs once, after *every* behaviour in the scene has been constructed.
   *
   * Construction order follows the entity table, so a behaviour built early
   * cannot see one built later. Doing cross-references here instead removes
   * that ordering entirely — the same reason Unity separates Awake from Start.
   */
  start?: () => void;
  update?: (delta: number) => void;
  fixedUpdate?: (step: number) => void;
  postUpdate?: () => void;
  /**
   * One of this entity's colliders, or a collider of a child riding its body,
   * began touching another. Runs after the physics tick it happened in. A
   * collision needs a Dynamic body on one side: a Kinematic body, or a
   * character, meeting a wall is not one.
   */
  onCollisionEnter?: (collision: Collision) => void;
  /** They stopped touching. `other` names the entity whose Collider it was. */
  onCollisionExit?: (other: string) => void;
  /**
   * A sensor of this entity, or of a child riding its body, was entered — or
   * one of its colliders entered a sensor. A sensor sees anything that moves,
   * never another Fixed collider.
   */
  onTriggerEnter?: (other: string) => void;
  /** It left. */
  onTriggerExit?: (other: string) => void;
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

/**
 * The runtime behaviour of a component type: what the runtime's activation
 * registers.
 *
 * This is the seam that makes features into blocks: a vehicle controller, an
 * animator, an audio source and a user script are all "a component type plus a
 * factory", and none of them requires the world's loop to know they exist.
 */
export interface BehaviourDefinition {
  readonly id: ComponentType;
  /**
   * The behaviour for one component of the type, or `null` for one that
   * declines — an audio source with no audio engine to play through.
   *
   * Handed every component the world finds under `id`, and nothing else, so it
   * narrows `target.component` by its `type` and owes no cast. What it uses of
   * its world it reaches through that world: the document, `warn`, and each
   * subsystem's accessor — `physicsOf`, `inputOf`, `audioOf` —, all built
   * before any behaviour is.
   */
  create(target: BehaviourTarget, world: World): Behaviour | null;
}
