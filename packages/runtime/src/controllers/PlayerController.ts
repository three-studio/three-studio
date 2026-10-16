import {
  colliderHalfHeight,
  findComponent,
  type ColliderComponent,
  type PlayerControllerComponent,
} from '@three-studio/core';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import {
  registerBehaviour,
  type Behaviour,
  type BehaviourContext,
  type BehaviourTarget,
} from '../behaviour/Behaviour';
import type { Input } from '../input/Input';
import { applyWorldTransform, type PhysicsWorld } from '../physics/PhysicsWorld';

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const JUMP = ['Space'];
const HALF_PI = Math.PI / 2;
/**
 * What the character falls at when there is no physics world to ask — fly mode,
 * and a test that builds one without Rapier.
 *
 * It was the only gravity this file had, written as `const GRAVITY = 9.81`
 * while every other body in the scene read `PhysicsSettings.gravity`. Changing
 * a project's gravity therefore moved everything except the player, and left
 * the jump — `v = sqrt(2gh)` — solving for the wrong planet. Now it is only the
 * fallback, and the name says which one it is.
 */
const EARTH_GRAVITY = 9.81;
/**
 * A small downward bias while grounded, so contact is never lost on a slope or
 * a seam between two colliders. Large values drive the capsule into the floor
 * faster than the controller can push it back out.
 */
const GROUNDED_STICK = -1;
/** Matches the value the physics world enables snap-to-ground with. */
const SNAP_DISTANCE = 0.4;

const _move = new Vector3();
const _forward = new Vector3();
const _right = new Vector3();
const _worldPosition = new Vector3();
const _quaternion = new Quaternion();
const _euler = new Euler(0, 0, 0, 'YXZ');

/**
 * Drives one entity as the player, in first person, third person or free flight.
 *
 * Movement goes through Rapier's kinematic character controller rather than a
 * dynamic body: a dynamic capsule tips over, slides down slopes and fights the
 * player for control. The controller resolves collisions but leaves the motion
 * exactly as commanded, which is what makes movement feel deliberate.
 */
export class PlayerController implements Behaviour {
  /**
   * Built in the constructor rather than initialised here, because a field
   * initialiser runs before the constructor body and so cannot read the
   * component whose `fov` it needs.
   */
  readonly camera: PerspectiveCamera;

  /**
   * Last movement request and what the solver allowed. Read by the editor when
   * diagnosing motion that does not match the configured speed — the gap
   * between the two is the whole story and is otherwise invisible.
   */
  readonly debug = { desiredX: 0, desiredZ: 0, computedX: 0, computedZ: 0, grounded: false };

  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private grounded = false;
  private jumpRequested = false;
  private orbitDistance: number;

  private readonly controller: RAPIER.KinematicCharacterController | null;
  private readonly collider: RAPIER.Collider | null;
  private readonly body: RAPIER.RigidBody | null;

  /**
   * Downward acceleration, in m/s², taken from the world this character moves
   * in so that changing a project's gravity moves the player with everything
   * else. Only the Y component: this is a Y-up walker, and a sideways gravity
   * is not something it could act on if it read one.
   */
  private readonly gravity: number;

  /**
   * How far the entity's origin sits above the character's feet.
   *
   * Physics centres a collider on its body, so the origin is the middle of the
   * capsule and `eyeHeight` — which reads as a height above the ground to
   * everyone who has ever typed a number into it — had to be measured from
   * there. Subtracting this is what lets the field mean what its name says.
   *
   * Read once, not per frame, and that is deliberate: `PhysicsWorld.build`
   * describes the collider once too, so a controller that tracked the component
   * live would drift away from the capsule it is supposed to sit on top of.
   *
   * Applied in every mode. Fly mode collides with nothing, so its feet are
   * notional — but an author switching between fly and FPS wants the same view,
   * not a camera that jumps by half a capsule.
   */
  private readonly feetOffset: number;

