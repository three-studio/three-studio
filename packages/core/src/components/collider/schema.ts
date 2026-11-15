import { variantFactory, type Infer, type Schema } from '../../fieldSchema';
import { DEFAULT_LAYER_ID } from '../../project/layers';
import { physicsMaterialFields } from '../../scene/physicsMaterial';
import type { Component } from '../../scene/primitives';

/** A radius, in metres. */
const radius = { type: 'number', label: 'Radius', default: 0.5, min: 0.01, step: 0.05 } as const;
/** A length along the shape's own y, in metres. */
const height = (fallback: number) => ({ type: 'number', label: 'Height', default: fallback, min: 0.01, step: 0.05 }) as const;
/**
 * The radius of a shape's rounded edges and corners, in metres; 0 is sharp.
 * The outside stays the size drawn: a rounded 1 m box still stands 1 m tall,
 * and rolls over its corners where a sharp one catches.
 */
const rounding = { type: 'number', label: 'Rounding', default: 0, min: 0, step: 0.01 } as const;
/**
 * Where a shape's middle sits, in its entity's frame and units: Unity's
 * Center, which stands a capsule above a model's feet with no child entity to
 * carry it.
 */
const center = { type: 'vec3', label: 'Center', default: [0, 0, 0], step: 0.05 } as const;
/**
 * How a shape is turned on its entity, Euler XYZ in radians as an entity's
 * rotation is. Center and rotation live in the shapes that have them rather
 * than on the collider: a sphere turned is the same sphere, and a mesh collider
 * is its entity's own geometry, already where it is drawn.
 */
const rotation = { type: 'vec3', label: 'Rotation', default: [0, 0, 0], step: 1, unit: 'radians' } as const;

/**
 * What the physics engine is asked to build, measured as it is drawn.
 *
 * Each kind carries its own measures and nothing else. It was one flat bag of
 * `size`, `radius` and `halfHeight` that every kind shared, half of it ignored
 * by whichever kind was chosen, and the box read its `size` as half extents
 * while the mesh beside it read width, height and depth whole. Choosing another
 * kind writes that kind at its defaults: a box and a sphere share no measure.
 */
export const colliderShapeField = {
  type: 'union',
  label: 'Shape',
  default: 'box',
  variants: {
    box: {
      label: 'Box',
      fields: {
        /* The full size along each of its own axes, as a box mesh's width, height and depth read. */
        size: { type: 'vec3', label: 'Size', default: [1, 1, 1], min: 0.01, step: 0.1 },
        rounding,
        center,
        rotation,
      },
    },
    sphere: { label: 'Sphere', fields: { radius, center } },
    capsule: {
      label: 'Capsule',
      // From end to end, caps included: a 1.70 m person is 1.7. A capsule mesh
      // measures its straight part alone.
      fields: { radius, height: height(2), center, rotation },
    },
    cylinder: { label: 'Cylinder', fields: { radius, height: height(1), rounding, center, rotation } },
    // Its base's radius; from base to apex, the apex up, as three draws a
    // Cylinder whose top radius is 0.
    cone: { label: 'Cone', fields: { radius, height: height(1), rounding, center, rotation } },
    mesh: {
      label: 'Mesh',
      fields: {
        /*
         * How the entity's own geometry is made into a shape. Triangles is
         * exact: a surface with no inside, for what does not move with physics.
         * Convex hull is one cheap solid, its holes and hollows filled in.
         * Convex parts is several solids that keep the holes, slower to build —
         * a tenth of a second for a primitive, about a second for a detailed
         * model — once per session.
         */
        build: {
          type: 'enum',
          label: 'Build',
          default: 'triangles',
          options: [
            { value: 'triangles', label: 'Triangles' },
            { value: 'hull', label: 'Convex hull' },
            { value: 'parts', label: 'Convex parts' },
          ],
        },
      },
    },
  },
} as const;

/** What a collider is, as its fields. The order is the pane's. */
export const colliderSchema = {
  shape: colliderShapeField,
  /*
   * A zone rather than matter: it touches nothing, and weighs nothing. What
   * moves through it is reported, through `onTriggerEnter` and
   * `onTriggerExit`, to the scripts of its entity, of the body it rides, and of
   * what entered it. It sees anything that moves, never another Fixed collider.
   */
  isSensor: { type: 'boolean', label: 'Is sensor', default: false },
  /*
   * The collision layer it is on, by id: one of Project Settings ▸ Physics's.
   * Its layer decides what it meets — bodies, sensors and characters alike. A
   * layer the project no longer has collides as Default.
   */
  layer: { type: 'string', label: 'Layer', default: DEFAULT_LAYER_ID },
  /*
   * A shared physics material. While it names one, the collider is built with
   * that asset's friction, bounce and rules, and `material` is left untouched,
   * so unlinking falls back to it. One the project does not have leaves the
   * collider on its own values, and Play says so.
   */
  materialId: { type: 'asset', label: 'Material', kind: 'physicsMaterial', emptyLabel: 'Embedded', separatorBefore: true },
  /* How the surface grips and bounces, while `materialId` links no physics material. */
  material: { type: 'object', label: 'Material', fields: physicsMaterialFields },
} as const satisfies Schema;

export type ColliderComponent = Component<'collider', Infer<typeof colliderSchema>>;
export type ColliderShape = ColliderComponent['shape'];
export type ColliderShapeKind = ColliderShape['kind'];
export type ColliderShapeOf<K extends ColliderShapeKind> = Extract<ColliderShape, { kind: K }>;
export type MeshBuild = ColliderShapeOf<'mesh'>['build'];

/** A shape of this kind at its defaults, typed as that shape: a new value each time. */
export const createColliderShape = variantFactory(colliderShapeField);
