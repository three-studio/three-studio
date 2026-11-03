import { bodyOf, type EntityDoc, type SceneDoc } from '@three-studio/core';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  PhysicsApi,
  QuatLike,
  QueryOptions,
  Vec3Like,
} from '../physics/PhysicsApi';

/**
 * `this.physics`: a behaviour's `PhysicsApi`, with one rule of its own.
 *
 * A script names entities, and an id here names the body that entity moves
 * with — its own Rigid Body, or the nearest one up the tree — so a script on a
 * wheel reaches its car. A behaviour asks for the body on an entity exactly,
 * and can walk the tree with `bodyOf` itself; a script cannot import it.
 *
 * Its queries leave out the body its entity moves with, whatever `exclude`
 * says: a turret's ray never stops at its tank.
 *
 * `joint` reads an id exactly, as the behaviour's does: the entity carrying
 * the Joint, as the Inspector shows it, which on a door's hinge is not the
 * body it moves with.
 */
export interface ScriptPhysics extends PhysicsApi {
  /** The body `entityId` moves with, or `null` when it moves with none. */
  body(entityId: string): BodyHandle | null;
  /** A character controller on the body `entityId` moves with, or `null` as `PhysicsApi`'s says. */
  createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
}

const ZERO: Readonly<Vec3Like> = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY: Readonly<QuatLike> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * Built per script, as `audioApiFor` is, for the entity it runs on. With no
 * physics, it finds nothing and says nothing.
 */
export function scriptPhysicsFor(
  physics: PhysicsApi | null,
  scene: SceneDoc,
  caller: EntityDoc,
  warn: (message: string) => void,
): ScriptPhysics {
  // An entity with colliders and no Rigid Body on or above it is level
  // geometry, a fixed body of its own: `bodyOf` names none, and its own id does.
  const bodyEntity = (entityId: string) => bodyOf(scene, entityId) ?? entityId;
  // Read once, as `this.body` is. An entity with no body leaves nothing out.
  const own = bodyEntity(caller.id);
  const layerIds = new Set(physics?.layers.map(({ id }) => id));
  const scoped = (options: QueryOptions | undefined): QueryOptions => {
    // A layer is named by its id, and its name is the mistake that will be
    // made: the query finds nothing, rightly, and nothing else would say why.
    // `warn` says each line once.
    for (const id of options?.layers ?? []) {
      if (!layerIds.has(id)) {
        warn(
          `"${caller.name}"'s script asked a query for the layer "${id}", which is not a layer id of this project, so the query sees nothing on it. A query names a layer by its id: find it by name in this.physics.layers.`,
        );
      }
    }
    return { ...options, exclude: own };
  };
  return {
    gravity: physics?.gravity ?? ZERO,
    layers: physics?.layers ?? [],
    body: (entityId) => physics?.body(bodyEntity(entityId)) ?? null,
    joint: (entityId) => physics?.joint(entityId) ?? null,
    createCharacterController: (entityId, settings) =>
      physics?.createCharacterController(bodyEntity(entityId), settings) ?? null,
    // With no physics, nothing is asked, and so nothing is said.
    raycast: (origin, direction, maxDistance, options) =>
      physics?.raycast(origin, direction, maxDistance, scoped(options)) ?? null,
    sphereCast: (origin, radius, direction, maxDistance, options) =>
      physics?.sphereCast(origin, radius, direction, maxDistance, scoped(options)) ?? null,
    boxCast: (origin, size, rotation, direction, maxDistance, options) =>
      physics?.boxCast(origin, size, rotation, direction, maxDistance, scoped(options)) ?? null,
    capsuleCast: (origin, radius, height, rotation, direction, maxDistance, options) =>
      physics?.capsuleCast(origin, radius, height, rotation, direction, maxDistance, scoped(options)) ?? null,
    overlapSphere: (center, radius, options) => physics?.overlapSphere(center, radius, scoped(options)) ?? [],
    overlapBox: (center, size, rotation, options) =>
      physics?.overlapBox(center, size, rotation, scoped(options)) ?? [],
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