  constructor(
    private readonly component: PlayerControllerComponent,
    private readonly object: Object3D,
    physics: PhysicsWorld | null,
    entityId: string,
    /**
     * The entity's collider as the *document* describes it, not as Rapier built
     * it. The same component `PhysicsWorld` shapes the body from, and the same
     * one the scene migration measured, so all three agree on where the ground
     * is; asking Rapier instead would mean a shape-by-shape unpicking that a
     * triangle mesh has no answer to anyway.
     */
    colliderDoc: ColliderComponent | undefined,
  ) {
    this.orbitDistance = component.cameraDistance;
    this.camera = new PerspectiveCamera(component.fov, 16 / 9, 0.1, 5000);
    this.feetOffset = colliderDoc ? colliderHalfHeight(colliderDoc) : 0;

    object.getWorldQuaternion(_quaternion);
    _euler.setFromQuaternion(_quaternion);
    this.yaw = _euler.y;

    const entry = component.mode === 'fly' ? undefined : physics?.get(entityId);
    this.body = entry?.body ?? null;
    this.collider = entry?.collider ?? null;
    this.controller = this.collider && physics ? physics.createCharacterController() : null;
    this.gravity = physics ? -physics.world.gravity.y : EARTH_GRAVITY;

    // This behaviour writes the entity's transform itself, so the solver must
    // not copy the body back over it afterwards.
    physics?.claimTransform(entityId);
  }

  /** True when this controller is driven by the fixed physics step. */
  get usesPhysics(): boolean {
    return this.component.mode !== 'fly' && this.controller !== null && this.collider !== null;
  }

  /**
   * Asks for the on-screen controls, once every behaviour exists.
   *
   * Here rather than in the constructor because `Input` arrives with the
   * context, and here rather than in `Engine` because the sticks belong to the
   * thing they drive: a scene carrying no player controller shows none, and
   * nobody had to write that rule down. `enableTouch` is idempotent, so two
   * players in one scene still mean one set of joysticks.
   */
  start(ctx: BehaviourContext): void {
    ctx.input.enableTouch(this.component.touchControls, null);
  }

  /** Per display frame: aiming, which must stay as responsive as the screen. */
  update(delta: number, ctx: BehaviourContext): void {
    const input = ctx.input;
    this.look(delta, input);

    // Latched here rather than read in the fixed step: a short tap can fall
    // entirely between two physics ticks and would otherwise be swallowed.
    if (input.isAnyDown(...JUMP)) this.jumpRequested = true;

    if (!this.usesPhysics) this.moveFreely(delta, input);
  }

  /** Per physics tick: movement, so commands are not overwritten between steps. */
  fixedUpdate(step: number, ctx: BehaviourContext): void {
    if (this.usesPhysics) this.moveOnGround(step, ctx.input);
  }

  /** After physics has run, so the camera never trails the body by a frame. */
  postUpdate(): void {
    this.placeCamera();
  }

  private look(delta: number, input: Input): void {
    // The lock is what makes a mouse usable, not what makes aiming possible:
    // there is no pointer lock on a phone, and requiring it here left the
    // camera welded in place with a stick under the thumb doing nothing.
    if (!input.pointerLocked && !input.touchActive) return;

    /*
     * Two terms, because the two devices report different quantities.
     *
     * A mouse reports a **displacement** — so many pixels since the last frame
     * — which becomes an angle once, and must not be multiplied by the step or
     * a slow frame would turn further than a fast one for the same movement.
     *
     * A stick reports a **deflection** that persists: it is an angular rate,
     * and it has to be integrated over the frame or the turn would depend on
     * the frame rate instead of on the time held.
     */
    const mouse = input.consumeMouseDelta();
    const stick = input.lookAxis();
    const turn = this.component.touchLookSpeed * delta;

    this.yaw -= mouse.x * this.component.mouseSensitivity + stick.x * turn;
    this.pitch = MathUtils.clamp(
      // `+ stick.y` against `- mouse.y`: the stick's y points up where the
      // screen's points down, so pushing the thumb forward looks up.
      this.pitch - mouse.y * this.component.mouseSensitivity + stick.y * turn,
      -HALF_PI + 0.01,
      HALF_PI - 0.01,
    );

    if (this.component.mode === 'tps') {
      // The wheel pulls the third-person camera in and out, as in most games.
      const wheel = input.consumeWheel();
      if (wheel !== 0) {
        this.orbitDistance = MathUtils.clamp(this.orbitDistance + wheel * delta * 0.5, 1, 25);
      }
    }
  }

