import RAPIER from '@dimforge/rapier3d-compat';
import {
  jointFrame,
  type JointComponent,
  type JointLimits,
  type JointMotion,
  type JointMotor,
} from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import type { JointHandle } from './PhysicsApi';

/** A world pose: where a joint holds, its X along the axis it frees. */
export interface JointPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

/** An entity's world pose and scale, as physics reads them. */
export interface EntityPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
}

/** A body, and the world pose it was built at: what a joint's frames on it are measured from. */
export interface Placed {
  readonly rapier: RAPIER.RigidBody;
  readonly built: { readonly position: Vector3; readonly quaternion: Quaternion };
}

/** The two bodies a joint holds: the other side, or the world, and its own entity's. */
export interface JointBodies {
  readonly other: Placed;
  readonly own: Placed;
}

/** A joint's pose in one body's frame, fixed from the build on. */
interface Frame {
  readonly anchor: Vector3;
  readonly rotation: Quaternion;
}

/** A hinge or a slider as built: its Rapier joint, and its motor as last set, since Rapier reads none back. */
interface Free {
  readonly kind: 'hinge' | 'slider';
  readonly joint: RAPIER.UnitImpulseJoint;
  readonly motor: JointMotor;
}

/** What a joint holds by: its Rapier joint, the two bodies, and its frame on each. */
interface Holding {
  readonly raw: RAPIER.ImpulseJoint;
  /** `null` for a Fixed or Spring joint, which has no motor and nothing to measure. */
  readonly free: Free | null;
  readonly other: RAPIER.RigidBody;
  readonly own: RAPIER.RigidBody;
  readonly frame1: Frame;
  readonly frame2: Frame;
}

/** Rapier frees a hinge's turn about its frames' X, and a slider's slide along it. */
const X = Object.freeze({ x: 1, y: 0, z: 0 });

/**
 * How hard a motor holds its speed. At it, a motor reaches its speed within a
 * tick at 30, 60 and 120 Hz whatever the mass, as Unity's does, and its Max
 * Force alone limits it. It says how a motor behaves, not how a game plays.
 */
const MOTOR_FACTOR = 1e4;

/**
 * A Joint the world was built with, and the handle behaviours and scripts reach
 * it by. It holds two bodies, or nothing — its Connected Body gone, both sides
 * on one body —, and a tune builds it again in place: a handle kept from the
 * start drives the joint that replaced the first.
 */
export class Joint implements JointHandle {
  private holding: Holding | null = null;

  constructor(
    private readonly world: RAPIER.World,
    /** Its Joint as last applied, by the build and by each tune since. */
    public component: JointComponent,
    /**
     * Its entity's world pose and scale when the world was built, which its
     * anchor and axis are read against, then and at each tune.
     */
    private readonly placed: EntityPose,
    ends: JointBodies | null,
  ) {
    this.remake(component, ends);
  }

  /** Whether it holds two bodies. */
  get holds(): boolean {
    return this.holding !== null;
  }

  /**
   * Built again from `component` between these two bodies, as placed when the
   * world was built, or holding nothing.
   *
   * Whatever the field. Rapier has setters for a joint's limits, its motor and
   * its contacts, but none to switch limits off and none at all for a spring,
   * and the frames need the poses the joint was built at either way. So a
   * spring stiffened pulls its anchor back to where it was built, and a hinge
   * given another anchor turns about it as if it had been there from the
   * start: a body carried since is pulled to where the joint now holds it.
   */
  remake(component: JointComponent, ends: JointBodies | null): void {
    if (this.holding) this.world.removeImpulseJoint(this.holding.raw, true);
    this.component = component;
    this.holding = ends && hold(this.world, component, ends.other, ends.own, holdingPose(this.placed, component));
  }

  /** Read from where the two bodies are, through the frames the joint was built with. */
  get position(): number {
    const held = this.holding;
    if (!held?.free) return 0;
    const turn1 = _turn1.copy(held.other.rotation()).multiply(held.frame1.rotation);
    if (held.free.kind === 'hinge') {
      // The own frame's twist about X against the other's, the shorter way round.
      const turn2 = _turn2.copy(held.own.rotation()).multiply(held.frame2.rotation);
      const relative = turn1.invert().multiply(turn2);
      const sign = relative.w < 0 ? -1 : 1;
      return 2 * Math.atan2(sign * relative.x, sign * relative.w);
    }
    // The own anchor's offset from the other's, along the other frame's X.
    const anchor1 = inWorld(held.frame1.anchor, held.other, _anchor1);
    const anchor2 = inWorld(held.frame2.anchor, held.own, _anchor2);
    return anchor2.sub(anchor1).dot(_axis.set(1, 0, 0).applyQuaternion(turn1));
  }

  private get free(): Free | null {
    return this.holding?.free ?? null;
  }

  get motorEnabled(): boolean {
    return this.free?.motor.enabled ?? false;
  }

  set motorEnabled(enabled: boolean) {
    if (typeof enabled === 'boolean') this.set({ enabled });
  }

  get motorSpeed(): number {
    return this.free?.motor.speed ?? 0;
  }

  set motorSpeed(speed: number) {
    if (Number.isFinite(speed)) this.set({ speed });
  }

  get motorMaxForce(): number {
    return this.free?.motor.maxForce ?? 0;
  }

  set motorMaxForce(maxForce: number) {
    if (Number.isFinite(maxForce) && maxForce >= 0) this.set({ maxForce });
  }

