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
   * world writes it to the entity after each step. `null` when the entity has
   * no body or no collider.
   */
  createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
}

export interface BodyHandle {
  /** Where the solver holds the body, in world space, as of the last step. */
  readonly position: Readonly<Vec3Like>;
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
}

export interface CharacterController {
  /**
   * Moves the character by up to `translation` this tick, sliding along what
   * it meets, and turns its body to `rotation`.
   *
   * Call it from `fixedUpdate`, once per tick: the result is the body's target
   * for the next step, and a second call before that step replaces the first.
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