  /**
   * Horizontal input, expressed in the direction the camera is facing.
   *
   * **The returned length is the throttle**, and that is what makes a stick
   * analogue for free: `moveOnGround` multiplies each component by the speed
   * and the step, so a vector two fifths as long is two fifths of the speed
   * without a multiplication written anywhere. The keyboard goes on
   * normalising itself to 1 and goes on behaving exactly as it did.
   */
  private desiredDirection(input: Input): Vector3 {
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    _move.set(0, 0, 0);

    // The stick replaces the keyboard rather than adding to it. A hybrid
    // machine can have both, and summing them would let a player walk at 1.7×
    // by holding W with a thumb on the stick — which is the kind of thing that
    // is only ever discovered by someone speedrunning a level.
    const stick = input.moveAxis();
    if (stick.x !== 0 || stick.y !== 0) {
      return _move.addScaledVector(_forward, stick.y).addScaledVector(_right, stick.x);
    }

    if (input.isAnyDown(...FORWARD)) _move.add(_forward);
    if (input.isAnyDown(...BACK)) _move.sub(_forward);
    if (input.isAnyDown(...RIGHT)) _move.add(_right);
    if (input.isAnyDown(...LEFT)) _move.sub(_right);

    // Normalising stops diagonal movement being 1.41× faster than straight.
    if (_move.lengthSq() > 0) _move.normalize();
    return _move;
  }

  private speed(input: Input): number {
    const sprinting = input.isAnyDown(...SPRINT);
    return this.component.moveSpeed * (sprinting ? this.component.sprintMultiplier : 1);
  }

