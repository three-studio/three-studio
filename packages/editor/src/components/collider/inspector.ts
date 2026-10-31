import {
  COLLIDER_SHAPE_LABELS,
  MESH_BUILD_LABELS,
  conformColliderShape,
  optionsFrom,
  type ColliderShapeKind,
  type ComponentDoc,
} from '@three-studio/core';
import type { ComponentSchema, FieldSpec } from '../../inspector/fields';

/**
 * Each kind's own measures. Keyed by the kind, so a kind added to the union
 * without rows is a compile error rather than an empty pane.
 */
const COLLIDER_SHAPE_FIELDS: Record<ColliderShapeKind, readonly FieldSpec[]> = {
  box: [{ path: ['shape', 'size'], label: 'Size', type: 'vec3', min: 0.01, step: 0.1 }],
  sphere: [{ path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 }],
  capsule: [
    { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
    { path: ['shape', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.05 },
  ],
  mesh: [
    { path: ['shape', 'build'], label: 'Build', type: 'enum', options: optionsFrom(MESH_BUILD_LABELS) },
  ],
};

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
