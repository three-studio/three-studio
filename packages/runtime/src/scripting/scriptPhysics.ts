import { bodyOf, type SceneDoc } from '@three-studio/core';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  PhysicsApi,
  QuatLike,
  Vec3Like,
} from '../physics/PhysicsApi';

/**
 * `this.physics`: a behaviour's `PhysicsApi`, with one rule of its own.
 *
 * A script names entities, and an id here names the body that entity moves
 * with — its own Rigid Body, or the nearest one up the tree — so a script on a
 * wheel reaches its car. A behaviour asks for the body on an entity exactly,
 * and can walk the tree with `bodyOf` itself; a script cannot import it.
 */
export interface ScriptPhysics extends PhysicsApi {
  /** The body `entityId` moves with, or `null` when it moves with none. */
  body(entityId: string): BodyHandle | null;
  /** A character controller on the body `entityId` moves with, or `null` as `PhysicsApi`'s says. */
  createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
}

const ZERO: Readonly<Vec3Like> = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY: Readonly<QuatLike> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Built per script, as `audioApiFor` is. With no physics, it finds nothing. */
export function scriptPhysicsFor(physics: PhysicsApi | null, scene: SceneDoc): ScriptPhysics {
  // An entity with colliders and no Rigid Body on or above it is level
  // geometry, a fixed body of its own: `bodyOf` names none, and its own id does.
  const bodyEntity = (entityId: string) => bodyOf(scene, entityId) ?? entityId;
  return {
    gravity: physics?.gravity ?? ZERO,
    body: (entityId) => physics?.body(bodyEntity(entityId)) ?? null,
    createCharacterController: (entityId, settings) =>
      physics?.createCharacterController(bodyEntity(entityId), settings) ?? null,
    raycast: (origin, direction, maxDistance, options) =>
      physics?.raycast(origin, direction, maxDistance, options) ?? null,
  };
}

/**
 * `this.body` with no body behind it: at rest at the origin, unturned, weighing
 * nothing and disabled. Each write does nothing and calls `onWrite`.
 *
 * It speaks because a script pushing an entity with no body moved nothing and
 * threw nothing, and its author was left to guess why. A read stays silent:
 * zero is a true answer for a thing with no body.
 */
export function noBody(onWrite: (() => void) | null): BodyHandle {
  const wrote = () => onWrite?.();
  return {
    position: ZERO,
    rotation: IDENTITY,
    mass: 0,
    get enabled() {
      return false;
    },
    set enabled(_: boolean) {
      wrote();
    },
    get linearVelocity() {
      return ZERO;
    },
    set linearVelocity(_: Readonly<Vec3Like>) {
      wrote();
    },
    get angularVelocity() {
      return ZERO;
    },
    set angularVelocity(_: Readonly<Vec3Like>) {
      wrote();
    },
    addForce: wrote,
    applyImpulse: wrote,
    addTorque: wrote,
    applyTorqueImpulse: wrote,
    teleport: wrote,
  };
}
