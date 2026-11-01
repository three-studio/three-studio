import { conform, isMemberOf, isRecord } from '../../conform';
import { createId } from '../../ids';
import { JOINT_KIND_LABELS, type JointComponent, type JointKind, type JointMotion, type JointMotionOf } from './schema';

/*
 * A hinge is the joint most games start with, a door; and up is the axis a
 * door, a gate, a turnstile and a carousel turn about, and the one a lift
 * slides along. A spring holds 1 kg about 10 cm below its anchor, and bounces
 * for a second or two before it settles.
 */
const MOTION_FACTORIES: { readonly [K in JointKind]: () => JointMotionOf<K> } = {
  fixed: () => ({ kind: 'fixed' }),
  hinge: () => ({ kind: 'hinge', axis: [0, 1, 0] }),
  slider: () => ({ kind: 'slider', axis: [0, 1, 0] }),
  spring: () => ({ kind: 'spring', stiffness: 100, damping: 5 }),
};

/** A motion of this kind, at its defaults. */
export function createJointMotion<K extends JointKind>(kind: K): JointMotionOf<K> {
  return MOTION_FACTORIES[kind]();
}

/** A hinge held to the world at its entity's origin. */
export function createJoint(): JointComponent {
  return {
    id: createId(),
    type: 'joint',
    motion: createJointMotion('hinge'),
    connectedEntity: null,
    anchor: [0, 0, 0],
  };
}

/**
 * A stored motion, read against the factory of the kind it names, as a
 * collider's shape is: the joint's own factory is a hinge, and the wrong model
 * for a stored slider. A kind this build does not know is the factory's hinge.
 */
export function conformJointMotion(value: unknown): JointMotion {
  const kind = isRecord(value) ? value.kind : undefined;
  if (!isMemberOf(kind, JOINT_KIND_LABELS)) return createJointMotion('hinge');
  return conform(value, createJointMotion(kind));
}
