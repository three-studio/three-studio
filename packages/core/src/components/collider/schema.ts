import type { ComponentBase, Vec3 } from '../../scene/primitives';

/** What the physics engine is asked to build. */
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'trimesh' | 'convexHull';

export const COLLIDER_SHAPE_LABELS: Record<ColliderShape, string> = {
  box: 'Box',
  sphere: 'Sphere',
  capsule: 'Capsule',
  convexHull: 'Convex hull',
  trimesh: 'Triangle mesh',
};

export interface ColliderComponent extends ComponentBase {
  type: 'collider';
  shape: ColliderShape;
  /** Box half-extents. */
  size: Vec3;
  radius: number;
  halfHeight: number;
  friction: number;
  restitution: number;
  /** Sensors report overlaps without resolving them. */
  isSensor: boolean;
}
