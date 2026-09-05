import type { ComponentBase, Vec3 } from '../../scene/primitives';

export interface ColliderComponent extends ComponentBase {
  type: 'collider';
  shape: 'box' | 'sphere' | 'capsule' | 'trimesh' | 'convexHull';
  /** Box half-extents. */
  size: Vec3;
  radius: number;
  halfHeight: number;
  friction: number;
  restitution: number;
  /** Sensors report overlaps without resolving them. */
  isSensor: boolean;
}
