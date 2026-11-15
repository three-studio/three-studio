import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** A character the player drives, as its fields. The order is the pane's. */
export const playerControllerSchema = {
  mode: {
    type: 'enum',
    label: 'Mode',
    default: 'fps',
    options: [
      { value: 'fps', label: 'FPS' },
      { value: 'tps', label: 'TPS' },
      { value: 'fly', label: 'Fly' },
    ],
  },
  moveSpeed: { type: 'number', label: 'Move speed', default: 6, min: 0.1, max: 40, step: 0.1 },
  sprintMultiplier: { type: 'number', label: 'Sprint ×', default: 1.8, min: 1, max: 5, step: 0.1 },
  jumpHeight: { type: 'number', label: 'Jump height', default: 1.2, min: 0, max: 10, step: 0.1 },
  /*
   * The steepest slope the player walks up, and the highest step it climbs:
   * the 50° and 0.4 m the physics world used to hard-code for every character,
   * and the two numbers a level's ramps and stairs are built against. Hidden in
   * fly mode, where the player collides with nothing: no slope stops it and no
   * step is in its way.
   */
  maxSlope: {
    type: 'number',
    label: 'Max slope',
    default: (50 * Math.PI) / 180,
    min: 0,
    max: 89,
    step: 1,
    unit: 'radians',
    shownWhen: { field: 'mode', notEquals: 'fly' },
  },
  stepHeight: {
    type: 'number',
    label: 'Step height',
    default: 0.4,
    min: 0,
    max: 2,
    step: 0.05,
    shownWhen: { field: 'mode', notEquals: 'fly' },
  },
  mouseSensitivity: { type: 'number', label: 'Mouse sensitivity', default: 0.0022, min: 0.0002, max: 0.01, step: 0.0001 },
  /*
   * An adult's eye, measured from the floor: from the feet, not from the
   * entity's origin, which is the middle of the collider — which is the
   * question the label answers before it is asked. It pairs with the 1.70 m
   * capsule a new player is given, so the two defaults compose into a person.
   *
   * Shown in every mode, which it was not: it used to be hidden unless the mode
   * was FPS, while TPS reads the very same field twice — as the height of the
   * point the camera orbits and of the point it looks at.
   */
  eyeHeight: { type: 'number', label: 'Eye height (from feet)', default: 1.6, min: 0, max: 4, step: 0.05 },
  cameraDistance: {
    type: 'number',
    label: 'Camera distance',
    default: 5,
    min: 0.5,
    max: 25,
    step: 0.1,
    shownWhen: { field: 'mode', equals: 'tps' },
  },
  /*
   * The camera this controller owns wins over any the scene carries, so
   * without this a project had no way to ask for a different field of view.
   */
  fov: { type: 'number', label: 'Field of view', default: 70, min: 30, max: 120, step: 1 },
  /*
   * The on-screen sticks. Nothing is drawn until someone touches the screen,
   * so a desktop build is by default exactly what it always was.
   */
  touchControls: {
    type: 'enum',
    label: 'Touch controls',
    default: 'auto',
    options: [
      { value: 'auto', label: 'On first touch' },
      { value: 'always', label: 'Always' },
      { value: 'never', label: 'Never' },
    ],
  },
  /*
   * Its own number rather than the mouse sensitivity reused, and the units are
   * why: a mouse reports a displacement that becomes an angle once, a stick a
   * deflection integrated over time. One number for both would be wrong in one
   * of the two places whatever it held.
   */
  touchLookSpeed: {
    type: 'number',
    label: 'Touch look speed',
    default: 2.5,
    min: 0.5,
    max: 8,
    step: 0.1,
    shownWhen: { field: 'touchControls', notEquals: 'never' },
  },
} as const satisfies Schema;

export type PlayerControllerComponent = Component<'playerController', Infer<typeof playerControllerSchema>>;
export type PlayerControllerMode = PlayerControllerComponent['mode'];
export type TouchControlsMode = PlayerControllerComponent['touchControls'];
