import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** A camera the game can look through, as its fields. The order is the pane's. */
export const cameraSchema = {
  projection: {
    type: 'enum',
    label: 'Projection',
    default: 'perspective',
    options: [
      { value: 'perspective', label: 'Perspective' },
      { value: 'orthographic', label: 'Orthographic' },
    ],
  },
  /* Vertical, in degrees, as three takes it. */
  fov: {
    type: 'number',
    label: 'Field of view',
    default: 60,
    min: 10,
    max: 130,
    step: 1,
    shownWhen: { field: 'projection', equals: 'perspective' },
  },
  /* The orthographic camera's vertical extent, in metres. */
  frustumSize: {
    type: 'number',
    label: 'Size',
    default: 10,
    min: 0.1,
    step: 0.5,
    shownWhen: { field: 'projection', equals: 'orthographic' },
  },
  near: { type: 'number', label: 'Near', default: 0.1, min: 0.001, step: 0.01 },
  far: { type: 'number', label: 'Far', default: 2000, min: 1, step: 10 },
  /* The camera Play renders through when no player controller is active. */
  isMain: { type: 'boolean', label: 'Main camera', default: false },
} as const satisfies Schema;

export type CameraComponent = Component<'camera', Infer<typeof cameraSchema>>;
export type CameraProjection = CameraComponent['projection'];
