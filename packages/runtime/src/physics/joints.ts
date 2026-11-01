import RAPIER from '@dimforge/rapier3d-compat';
import type { JointComponent } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';

/** A world pose: where a joint holds, its X along the axis it frees. */
export interface JointPose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

/** Rapier frees a hinge's turn about its frames' X, and a slider's slide along it. */
const X = Object.freeze({ x: 1, y: 0, z: 0 });

/**
 * Builds a joint whose two bodies' frames are one world pose, so that it holds
 * them where they were placed.
 *
 * Body 1 is the other side, or the world; body 2 is the joint's own. What a
 * joint leaves free is then the joint's own body against the other: a door
 * against its frame.
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
  let built: RAPIER.ImpulseJoint;
  switch (motion.kind) {
    case 'fixed':
      built = world.createImpulseJoint(RAPIER.JointData.fixed(anchor1, rotation1, anchor2, rotation2), other, own, true);
      break;
    case 'hinge':
    case 'slider': {
      const data =
        motion.kind === 'hinge'
          ? RAPIER.JointData.revolute(anchor1, anchor2, X)
          : RAPIER.JointData.prismatic(anchor1, anchor2, X);
      built = world.createImpulseJoint(data, other, own, true);
      built.setLocalFrame1(anchor1, rotation1);
      built.setLocalFrame2(anchor2, rotation2);
      break;
    }
    case 'spring':
      // Of length 0 between anchors that coincide: Unity's spring, pulling its
      // anchor back to where it was built. Rapier's is a distance spring, its
      // rotations free.
      built = world.createImpulseJoint(
        RAPIER.JointData.spring(0, Math.max(0, motion.stiffness), Math.max(0, motion.damping), anchor1, anchor2),
        other,
        own,
        true,
      );
      break;
  }
  // Rapier lets the two bodies of a joint collide: two boxes built into each
  // other and welded drifted apart for seconds, heard touching all along.
  built.setContactsEnabled(false);
  return built;
}

/** The pose in a body's own frame, from where the body is: q⁻¹ · (p − p_body) and q⁻¹ · q_pose. */
function frameOn(body: RAPIER.RigidBody, pose: JointPose): [Vector3, Quaternion] {
  const unturn = new Quaternion().copy(body.rotation()).invert();
  const anchor = new Vector3().copy(pose.position).sub(body.translation()).applyQuaternion(unturn);
  return [anchor, unturn.multiply(pose.quaternion)];
}
