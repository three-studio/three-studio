import {
  COLLIDER_SHAPE_LABELS,
  COMBINE_RULE_LABELS,
  MESH_BUILD_LABELS,
  conform,
  conformColliderShape,
  createPhysicsSettings,
  optionsFrom,
  type ColliderShapeKind,
  type ComponentDoc,
  type Vec3,
} from '@three-studio/core';
import { fitColliderToMesh } from '../../commands/sceneCommands';
import type { ComponentSchema, FieldSpec } from '../../inspector/fields';
import { useProjectStore } from '../../state/projectStore';
import { peekViewport } from '../../viewport/viewportHost';

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

const RADIUS: FieldSpec = {
  path: ['shape', 'radius'],
  label: 'Radius',
  type: 'number', min: 0.01, step: 0.05,
};
const HEIGHT: FieldSpec = {
  path: ['shape', 'height'],
  label: 'Height',
  type: 'number', min: 0.01, step: 0.05,
};
const ROUNDING: FieldSpec = {
  path: ['shape', 'rounding'],
  label: 'Rounding',
  type: 'number', min: 0, step: 0.01,
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
    ROUNDING,
    CENTER,
    ROTATION,
  ],
  // A sphere turned is the same sphere.
  sphere: [RADIUS, CENTER],
  capsule: [RADIUS, HEIGHT, CENTER, ROTATION],
  cylinder: [RADIUS, HEIGHT, ROUNDING, CENTER, ROTATION],
  cone: [RADIUS, HEIGHT, ROUNDING, CENTER, ROTATION],
  // A mesh collider is its entity's own geometry, already where it is drawn.
  mesh: [
    {
      path: ['shape', 'build'],
      label: 'Build',
      type: 'enum',
      options: optionsFrom(MESH_BUILD_LABELS),
    },
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
    {
      kind: 'action',
      title: 'Fit to Mesh',
      // A mesh collider is its meshes already.
      visibleWhen: (component) => component.type === 'collider' && component.shape.kind !== 'mesh',
      // The edit view's binder: the meshes as it draws them.
      run: ({ entityId, componentId }) => {
        const binder = peekViewport()?.binder;
        if (binder) fitColliderToMesh(entityId, componentId, binder);
      },
    },
    { path: ['isSensor'], label: 'Is sensor' },
    {
      path: ['layer'],
      label: 'Layer',
      // Read when the pane is built, which the Inspector does again when the
      // table changes. A layer the project no longer has is no choice at all:
      // the list selects nothing, and Play says what it collides as meanwhile.
      optionsProvider: () => {
        const layers =
          useProjectStore.getState().project?.settings.physics.layers ?? createPhysicsSettings().layers;
        return Object.fromEntries(layers.map((layer) => [layer.name, layer.id]));
      },
    },
    { kind: 'separator' },
    {
      path: ['material', 'friction'],
      label: 'Friction',
      type: 'number', min: 0, max: 2, step: 0.01,
    },
    {
      path: ['material', 'frictionCombine'],
      label: 'Friction combine',
      type: 'enum',
      options: optionsFrom(COMBINE_RULE_LABELS),
    },
    {
      path: ['material', 'restitution'],
      label: 'Bounciness',
      type: 'number', min: 0, max: 1, step: 0.01,
    },
    {
      path: ['material', 'restitutionCombine'],
      label: 'Bounce combine',
      type: 'enum',
      options: optionsFrom(COMBINE_RULE_LABELS),
    },
  ],
};
