import type { PlayerControllerComponent } from '@three-studio/core';
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
const GRAVITY = 9.81;
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
  readonly camera = new PerspectiveCamera(70, 16 / 9, 0.1, 5000);

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

  constructor(
    private readonly component: PlayerControllerComponent,
    private readonly object: Object3D,
    physics: PhysicsWorld | null,
    entityId: string,
  ) {
    this.orbitDistance = component.cameraDistance;

    object.getWorldQuaternion(_quaternion);
    _euler.setFromQuaternion(_quaternion);
    this.yaw = _euler.y;

    const entry = component.mode === 'fly' ? undefined : physics?.get(entityId);
    this.body = entry?.body ?? null;
    this.collider = entry?.collider ?? null;
    this.controller = this.collider && physics ? physics.createCharacterController() : null;

    // This behaviour writes the entity's transform itself, so the solver must
    // not copy the body back over it afterwards.
    physics?.claimTransform(entityId);
  }

  /** True when this controller is driven by the fixed physics step. */
  get usesPhysics(): boolean {
    return this.component.mode !== 'fly' && this.controller !== null && this.collider !== null;
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
    if (!input.pointerLocked) return;

    const mouse = input.consumeMouseDelta();
    this.yaw -= mouse.x * this.component.mouseSensitivity;
    this.pitch = MathUtils.clamp(
      this.pitch - mouse.y * this.component.mouseSensitivity,
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

  /** Horizontal input, expressed in the direction the camera is facing. */
  private desiredDirection(input: Input): Vector3 {
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    _move.set(0, 0, 0);
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

    if (this.grounded) {
      this.verticalVelocity = GROUNDED_STICK;
      if (this.jumpRequested) {
        // v = sqrt(2gh) puts the apex exactly at the configured jump height.
        this.verticalVelocity = Math.sqrt(2 * GRAVITY * this.component.jumpHeight);
      }
    } else {
      this.verticalVelocity -= GRAVITY * delta;
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

  private placeCamera(): void {
    this.object.getWorldPosition(_worldPosition);

    if (this.component.mode === 'tps') {
      // Orbit behind the character, using the same yaw and pitch as the look.
      const horizontal = Math.cos(this.pitch) * this.orbitDistance;
      this.camera.position.set(
        _worldPosition.x + Math.sin(this.yaw) * horizontal,
        _worldPosition.y + this.component.eyeHeight + Math.sin(-this.pitch) * this.orbitDistance,
        _worldPosition.z + Math.cos(this.yaw) * horizontal,
      );
      this.camera.lookAt(
        _worldPosition.x,
        _worldPosition.y + this.component.eyeHeight,
        _worldPosition.z,
      );
      return;
    }

    this.camera.position.set(
      _worldPosition.x,
      _worldPosition.y + this.component.eyeHeight,
      _worldPosition.z,
    );
    this.camera.quaternion.setFromEuler(_euler.set(this.pitch, this.yaw, 0));
  }
}

registerBehaviour('playerController', (target: BehaviourTarget, ctx: BehaviourContext) => {
  if (target.component.type !== 'playerController') return null;
  return new PlayerController(target.component, target.object, ctx.physics, target.entity.id);
});
