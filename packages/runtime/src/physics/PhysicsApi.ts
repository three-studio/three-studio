/*
 * Physics as a behaviour sees it.
 *
 * Types only, importing nothing: a behaviour, a plugin's included, names
 * physics through this file without reaching Rapier or the world that holds
 * it. Only `physics/` knows the engine underneath, so changing engines one day
 * rewrites that folder and nothing else.
 *
 * Plain values cross it, and what comes out is a copy: writing
 * `body.position.x = 3` would move nothing, so the types refuse it.
 */

/** A point or a displacement, in metres. three's `Vector3` is one. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A rotation. three's `Quaternion` is one. */
export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * `BehaviourContext.physics`: the world as a behaviour may touch it.
 *
 * No fixed step here: a behaviour is handed the tick as `fixedUpdate`'s
 * argument, and a host reads `Engine.fixedStep`.
 */
export interface PhysicsApi {
  /** The project's gravity, in m/s². */
  readonly gravity: Readonly<Vec3Like>;
  /** The entity's body, or `null` when it carries none. */
  body(entityId: string): BodyHandle | null;
  /**
   * A character controller for the entity, built with the caller's settings.
   *
   * It takes the entity's body: from then on only `move` moves it, and the
   * world writes it to the entity after each step. It sweeps the entity's own
   * first collider; whatever else rides the body follows it. `null` when the
   * entity has no body, no collider of its own, or a controller already: a body
   * has one driver.
   */
  createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
  /**
   * The nearest Collider along a ray, within `maxDistance` metres, or `null`.
   * `direction` need not be unit.
   *
   * A query sees the world as the last physics tick left it, from the moment
   * the world is built: a body moved since — by a script, a teleport, its
   * controller — is found where it was. A ray passes out of whatever it starts
   * inside. A point or a distance that is not a number, or a direction of zero,
   * finds nothing.
   */
  raycast(
    origin: Readonly<Vec3Like>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options?: QueryOptions,
  ): RaycastHit | null;
}

/** What a query leaves out. */
export interface QueryOptions {
  /**
   * The entity whose body is left out, every collider of it: the body on that
   * entity exactly, as `body` reads an id. The caller's own, usually.
   */
  readonly exclude?: string;
}

/** What a ray met first, in world space. */
export interface RaycastHit {
  /**
   * The entity whose Collider it met. A script's `this.physics.body(entity)`
   * is the body it moves with; a behaviour's `physics.body` is exact, so a
   * behaviour reads `bodyOf(scene, entity) ?? entity` first.
   */
  readonly entity: string;
  /** Where, on that Collider's surface. */
  readonly point: Readonly<Vec3Like>;
  /** Unit, out of that surface. */
  readonly normal: Readonly<Vec3Like>;
  /** How far it travelled to get there from its origin, in metres. */
  readonly distance: number;
}

/**
 * A collision that has just begun, as one side hears it: whom it met, where,
 * which way it was pushed, and how hard. In world space: metres and
 * newton-seconds.
 */
export interface Collision {
  /**
   * The entity whose Collider touched this side's. A script's
   * `this.physics.body(other)` is the body it moves with; a behaviour's
   * `physics.body` is exact, so a behaviour reads `bodyOf(scene, other) ?? other`
   * first.
   */
  readonly other: string;
  /** Where they touch: the middle of their contact points. A box landing flat touches at its face's centre. */
  readonly point: Readonly<Vec3Like>;
  /** Unit: the way this side was pushed, away from the other. A ball landing on the ground hears up; the ground, down. */
  readonly normal: Readonly<Vec3Like>;
  /**
   * How hard they met: the impulse that held them apart in the tick they
   * touched, at least m·v for a body of mass m stopped from speed v.
   */
  readonly impulse: number;
}

/**
 * A body in the world, in world space: metres, seconds, kilograms, radians.
 *
 * A vector or a rotation holding a NaN or an infinity is ignored, and the rest
 * of the call with it: Rapier keeps whatever it is handed, and one bad
 * division in a script would otherwise leave the body nowhere for good. A
 * rotation is made unit length.
 */
export interface BodyHandle {
  /** Where the solver holds the body, in world space, as of the last step. */
  readonly position: Readonly<Vec3Like>;
  /** How the solver has the body turned, as of the last step. */
  readonly rotation: Readonly<QuatLike>;
  /**
   * `false` holds the body out of the world: it touches nothing and nothing
   * touches it. The world also stops writing it to its entity, so whoever
   * disabled the body places the entity. Enabled again, the body is put where
   * its entity then is, unless it is fixed.
   */
  enabled: boolean;
  /**
   * What the body weighs, in kilograms: its Rigid Body's Mass, shared by its
   * colliders. Only a dynamic body's is felt.
   */
  readonly mass: number;
  /**
   * In metres per second. Written, it is set on a Dynamic body. Any other is
   * moved by what drives it, and reads the speed that gives it: a Kinematic
   * body its transform's, a character its controller's.
   */
  linearVelocity: Readonly<Vec3Like>;
  /** In radians per second, about the world's axes. As `linearVelocity`. */
  angularVelocity: Readonly<Vec3Like>;
  /**
   * Pushes a Dynamic body, in newtons, through the next tick only: added in
   * every `fixedUpdate`, it pushes steadily. At a world point `at`, it turns
   * the body too.
   *
   * Added in `update`, it waits for the frame's first tick, and a frame with
   * none leaves it to add to the next frame's.
   */
  addForce(force: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
  /**
   * A kick: changes a Dynamic body's velocity at once, by `impulse / mass`,
   * in newton-seconds. At a world point `at`, it turns the body too.
   */
  applyImpulse(impulse: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
  /** Turns a Dynamic body, in newton-metres about the world's axes, through the next tick only. */
  addTorque(torque: Readonly<Vec3Like>): void;
  /** Changes a Dynamic body's spin at once, in newton-metre-seconds. */
  applyTorqueImpulse(impulse: Readonly<Vec3Like>): void;
  /**
   * Puts the body and its entity there at once, whatever drives it, keeping
   * its velocities. Without a rotation, it is moved and not turned. A
   * Kinematic body stays where it is put; a Fixed one takes its colliders with
   * it.
   */
  teleport(position: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>): void;
}

export interface CharacterController {
  /**
   * Moves the character by up to `translation` this tick, sliding along what
   * it meets, and turns its body to `rotation`.
   *
   * Call it from `fixedUpdate`, once per tick: the result is the body's target
   * for the next step, and a second call before that step replaces the first.
   * A translation that is not a number moves nothing, and a rotation with no
   * direction keeps the body's turn.
   *
   * @returns the part of `translation` the world allowed.
   */
  move(translation: Readonly<Vec3Like>, rotation: Readonly<QuatLike>): Readonly<Vec3Like>;
  /** Whether the character stood on something after the last move, and was not leaving it. */
  readonly grounded: boolean;
}

/** How a character meets the world. Every number is the caller's: the world holds none. */
export interface CharacterSettings {
  /** The gap kept between the character and what it touches, in metres. Small, never zero. */
  readonly offset: number;
  /** The steepest slope it walks up, in radians. */
  readonly maxSlope: number;
  /** The highest step it walks onto, in metres. */
  readonly stepHeight: number;
  /** How much free floor a step needs on top for the character to take it, in metres. */
  readonly stepWidth: number;
  /** How far below its feet the ground still holds it while it is not rising, in metres. */
  readonly snapToGround: number;
}
