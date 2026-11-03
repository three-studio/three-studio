import {
  JOINT_KIND_LABELS,
  conformJointMotion,
  optionsFrom,
  type ComponentDoc,
  type JointKind,
} from '@three-studio/core';
import { entityChoices } from '../../inspector/declaredFields';
import { asDegrees, type ComponentSchema, type FieldSpec } from '../../inspector/fields';
import { useDocumentStore } from '../../state/documentStore';

const AXIS: FieldSpec = { path: ['motion', 'axis'], label: 'Axis', type: 'vec3', step: 0.1 };
const LIMITS: FieldSpec = { path: ['motion', 'limits', 'enabled'], label: 'Limits' };
const MOTOR: FieldSpec = { path: ['motion', 'motor', 'enabled'], label: 'Motor' };

/** A hinge's or a slider's, while its limits are on. */
function limited(component: ComponentDoc): boolean {
  if (component.type !== 'joint') return false;
  const { motion } = component;
  return (motion.kind === 'hinge' || motion.kind === 'slider') && motion.limits.enabled;
}

/** A hinge's or a slider's, while its motor is on. */
function driven(component: ComponentDoc): boolean {
  if (component.type !== 'joint') return false;
  const { motion } = component;
  return (motion.kind === 'hinge' || motion.kind === 'slider') && motion.motor.enabled;
}

/**
 * Each kind's own settings. Keyed by the kind, so a kind added to the union
 * without rows is a compile error rather than an empty pane. A hinge's angles
 * are stored in radians and shown in degrees, as every angle is.
 */
const JOINT_MOTION_FIELDS: Record<JointKind, readonly FieldSpec[]> = {
  fixed: [],
  hinge: [
    AXIS,
    LIMITS,
    { path: ['motion', 'limits', 'min'], label: 'Min', type: 'number', step: 1, visibleWhen: limited, ...asDegrees },
    { path: ['motion', 'limits', 'max'], label: 'Max', type: 'number', step: 1, visibleWhen: limited, ...asDegrees },
    MOTOR,
    { path: ['motion', 'motor', 'speed'], label: 'Speed', type: 'number', step: 1, visibleWhen: driven, ...asDegrees },
    {
      path: ['motion', 'motor', 'maxForce'],
      label: 'Max Torque',
      type: 'number', min: 0, step: 10,
      visibleWhen: driven,
    },
  ],
  slider: [
    AXIS,
    LIMITS,
    { path: ['motion', 'limits', 'min'], label: 'Min', type: 'number', step: 0.1, visibleWhen: limited },
    { path: ['motion', 'limits', 'max'], label: 'Max', type: 'number', step: 0.1, visibleWhen: limited },
    MOTOR,
    { path: ['motion', 'motor', 'speed'], label: 'Speed', type: 'number', step: 0.1, visibleWhen: driven },
    {
      path: ['motion', 'motor', 'maxForce'],
      label: 'Max Force',
      type: 'number', min: 0, step: 10,
      visibleWhen: driven,
    },
  ],
  spring: [
    { path: ['motion', 'stiffness'], label: 'Stiffness', type: 'number', min: 0, step: 1 },
    { path: ['motion', 'damping'], label: 'Damping', type: 'number', min: 0, step: 0.1 },
  ],
};

/** What the `{ kind: 'geometry' }` slot expands into: the rows of the joint's kind. */
function motionFields(component: ComponentDoc): readonly FieldSpec[] {
  return component.type === 'joint' ? JOINT_MOTION_FIELDS[component.motion.kind] : [];
}

export const inspector: ComponentSchema = {
  label: 'Joint',
  live: true,
  geometryFields: motionFields,
  // The rows change with the kind, as a collider's do with its shape.
  paneKey: (component) => (component.type === 'joint' ? `joint:${component.motion.kind}` : 'joint'),
  fields: [
    {
      path: ['motion'],
      label: 'Type',
      type: 'enum',
      options: optionsFrom(JOINT_KIND_LABELS),
      // A whole motion is written, as one step: a hinge and a spring share no
      // setting, so another kind starts from its own defaults.
      toModel: (motion) => conformJointMotion(motion).kind,
      fromModel: (kind) => conformJointMotion({ kind }),
    },
    {
      path: ['connectedEntity'],
      label: 'Connected Body',
      type: 'entity',
      // Read when the pane is built. `null` holds the joint to the world, and
      // the list carries it as `''`, as an asset slot carries none.
      optionsProvider: () => ({ World: '', ...entityChoices(useDocumentStore.getState().scene) }),
      toModel: (value) => value ?? '',
      fromModel: (value) => (value === '' ? null : value),
    },
    { path: ['anchor'], label: 'Anchor', type: 'vec3', step: 0.01 },
    { kind: 'geometry' },
    { path: ['enableCollision'], label: 'Enable Collision' },
  ],
};
