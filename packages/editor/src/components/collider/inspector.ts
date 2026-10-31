import {
  COLLIDER_SHAPE_LABELS,
  MESH_BUILD_LABELS,
  conform,
  conformColliderShape,
  optionsFrom,
  type ColliderShapeKind,
  type ComponentDoc,
  type Vec3,
} from '@three-studio/core';
import type { ComponentSchema, FieldSpec } from '../../inspector/fields';

const RAD_TO_DEG = 180 / Math.PI;

/**
 * A shape's rotation, stored as a tuple in radians, edited as a pad in degrees.
 * Read through `conform`, so a value that is not three numbers shows as none.
 */
const IN_DEGREES: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => {
    const model: Vec3 = [0, 0, 0];
    const [x, y, z] = conform(value, model);
    return { x: x * RAD_TO_DEG, y: y * RAD_TO_DEG, z: z * RAD_TO_DEG };
  },
  fromModel: (value) => {
    const { x, y, z } = conform(value, { x: 0, y: 0, z: 0 });
    return [x / RAD_TO_DEG, y / RAD_TO_DEG, z / RAD_TO_DEG];
  },
};

const CENTER: FieldSpec = { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 };
const ROTATION: FieldSpec = {
  path: ['shape', 'rotation'],
  label: 'Rotation',
  type: 'vec3',
  step: 1,
  ...IN_DEGREES,
};

/**
 * Each kind's own measures. Keyed by the kind, so a kind added to the union
 * without rows is a compile error rather than an empty pane.
 */
const COLLIDER_SHAPE_FIELDS: Record<ColliderShapeKind, readonly FieldSpec[]> = {
  box: [
    { path: ['shape', 'size'], label: 'Size', type: 'vec3', min: 0.01, step: 0.1 },
    CENTER,
    ROTATION,
  ],
  // A sphere turned is the same sphere.
  sphere: [
    { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
    CENTER,
  ],
  capsule: radiusAndHeight(),
  cylinder: radiusAndHeight(),
  cone: radiusAndHeight(),
  // A mesh collider is its entity's own geometry, already where it is drawn.
  mesh: [
    { path: ['shape', 'build'], label: 'Build', type: 'enum', options: optionsFrom(MESH_BUILD_LABELS) },
  ],
};

/** A capsule, a cylinder and a cone are measured alike: a radius, and a height end to end. */
function radiusAndHeight(): readonly FieldSpec[] {
  return [
    { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
    { path: ['shape', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.05 },
    CENTER,
    ROTATION,
  ];
}

/** What the `{ kind: 'geometry' }` slot expands into: the rows of the collider's kind. */
function shapeFields(component: ComponentDoc): readonly FieldSpec[] {
  return component.type === 'collider' ? COLLIDER_SHAPE_FIELDS[component.shape.kind] : [];
}

export const inspector: ComponentSchema = {
  label: 'Collider',
  geometryFields: shapeFields,
  // The rows change with the kind, as a mesh's do with its primitive.
  paneKey: (component) =>
    component.type === 'collider' ? `collider:${component.shape.kind}` : 'collider',
  fields: [
    {
      path: ['shape'],
      label: 'Shape',
      type: 'enum',
      options: optionsFrom(COLLIDER_SHAPE_LABELS),
      // A whole shape is written, as one step: a box and a sphere share no
      // measure, so another kind starts from its own defaults.
      toModel: (shape) => conformColliderShape(shape).kind,
      fromModel: (kind) => conformColliderShape({ kind }),
    },
    { kind: 'geometry' },
    { path: ['isSensor'], label: 'Is sensor' },
    { kind: 'separator' },
    {
      path: ['material', 'friction'],
      label: 'Friction',
      type: 'number', min: 0, max: 2, step: 0.01,
    },
    {
      path: ['material', 'restitution'],
      label: 'Bounciness',
      type: 'number', min: 0, max: 1, step: 0.01,
    },
  ],
};