  private moveOnGround(delta: number, input: Input): void {
    const controller = this.controller;
    const collider = this.collider;
    const body = this.body;
    if (!controller || !collider || !body) return;

    const direction = this.desiredDirection(input);
    const speed = this.speed(input);

    // `&& this.verticalVelocity <= 0`, and without it a jump is five centimetres
    // high. Rapier answers `computedGrounded()` from the contact it found while
    // solving, so on the frame a jump is issued — the character is still
    // touching the floor when the solve begins — it comes back **true** even
    // though the movement was upward. The next tick then saw `grounded` and
    // overwrote the whole jump velocity with the stick, snap-to-ground was
    // re-enabled by that same negative velocity, and the character was pulled
    // straight back down. Measured: a 1.2 m jump reached 0.0497 m, which is
    // exactly one step of the initial velocity and nothing more.
    //
    // Asking about the velocity instead is what separates "standing on the
    // floor" from "leaving it", which is the question this branch was always
    // trying to ask. Landing still works: the descent is negative long before
    // the contact is reported.
    if (this.grounded && this.verticalVelocity <= 0) {
      this.verticalVelocity = GROUNDED_STICK;
      if (this.jumpRequested) {
        // v = sqrt(2gh) puts the apex exactly at the configured jump height.
        //
        // Clamped at zero because a world whose gravity does not pull down has
        // no apex to aim at, and `Math.sqrt` of a negative is `NaN` — which
        // would go straight into `setNextKinematicTranslation` and teleport the
        // body out of the world with nothing at all reported. Zero is the
        // honest answer there: without a pull, you cannot jump to a height.
        this.verticalVelocity = Math.sqrt(2 * Math.max(this.gravity, 0) * this.component.jumpHeight);
      }
    } else {
      this.verticalVelocity -= this.gravity * delta;
    }
    this.jumpRequested = false;

    // Snap-to-ground is what stops a character hopping down slopes, but it also
    // drags it straight back to the floor the instant it leaves — which turns a
    // jump into a stutter a few centimetres high. It has to be off while rising.
    if (this.verticalVelocity > 0) controller.disableSnapToGround();
    else controller.enableSnapToGround(SNAP_DISTANCE);

    const desired = {
      x: direction.x * speed * delta,
      y: this.verticalVelocity * delta,
      z: direction.z * speed * delta,
    };

    controller.computeColliderMovement(collider, desired);
    this.grounded = controller.computedGrounded();

    const movement = controller.computedMovement();
    this.debug.desiredX = desired.x;
    this.debug.desiredZ = desired.z;
    this.debug.computedX = movement.x;
    this.debug.computedZ = movement.z;
    this.debug.grounded = this.grounded;

    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });

    _worldPosition.set(current.x + movement.x, current.y + movement.y, current.z + movement.z);
    // Third person turns the body to face travel; first person turns it with
    // the camera so anything parented to the player points the right way.
    const facing =
      this.component.mode === 'tps' && direction.lengthSq() > 0
        ? Math.atan2(direction.x, direction.z)
        : this.yaw;
    _quaternion.setFromEuler(_euler.set(0, facing, 0));
    applyWorldTransform(this.object, _worldPosition, _quaternion);
  }

  /** Fly mode, and the fallback when an entity has no collider to move with. */
  private moveFreely(delta: number, input: Input): void {
    const direction = this.desiredDirection(input);
    const speed = this.speed(input);

    this.object.getWorldPosition(_worldPosition);
    _worldPosition.addScaledVector(direction, speed * delta);
    if (input.isAnyDown(...JUMP)) _worldPosition.y += speed * delta;
    if (input.isDown('ControlLeft')) _worldPosition.y -= speed * delta;

    _quaternion.setFromEuler(_euler.set(0, this.yaw, 0));
    applyWorldTransform(this.object, _worldPosition, _quaternion);
  }

  /** Where the eye sits: `eyeHeight` above the feet, in world space. */
  private get eyeY(): number {
    return _worldPosition.y - this.feetOffset + this.component.eyeHeight;
  }

  private placeCamera(): void {
    this.object.getWorldPosition(_worldPosition);
    // Followed live, unlike the feet: nothing downstream depends on the field
    // of view staying put, and every other number this component carries —
    // speed, jump height, sensitivity — is already read fresh each frame.
    if (this.camera.fov !== this.component.fov) {
      this.camera.fov = this.component.fov;
      this.camera.updateProjectionMatrix();
    }

    if (this.component.mode === 'tps') {
      // Orbit behind the character, using the same yaw and pitch as the look.
      const horizontal = Math.cos(this.pitch) * this.orbitDistance;
      const eyeY = this.eyeY;
      this.camera.position.set(
        _worldPosition.x + Math.sin(this.yaw) * horizontal,
        eyeY + Math.sin(-this.pitch) * this.orbitDistance,
        _worldPosition.z + Math.cos(this.yaw) * horizontal,
      );
      this.camera.lookAt(_worldPosition.x, eyeY, _worldPosition.z);
      return;
    }

    this.camera.position.set(_worldPosition.x, this.eyeY, _worldPosition.z);
    this.camera.quaternion.setFromEuler(_euler.set(this.pitch, this.yaw, 0));
  }
}

registerBehaviour('playerController', (target: BehaviourTarget, ctx: BehaviourContext) => {
  if (target.component.type !== 'playerController') return null;
  return new PlayerController(
    target.component,
    target.object,
    ctx.physics,
    target.entity.id,
    // The entity's first collider, by the same lookup `PhysicsWorld.build` uses
    // to decide what shape to give the body — so an entity carrying two cannot
    // have the camera measuring from one and the capsule built from the other.
    findComponent(ctx.scene, target.entity.id, 'collider'),
  );
});
