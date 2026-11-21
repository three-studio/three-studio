import { bodyOf, fixedId, isEntityId, type EntityDoc, type EntityId, type SceneDoc } from '@three-studio/core';
import type { ScriptMembersDefinition, ScriptSite } from '../scripting/members';
import type { Behaviour } from '../scripting/ScriptApi';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  Collision,
  PhysicsApi,
  QuatLike,
  QueryOptions,
  Touch,
  Vec3Like,
} from './PhysicsApi';
import { collisionsOf, physicsOf } from './physicsOf';

/*
 * What physics gives every script: `this.body`, `this.physics`, and four hooks
 * that hear what the entity's colliders touch. A contribution, installed by
 * the script host, which names no physics: the members are typed on every
 * `Behaviour` by the augmentation below, and published by the lines beside
 * them.
 */

/** Physics' members of a script. */
export interface PhysicsScriptMembers {
  /**
   * The body this entity moves with: its own Rigid Body, or the nearest one up
   * the tree — a wheel's is its car's. An entity with a Collider and no Rigid
   * Body on or above it is level geometry, a Fixed body of its own.
   *
   * There on every script. With no body behind it, it moves nothing, its reads
   * are zero, and its first change raises a warning. Forces, impulses and
   * velocities move a Dynamic body only.
   */
  readonly body: BodyHandle;
  /**
   * The physics world: gravity, any entity's body, the scene's joints,
   * character controllers, the project's collision layers, and rays, casts and
   * overlaps that leave out this entity's own body. Its ids name bodies as
   * `body` does, and a joint by the entity that carries it.
   */
  readonly physics: ScriptPhysics;
  /**
   * One of this entity's Colliders, or a child's riding its body, began
   * touching another, after the physics tick it happened in. One side needs a
   * Dynamic Rigid Body. `this.physics.body(collision.other)` is the body the
   * other moves with.
   */
  onCollisionEnter?(collision: Collision): void;
  /** They stopped touching. */
  onCollisionExit?(other: string): void;
  /** A sensor of this entity was entered, or this entity entered one. A sensor sees whatever moves. */
  onTriggerEnter?(other: string): void;
  /** It left. */
  onTriggerExit?(other: string): void;
}

