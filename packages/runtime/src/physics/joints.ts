import RAPIER from '@dimforge/rapier3d-compat';
import type { JointComponent, JointLimits, JointMotion, JointMotor } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';

/** A world pose: where a joint holds, its X along the axis it frees. */
export interface JointPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
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
 * Builds a joint whose two bodies' frames are one world pose, so that it holds
 * them where they were placed.
 *
 * Body 1 is the other side, or the world; body 2 is the joint's own. What a
 * joint leaves free, and what its limits and its motor read, is then the
 * joint's own body against the other: a door against its frame.
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
): RAPIER.ImpulseJoint {
  const [anchor1, rotation1] = frameOn(other, pose);
  const [anchor2, rotation2] = frameOn(own, pose);
  const { motion } = joint;
  const built = world.createImpulseJoint(jointData(motion, anchor1, rotation1, anchor2, rotation2), other, own, true);
  if (motion.kind === 'hinge' || motion.kind === 'slider') {
    built.setLocalFrame1(anchor1, rotation1);
    built.setLocalFrame2(anchor2, rotation2);
    if (built instanceof RAPIER.UnitImpulseJoint) {
      limit(built, motion.limits);
      drive(built, motion.motor);
    }
  }
  // Rapier lets the two bodies of a joint collide: two boxes built into each
  // other and welded drifted apart for seconds, heard touching all along.
  built.setContactsEnabled(joint.enableCollision);
  return built;
}

function jointData(
  motion: JointMotion,
  anchor1: Vector3,
  rotation1: Quaternion,
  anchor2: Vector3,
  rotation2: Quaternion,
): RAPIER.JointData {
  switch (motion.kind) {
    case 'fixed':
      return RAPIER.JointData.fixed(anchor1, rotation1, anchor2, rotation2);
    // Their frames are set on the built joint: these take one axis for both.
    case 'hinge':
      return RAPIER.JointData.revolute(anchor1, anchor2, X);
    case 'slider':
      return RAPIER.JointData.prismatic(anchor1, anchor2, X);
    case 'spring':
      // Of length 0 between anchors that coincide: Unity's spring, pulling its
      // anchor back to where it was built. Rapier's is a distance spring, its
      // rotations free.
      return RAPIER.JointData.spring(0, Math.max(0, motion.stiffness), Math.max(0, motion.damping), anchor1, anchor2);
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
function frameOn(body: RAPIER.RigidBody, pose: JointPose): [Vector3, Quaternion] {
  const unturn = new Quaternion().copy(body.rotation()).invert();
  const anchor = new Vector3().copy(pose.position).sub(body.translation()).applyQuaternion(unturn);
  return [anchor, unturn.multiply(pose.quaternion)];
}
