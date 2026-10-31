import type { PhysicsMaterialDef } from '../../scene/physicsMaterial';
import type { ComponentBase, Vec3 } from '../../scene/primitives';

/**
 * What the physics engine is asked to build, measured as it is drawn.
 *
 * Each kind carries its own measures and nothing else. It was one flat bag of
 * `size`, `radius` and `halfHeight` that every kind shared, half of it ignored
 * by whichever kind was chosen, and the box read its `size` as half extents
 * while the mesh beside it read width, height and depth whole.
 */
export type ColliderShape =
  | {
      kind: 'box';
      /** The full size along each of its own axes, as a box mesh's width, height and depth read. */
      size: Vec3;
      rounding: number;
      center: Vec3;
      rotation: Vec3;
    }
  | { kind: 'sphere'; radius: number; center: Vec3 }
  | {
      kind: 'capsule';
      radius: number;
      /**
       * From end to end, caps included, along its own y: a 1.70 m person is 1.7.
       * A capsule mesh measures its straight part alone.
       */
      height: number;
      center: Vec3;
      rotation: Vec3;
    }
  | {
      kind: 'cylinder';
      radius: number;
      /** From end to end, along its own y. */
      height: number;
      rounding: number;
      center: Vec3;
      rotation: Vec3;
    }
  | {
      kind: 'cone';
      /** Its base's. */
      radius: number;
      /**
       * From base to apex, along its own y. The apex points up, as three draws a
       * Cylinder whose top radius is 0.
       */
      height: number;
      rounding: number;
      center: Vec3;
      rotation: Vec3;
    }
  | {
      kind: 'mesh';
      /** How the entity's own geometry is made into a shape. */
      build: MeshBuild;
    };

/*
 * `rounding` is the radius of a shape's rounded edges and corners, in metres; 0
 * is sharp. The outside stays the size drawn: a rounded 1 m box still stands
 * 1 m tall, and rolls over its corners where a sharp one catches.
 *
 * `center` is where a shape's middle sits, in its entity's frame and units:
 * Unity's *Center*, which stands a capsule above a model's feet with no child
 * entity to carry it. `rotation` turns a shape on its entity, Euler XYZ in
 * radians as `Transform.rotation` is. Both live in the shapes that have them
 * rather than on the collider: a sphere turned is the same sphere, and a mesh
 * collider is its entity's own geometry, already where it is drawn — on the
 * collider they would be fields that do nothing for some kinds.
 */

/**
 * How a mesh collider is made of the entity's geometry.
 *
 * *Triangles* is exact: a surface with no inside, for what does not move with
 * physics. *Convex hull* is one cheap solid, its holes and hollows filled in.
 */
export type MeshBuild = 'triangles' | 'hull';

export type ColliderShapeKind = ColliderShape['kind'];
export type ColliderShapeOf<K extends ColliderShapeKind> = Extract<ColliderShape, { kind: K }>;

export const COLLIDER_SHAPE_LABELS: Record<ColliderShapeKind, string> = {
  box: 'Box',
  sphere: 'Sphere',
  capsule: 'Capsule',
  cylinder: 'Cylinder',
  cone: 'Cone',
  mesh: 'Mesh',
};

export const MESH_BUILD_LABELS: Record<MeshBuild, string> = {
  triangles: 'Triangles',
  hull: 'Convex hull',
};

export interface ColliderComponent extends ComponentBase {
  type: 'collider';
  shape: ColliderShape;
  /** How the surface grips and bounces. */
  material: PhysicsMaterialDef;
  /** Sensors report overlaps without resolving them. */
  isSensor: boolean;
}