  private set(change: Partial<JointMotor>): void {
    const { free } = this;
    if (!free) return;
    Object.assign(free.motor, change);
    drive(free.joint, free.motor);
  }
}

/**
 * Where a joint on an entity at this world pose and scale holds: the entity's
 * pose composed with the joint's anchor and axis on it, the pose's X along the
 * axis.
 */
export function holdingPose(entity: EntityPose, joint: JointComponent): JointPose {
  const { anchor, axis } = jointFrame(joint, [entity.scale.x, entity.scale.y, entity.scale.z]);
  return {
    position: new Vector3(...anchor).applyQuaternion(entity.quaternion).add(entity.position),
    quaternion: new Quaternion().setFromUnitVectors(UNIT_X, new Vector3(...axis)).premultiply(entity.quaternion),
  };
}

const UNIT_X = new Vector3(1, 0, 0);

/** A point of a body's frame, in the world, from where the body is. */
function inWorld(point: Vector3, body: RAPIER.RigidBody, target: Vector3): Vector3 {
  return target.copy(point).applyQuaternion(_bodyTurn.copy(body.rotation())).add(body.translation());
}

const _turn1 = new Quaternion();
const _turn2 = new Quaternion();
const _bodyTurn = new Quaternion();
const _anchor1 = new Vector3();
const _anchor2 = new Vector3();
const _axis = new Vector3();

/**
 * A Rapier joint whose two bodies' frames are one world pose, so that it holds
 * them where they were built.
 *
 * Body 1 is the other side, or the world; body 2 is the joint's own. What a
 * joint leaves free, and what its limits, its motor and `position` read, is
 * then the joint's own body against the other: a door against its frame.
 *
 * A frame on each body rather than Rapier's one axis for both: given in each
 * body's own space, a single axis between two bodies turned unlike wrenched
 * them into line at the first tick.
 */
function hold(world: RAPIER.World, joint: JointComponent, other: Placed, own: Placed, pose: JointPose): Holding {
  const frame1 = frameOn(other, pose);
  const frame2 = frameOn(own, pose);
  const { motion } = joint;
  const raw = world.createImpulseJoint(jointData(motion, frame1, frame2), other.rapier, own.rapier, true);
  // Rapier lets the two bodies of a joint collide: two boxes built into each
  // other and welded drifted apart for seconds, heard touching all along.
  raw.setContactsEnabled(joint.enableCollision);
  const held = { raw, other: other.rapier, own: own.rapier, frame1, frame2 };
  if ((motion.kind !== 'hinge' && motion.kind !== 'slider') || !(raw instanceof RAPIER.UnitImpulseJoint)) {
    return { ...held, free: null };
  }

  raw.setLocalFrame1(frame1.anchor, frame1.rotation);
  raw.setLocalFrame2(frame2.anchor, frame2.rotation);
  limit(raw, motion.limits);
  const free: Free = { kind: motion.kind, joint: raw, motor: { ...motion.motor } };
  drive(raw, free.motor);
  return { ...held, free };
}

function jointData(motion: JointMotion, frame1: Frame, frame2: Frame): RAPIER.JointData {
  switch (motion.kind) {
    case 'fixed':
      return RAPIER.JointData.fixed(frame1.anchor, frame1.rotation, frame2.anchor, frame2.rotation);
    // Their frames are set on the built joint: these take one axis for both.
    case 'hinge':
      return RAPIER.JointData.revolute(frame1.anchor, frame2.anchor, X);
    case 'slider':
      return RAPIER.JointData.prismatic(frame1.anchor, frame2.anchor, X);
    case 'spring':
      // Of length 0 between anchors that coincide: Unity's spring, pulling its
      // anchor back to where it was built. Rapier's is a distance spring, its
      // rotations free.
      return RAPIER.JointData.spring(
        0,
        Math.max(0, motion.stiffness),
        Math.max(0, motion.damping),
        frame1.anchor,
        frame2.anchor,
      );
  }
}

/**
 * The range, set on the built joint: Rapier's `intoRaw` passes a revolute's
 * limits nowhere. Measured from the pose the frames were built at, right-handed
 * about X.
 */
function limit(joint: RAPIER.UnitImpulseJoint, limits: JointLimits): void {
  if (limits.enabled) joint.setLimits(Math.min(limits.min, limits.max), Math.max(limits.min, limits.max));
}

/**
 * A motor driving its joint at its speed, pushing no harder than its force; or
 * none. None is no force at all: a speed and a factor of zero brake the joint
 * to a stop instead, and a wheel at 5 rad/s read 0 a second later.
 */
function drive(joint: RAPIER.UnitImpulseJoint, motor: JointMotor): void {
  if (!motor.enabled) {
    joint.setMotorMaxForce(0);
    return;
  }
  joint.configureMotorVelocity(motor.speed, MOTOR_FACTOR);
  joint.setMotorMaxForce(Math.max(0, motor.maxForce));
}

/**
 * The pose in a body's own frame, from where the body was built:
 * q⁻¹ · (p − p_body) and q⁻¹ · q_pose. Where it was built and not where it is:
 * a joint rebuilt during Play is held as placed when the world was built.
 */
function frameOn(body: Placed, pose: JointPose): Frame {
  const unturn = body.built.quaternion.clone().invert();
  const anchor = pose.position.clone().sub(body.built.position).applyQuaternion(unturn);
  return { anchor, rotation: unturn.multiply(pose.quaternion) };
}
