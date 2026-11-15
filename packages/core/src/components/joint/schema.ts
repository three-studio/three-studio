import { variantFactory, type Infer, type Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/**
 * The line a hinge turns about or a slider slides along, through the anchor,
 * in its entity's frame: turned with the entity, never stretched by its scale.
 * A zero axis is up.
 */
const axis = { type: 'vec3', label: 'Axis', default: [0, 1, 0], step: 0.1 } as const;

/** While its limits or its motor are on: what each of their other rows reads. */
const enabled = { field: 'enabled', equals: true } as const;

/**
 * The range a hinge turns or a slider slides within, measured from where the
 * joint was built — a build pose outside it is pushed into it at the first
 * tick — and the motor that drives it at a speed, pushing no harder than its
 * force. A hinge's in radians, right-handed about its axis, shown in degrees;
 * a slider's in metres along it.
 */
function moving(angles: boolean, defaults: { readonly min: number; readonly max: number; readonly speed: number }) {
  const unit = angles ? ({ unit: 'radians' } as const) : {};
  const step = angles ? 1 : 0.1;
  return {
    axis,
    limits: {
      type: 'object',
      label: 'Limits',
      fields: {
        enabled: { type: 'boolean', label: 'Limits', default: false },
        min: { type: 'number', label: 'Min', default: defaults.min, step, ...unit, shownWhen: enabled },
        max: { type: 'number', label: 'Max', default: defaults.max, step, ...unit, shownWhen: enabled },
      },
    },
    motor: {
      type: 'object',
      label: 'Motor',
      fields: {
        enabled: { type: 'boolean', label: 'Motor', default: false },
        /* Per second: radians for a hinge, metres for a slider. */
        speed: { type: 'number', label: 'Speed', default: defaults.speed, step, ...unit, shownWhen: enabled },
        /* Newton-metres for a hinge, newtons for a slider. */
        maxForce: {
          type: 'number',
          label: angles ? 'Max Torque' : 'Max Force',
          default: 1000,
          min: 0,
          step: 10,
          shownWhen: enabled,
        },
      },
    },
  } as const;
}

/**
 * What a joint leaves free between its two bodies. Each kind carries its own
 * settings and nothing else, as a collider's shape does: one flat bag would
 * give a hinge a stiffness, and the builder's switch could read it. Choosing
 * another kind writes that kind at its defaults, and its rows sit under Type.
 */
export const jointMotionField = {
  type: 'union',
  label: 'Type',
  default: 'hinge',
  variants: {
    fixed: { label: 'Fixed', fields: {} },
    // A quarter turn either way; 90° a second.
    hinge: { label: 'Hinge', fields: moving(true, { min: -Math.PI / 2, max: Math.PI / 2, speed: Math.PI / 2 }) },
    slider: { label: 'Slider', fields: moving(false, { min: -1, max: 1, speed: 1 }) },
    spring: {
      label: 'Spring',
      fields: {
        /*
         * Newtons per metre of stretch. A spring pulls its anchor back to where
         * it was built on the other body, and turns freely about it: under its
         * weight, a body hangs about m·g / stiffness below.
         */
        stiffness: { type: 'number', label: 'Stiffness', default: 100, min: 0, step: 1 },
        /* Newton-seconds per metre. */
        damping: { type: 'number', label: 'Damping', default: 5, min: 0, step: 0.1 },
      },
    },
  },
} as const;

/** Two bodies held together, as their fields. The order is the pane's. */
export const jointSchema = {
  motion: jointMotionField,
  /*
   * The entity whose body this entity's is held to, by id: the body that
   * entity moves with — its own Rigid Body, the nearest one up the tree, or its
   * own fixed body if it is level geometry. None holds it to the world.
   */
  connectedEntity: { type: 'entity', label: 'Connected Body', emptyLabel: 'World' },
  /* Where it holds, in this entity's frame and units: a door's hinge on its edge. */
  anchor: { type: 'vec3', label: 'Anchor', default: [0, 0, 0], step: 0.01 },
  /* Whether its two bodies collide with each other. Off, a door can sit against its frame and two links overlap. */
  enableCollision: { type: 'boolean', label: 'Enable Collision', default: false },
} as const satisfies Schema;

export type JointComponent = Component<'joint', Infer<typeof jointSchema>>;
export type JointMotion = JointComponent['motion'];
export type JointKind = JointMotion['kind'];
export type JointMotionOf<K extends JointKind> = Extract<JointMotion, { kind: K }>;
export type JointLimits = JointMotionOf<'hinge'>['limits'];
export type JointMotor = JointMotionOf<'hinge'>['motor'];

/** A motion of this kind at its defaults, typed as that motion: a new value each time. */
export const createJointMotion = variantFactory(jointMotionField);
