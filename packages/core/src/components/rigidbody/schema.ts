import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** One axis of a lock: a row each, since three checkboxes to a row would need a Tweakpane plugin. */
const axis = (label: string) => ({ type: 'boolean', label, default: false }) as const;

/** Shown for a dynamic body alone: a kinematic body is drawn where its transform is, whatever these say. */
const dynamicOnly = { field: 'bodyType', equals: 'dynamic' } as const;

/** A body physics moves, as its fields. The order is the pane's. */
export const rigidbodySchema = {
  bodyType: {
    type: 'enum',
    label: 'Type',
    default: 'dynamic',
    options: [
      { value: 'dynamic', label: 'Dynamic' },
      { value: 'fixed', label: 'Fixed' },
      { value: 'kinematicPosition', label: 'Kinematic' },
    ],
  },
  /* The whole body's, shared among its colliders by volume. */
  mass: { type: 'number', label: 'Mass', default: 1, min: 0.001, step: 0.1 },
  linearDamping: { type: 'number', label: 'Linear damping', default: 0, min: 0, max: 10, step: 0.01 },
  angularDamping: { type: 'number', label: 'Angular damping', default: 0.05, min: 0, max: 10, step: 0.01 },
  gravityScale: { type: 'number', label: 'Gravity scale', default: 1, min: -5, max: 5, step: 0.1 },
  ccd: { type: 'boolean', label: 'Continuous detection', default: false },
  /* Drawn between the solver's ticks, rather than where the last one left it. */
  interpolate: { type: 'boolean', label: 'Interpolate', default: true, shownWhen: dynamicOnly },
  /*
   * The axes the solver may not move or turn the body along: named, so that a
   * file says which, where a tuple of three booleans said it by position.
   */
  lockPosition: {
    type: 'object',
    label: 'Lock position',
    shownWhen: dynamicOnly,
    fields: { x: axis('Lock position X'), y: axis('Lock position Y'), z: axis('Lock position Z') },
  },
  lockRotation: {
    type: 'object',
    label: 'Lock rotation',
    shownWhen: dynamicOnly,
    fields: { x: axis('Lock rotation X'), y: axis('Lock rotation Y'), z: axis('Lock rotation Z') },
  },
} as const satisfies Schema;

export type RigidBodyComponent = Component<'rigidbody', Infer<typeof rigidbodySchema>>;
export type BodyType = RigidBodyComponent['bodyType'];
