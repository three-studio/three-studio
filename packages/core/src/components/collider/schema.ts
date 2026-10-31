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
      /** The full size along each axis, as a box mesh's width, height and depth read. */
      size: Vec3;
    }
  | { kind: 'sphere'; radius: number }
  | {
      kind: 'capsule';
      radius: number;
      /**
       * From end to end, caps included, along its own y: a 1.70 m person is 1.7.
       * A capsule mesh measures its straight part alone.
       */
      height: number;
    }
  | {
      kind: 'cylinder';
      radius: number;
      /** From end to end, along its own y. */
      height: number;
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
    }
  | {
      kind: 'mesh';
      /** How the entity's own geometry is made into a shape. */
      build: MeshBuild;
    };

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