declare module '../scripting/ScriptApi' {
  interface ScriptMembers extends PhysicsScriptMembers {}
}

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
  caller: Pick<EntityDoc, 'id' | 'name'>,
  warn: (message: string) => void,
): ScriptPhysics {
  // An entity with colliders and no Rigid Body on or above it is level
  // geometry, a fixed body of its own: `bodyOf` names none, and its own id does.
  const bodyEntity = (entityId: EntityId): EntityId => bodyOf(scene, entityId) ?? entityId;
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
    // The ids a script passes are text: one that is no id names no entity, and
    // is answered as an entity with nothing is.
    body: (entityId) => (isEntityId(entityId) ? physics?.body(bodyEntity(entityId)) ?? null : null),
    joint: (entityId) => (isEntityId(entityId) ? physics?.joint(entityId) ?? null : null),
    createCharacterController: (entityId, settings) =>
      isEntityId(entityId) ? physics?.createCharacterController(bodyEntity(entityId), settings) ?? null : null,
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

/**
 * Physics' lines of the published `Behaviour`, one entry per member above: a
 * member added there and not published here does not compile.
 */
const MEMBERS: Record<keyof PhysicsScriptMembers, string> = {
  body: `
    /**
     * The body this entity moves with: its own Rigid Body, or the nearest one above it — a
     * wheel's is its car's. With no body behind it, it moves nothing, and its first change
     * raises a warning.
     */
    readonly body: StudioBody;`,
  physics: `    /**
     * The physics world: gravity, any entity's body, the scene's joints, character controllers,
     * the project's collision layers, and rays, casts and overlaps that leave out this entity's
     * own body.
     */
    readonly physics: StudioPhysics;`,
  onCollisionEnter: `
    /**
     * A Collider of this entity, or of a child riding its body, began touching another, after
     * the physics tick it happened in. One side needs a Dynamic Rigid Body: a character walking
     * into a wall hears nothing.
     */
    onCollisionEnter?(collision: Collision): void;`,
  onCollisionExit: `    /** They stopped touching. \`other\` is the entity whose Collider it was. */
    onCollisionExit?(other: string): void;`,
  onTriggerEnter: `    /** A sensor of this entity was entered, or this entity entered one. A sensor sees whatever moves. */
    onTriggerEnter?(other: string): void;`,
  onTriggerExit: `    /** It left. */
    onTriggerExit?(other: string): void;`,
};

/** The types physics' lines name, as a script sees them: `Vec3Like` and `QuatLike` are the kernel's. */
const TYPES = `  /**
   * A body in the physics world, in world space: metres, seconds, kilograms, radians.
   *
   * Forces, impulses and velocities move a Dynamic body only: a Kinematic body is moved by
   * its transform, a Fixed one stays put, and a character's by its controller. A vector or
   * a rotation holding a NaN or an infinity is ignored, with the rest of the call.
   */
  export interface StudioBody {
    /** Where the solver holds it, as of the last physics tick. */
    readonly position: Readonly<Vec3Like>;
    /** How the solver has it turned, as of the last physics tick. */
    readonly rotation: Readonly<QuatLike>;
    /** In kilograms: its Rigid Body's Mass. */
    readonly mass: number;
    /** \`false\` holds it out of the world: it touches nothing, and nothing touches it, and its joints hold nothing. */
    enabled: boolean;
    /** Metres per second. Assign a whole vector: \`body.linearVelocity = { x: 0, y: 5, z: 0 }\`. */
    linearVelocity: Readonly<Vec3Like>;
    /** Radians per second, about the world's axes. */
    angularVelocity: Readonly<Vec3Like>;
    /** Pushes it through the next physics tick, in newtons; at a world point \`at\` it turns it too. Call it in onFixedUpdate to push steadily. */
    addForce(force: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
    /** A kick: changes its velocity at once by impulse / mass, in newton-seconds; at a world point \`at\` it turns it too. */
    applyImpulse(impulse: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
    /** Turns it through the next physics tick, in newton-metres. */
    addTorque(torque: Readonly<Vec3Like>): void;
    /** Changes its spin at once, in newton-metre-seconds. */
    applyTorqueImpulse(impulse: Readonly<Vec3Like>): void;
    /** Puts it, and its entity, there at once, keeping its velocities. Without a rotation it is moved, not turned. A joint holding it pulls it back: teleport what it is joined to as well. */
    teleport(position: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>): void;
  }

  /** A joint, as of the last physics tick. */
  export interface StudioJoint {
    /** How far it has moved since it was built: a hinge's angle in radians, right-handed about its axis, between -π and π; a slider's offset in metres. 0 for a Fixed or Spring joint. */
    readonly position: number;
    /** Whether its motor drives it. A Fixed or Spring joint has none. */
    motorEnabled: boolean;
    /** Radians per second for a hinge, metres per second for a slider. */
    motorSpeed: number;
    /** The most it pushes with: newton-metres for a hinge, newtons for a slider. */
    motorMaxForce: number;
  }

  /** How a character meets the world. Every number is yours: the Player Controller's are 0.02, 0.87 (50°), 0.4, 0.2 and 0.4. */
  export interface CharacterSettings {
    /** The gap kept between it and what it touches, in metres. Small, never zero. */
    readonly offset: number;
    /** The steepest slope it walks up, in radians. */
    readonly maxSlope: number;
    /** The highest step it walks onto, in metres. */
    readonly stepHeight: number;
    /** How much free floor a step needs on top, in metres. */
    readonly stepWidth: number;
    /** How far below its feet the ground still holds it while it is not rising, in metres. */
    readonly snapToGround: number;
  }

  /** A character its script moves. Its body is kinematic from the moment it is made. */
  export interface CharacterController {
    /** Moves it by up to \`translation\` this tick, sliding along what it meets, and turns it to \`rotation\`. Once per onFixedUpdate. Returns the part allowed. */
    move(translation: Readonly<Vec3Like>, rotation: Readonly<QuatLike>): Readonly<Vec3Like>;
    /** It stood on something after its last move, and was not leaving it. */
    readonly grounded: boolean;
  }

  /** The physics world. An entity's id names the body it moves with: its own Rigid Body, or the nearest one above it. */
  export interface StudioPhysics {
    /** The project's gravity, in m/s². */
    readonly gravity: Readonly<Vec3Like>;
    /** \`null\` when the entity moves with no body. */
    body(entityId: string): StudioBody | null;
    /** The Joint on that entity, exactly the one that carries it, or null when it carries none or holds nothing. */
    joint(entityId: string): StudioJoint | null;
    /** Takes the body: from then on only \`move\` moves it. \`null\` with no body, no Collider on the body's own entity, or a controller already there — a Player Controller's included. Once, in onStart. */
    createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
    /** The project's collision layers, Default first. A query names a layer by its id: find it here by its name. */
    readonly layers: readonly { readonly id: string; readonly name: string }[];
    /**
     * The nearest Collider along a ray, within maxDistance metres, or null. Leaves out this entity's own body, and
     * passes out of anything it starts inside. Sees the world as the last physics tick left it.
     */
    raycast(origin: Readonly<Vec3Like>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A ball swept from origin, its centre. As raycast. */
    sphereCast(origin: Readonly<Vec3Like>, radius: number, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A box of full size, turned by rotation, swept from origin, its centre. As raycast. */
    boxCast(origin: Readonly<Vec3Like>, size: Readonly<Vec3Like>, rotation: Readonly<QuatLike>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A capsule, its height from end to end along its own y, turned by rotation, swept from its centre. As raycast. */
    capsuleCast(origin: Readonly<Vec3Like>, radius: number, height: number, rotation: Readonly<QuatLike>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** The entities whose Colliders are in the ball or touch it, each once, but this entity's own body. */
    overlapSphere(center: Readonly<Vec3Like>, radius: number, filter?: QueryFilter): readonly string[];
    /** The same, for a box of full size, turned by rotation when one is given. */
    overlapBox(center: Readonly<Vec3Like>, size: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>, filter?: QueryFilter): readonly string[];
  }

  /** A collision that has just begun, as one side hears it. */
  export interface Collision {
    /** The entity whose Collider touched this one. this.physics.body(other) is the body it moves with. */
    readonly other: string;
    /** Where they touch, in world space: the middle of their contact points. */
    readonly point: Readonly<Vec3Like>;
    /** Unit, in world space: the way this side was pushed, away from the other. */
    readonly normal: Readonly<Vec3Like>;
    /** How hard they met, in newton-seconds: at least m·v for a body of mass m stopped from speed v. */
    readonly impulse: number;
  }

  /** What a query sees. Left out, every layer and no sensor. */
  export interface QueryFilter {
    /** Ids of the collision layers it sees: find one by its name in this.physics.layers. A Collider is seen by its own layer. */
    readonly layers?: readonly string[];
    /** Sensors too. Left out, a ray passes through a trigger zone. */
    readonly sensors?: boolean;
  }

  /** What a ray or a cast met first, in world space. */
  export interface RaycastHit {
    /** The entity whose Collider it met. this.physics.body(entity) is the body it moves with. */
    readonly entity: string;
    /** Where, on that Collider's surface. */
    readonly point: Readonly<Vec3Like>;
    /** Unit, out of that surface. */
    readonly normal: Readonly<Vec3Like>;
    /** How far it travelled to get there, in metres. */
    readonly distance: number;
  }`;

/**
 * Physics' contribution to every script: its body and the world's physics,
 * given before `onAwake`; and, for a script that defines any of the four
 * hooks, what its entity's colliders touch, heard on physics' channel after
 * the tick it happened in — its own colliders' and those of the children
 * riding its body, as physics publishes each side.
 */
export const physicsScriptMembers: ScriptMembersDefinition = {
  id: fixedId('scriptMembers', 'physics'),
  members: MEMBERS,
  types: TYPES,
  install(site) {
    const { script, entity, world } = site;
    const engine = physicsOf(world);
    const physics = scriptPhysicsFor(engine, world.document, entity, world.warn);
    const given: Pick<PhysicsScriptMembers, 'body' | 'physics'> = {
      // With physics off — a host that has none, which is a test — the
      // stand-in is silent: the line would be about the host, not the scene.
      body:
        physics.body(entity.id) ??
        noBody(
          engine &&
            (() =>
              world.warn(
                `"${entity.name}" has no Rigid Body, on it or above it, so what its script does to this.body moves nothing. Add a Rigid Body to it or to an entity above it.`,
              )),
        ),
      physics,
    };
    Object.assign(script, given);
    // A script that defines no hook is not listening: physics passes it by, and
    // never warns that it can hear nothing.
    const collisions = collisionsOf(world);
    if (collisions === null || !hearsCollisions(script)) return { dispose() {} };
    return collisions.listen(entity.id, (touch) => hear(site, touch));
  },
};

function hearsCollisions(script: Behaviour): boolean {
  return (
    script.onCollisionEnter !== undefined ||
    script.onCollisionExit !== undefined ||
    script.onTriggerEnter !== undefined ||
    script.onTriggerExit !== undefined
  );
}

/** What one side of a pair heard, told to the script on it through its guard. */
function hear(site: ScriptSite, touch: Touch): void {
  const { script } = site;
  switch (touch.kind) {
    case 'collisionEnter': {
      // A copy each: a script may keep what it is handed, or write to it, and
      // the next listener hears the contact as physics published it.
      const { other, point, normal, impulse } = touch.collision;
      site.run('onCollisionEnter', script.onCollisionEnter, {
        other,
        point: { x: point.x, y: point.y, z: point.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        impulse,
      });
      break;
    }
    case 'collisionExit':
      site.run('onCollisionExit', script.onCollisionExit, touch.other);
      break;
    case 'triggerEnter':
      site.run('onTriggerEnter', script.onTriggerEnter, touch.other);
      break;
    case 'triggerExit':
      site.run('onTriggerExit', script.onTriggerExit, touch.other);
      break;
  }
}
