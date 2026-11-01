import RAPIER from '@dimforge/rapier3d-compat';
import type { JointComponent, JointLimits, JointMotion, JointMotor } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import type { JointHandle } from './PhysicsApi';

/** A world pose: where a joint holds, its X along the axis it frees. */
export interface JointPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
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

/** Rapier frees a hinge's turn about its frames' X, and a slider's slide along it. */
const X = Object.freeze({ x: 1, y: 0, z: 0 });

/**
 * How hard a motor holds its speed. At it, a motor reaches its speed within a
 * tick at 30, 60 and 120 Hz whatever the mass, as Unity's does, and its Max
 * Force alone limits it. It says how a motor behaves, not how a game plays.
 */
const MOTOR_FACTOR = 1e4;

/** A joint as the world built it, and the handle behaviours and scripts reach it by. */
export class Joint implements JointHandle {
  constructor(
    /** `null` for a Fixed or Spring joint, which has no motor and nothing to measure. */
    private readonly free: Free | null,
    private readonly other: RAPIER.RigidBody,
    private readonly own: RAPIER.RigidBody,
    private readonly frame1: Frame,
    private readonly frame2: Frame,
  ) {}

  /** Read from where the two bodies are, through the frames the joint was built with. */
  get position(): number {
    if (!this.free) return 0;
    const turn1 = _turn1.copy(this.other.rotation()).multiply(this.frame1.rotation);
    if (this.free.kind === 'hinge') {
      // The own frame's twist about X against the other's, the shorter way round.
      const turn2 = _turn2.copy(this.own.rotation()).multiply(this.frame2.rotation);
      const relative = turn1.invert().multiply(turn2);
      const sign = relative.w < 0 ? -1 : 1;
      return 2 * Math.atan2(sign * relative.x, sign * relative.w);
    }
    // The own anchor's offset from the other's, along the other frame's X.
    const anchor1 = inWorld(this.frame1.anchor, this.other, _anchor1);
    const anchor2 = inWorld(this.frame2.anchor, this.own, _anchor2);
    return anchor2.sub(anchor1).dot(_axis.set(1, 0, 0).applyQuaternion(turn1));
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
    if (!this.free) return;
    Object.assign(this.free.motor, change);
    drive(this.free.joint, this.free.motor);
  }
}

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
 * Builds a joint whose two bodies' frames are one world pose, so that it holds
 * them where they were placed.
 *
 * Body 1 is the other side, or the world; body 2 is the joint's own. What a
 * joint leaves free, and what its limits, its motor and `position` read, is
 * then the joint's own body against the other: a door against its frame.
 *
 * A frame on each body rather than Rapier's one axis for both: given in each
 * body's own space, a single axis between two bodies turned unlike wrenched
 * them into line at the first tick.
 */
export function buildJoint(
  world: RAPIER.World,
  joint: JointComponent,
  other: RAPIER.RigidBody,
  own: RAPIER.RigidBody,
  pose: JointPose,
): Joint {
  const frame1 = frameOn(other, pose);
  const frame2 = frameOn(own, pose);
  const { motion } = joint;
  const built = world.createImpulseJoint(jointData(motion, frame1, frame2), other, own, true);
  // Rapier lets the two bodies of a joint collide: two boxes built into each
  // other and welded drifted apart for seconds, heard touching all along.
  built.setContactsEnabled(joint.enableCollision);
  if ((motion.kind !== 'hinge' && motion.kind !== 'slider') || !(built instanceof RAPIER.UnitImpulseJoint)) {
    return new Joint(null, other, own, frame1, frame2);
  }

  built.setLocalFrame1(frame1.anchor, frame1.rotation);
  built.setLocalFrame2(frame2.anchor, frame2.rotation);
  limit(built, motion.limits);
  const free: Free = { kind: motion.kind, joint: built, motor: { ...motion.motor } };
  drive(built, free.motor);
  return new Joint(free, other, own, frame1, frame2);
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

/** The pose in a body's own frame, from where the body is: q⁻¹ · (p − p_body) and q⁻¹ · q_pose. */
function frameOn(body: RAPIER.RigidBody, pose: JointPose): Frame {
  const unturn = new Quaternion().copy(body.rotation()).invert();
  const anchor = new Vector3().copy(pose.position).sub(body.translation()).applyQuaternion(unturn);
  return { anchor, rotation: unturn.multiply(pose.quaternion) };
}
