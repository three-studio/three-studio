import { createId } from '../../ids';
import type { ComponentBase } from '../../scene/primitives';
import type { MeshComponent } from '../mesh/schema';
import type { ColliderComponent } from './schema';

export function createCollider(): ColliderComponent {
  return {
    id: createId(),
    type: 'collider',
    shape: 'box',
    size: [0.5, 0.5, 0.5],
    radius: 0.5,
    halfHeight: 0.5,
    friction: 0.7,
    restitution: 0,
    isSensor: false,
  };
}

/**
 * Enough of a sibling to recognise one by.
 *
 * `ComponentDoc` is what the caller actually holds, and this file may not name
 * it: the union imports the twelve slices, so a single import back the other
 * way makes this one a cycle — and, once it is a precedent, twelve of them.
 * What gets read here is a `type` tag and, on a mesh, its geometry, so that is
 * all this asks for. The mesh itself is named, because a collider guessed from
 * a mesh depends on the mesh: that is the coupling, not an accident of it.
 */
type Sibling = ComponentBase & { type: string };

/**
 * A collider shaped from what the entity it joins already has — added to a
 * capsule mesh, it comes out as a matching capsule.
 *
 * A collider whose size has nothing to do with the object it belongs to is the
 * kind of thing an author only notices once the physics behaves oddly, so the
 * guess is worth making.
 *
 * Here rather than in `components/index.ts`, where it was a sixty-line switch
 * on `GeometryKind` behind an `if (type !== 'collider')`: every line of it is
 * knowledge about colliders, and none of it about the registry that was
 * holding it.
 */
export function createColliderFor(siblings: readonly Sibling[]): ColliderComponent {
  const mesh = siblings.find((c): c is MeshComponent => c.type === 'mesh');
  const collider = createCollider();

  if (!mesh) {
    // A model's real shape is only known once it has loaded, so fall back to
    // the mesh it renders rather than an arbitrary box.
    const hasModel = siblings.some((c) => c.type === 'model');
    if (hasModel) collider.shape = 'trimesh';
    return collider;
  }

  const geometry = mesh.geometry;
  switch (geometry.kind) {
    case 'box':
      collider.shape = 'box';
      collider.size = [geometry.width / 2, geometry.height / 2, geometry.depth / 2];
      break;
    case 'sphere':
      collider.shape = 'sphere';
      collider.radius = geometry.radius;
      break;
    case 'capsule':
      collider.shape = 'capsule';
      collider.radius = geometry.radius;
      collider.halfHeight = geometry.height / 2;
      break;
    case 'cylinder':
      collider.shape = 'capsule';
      collider.radius = Math.max(geometry.radiusTop, geometry.radiusBottom);
      collider.halfHeight = geometry.height / 2;
      break;
    case 'plane':
    case 'circle':
    case 'ring':
      // These have no volume. A thin box would be the obvious alternative, but
      // a slab thinner than the character controller's snap-to-ground distance
      // gets snapped straight through. The triangle mesh is the honest shape,
      // and its one hazard — catching on the diagonal where the two coplanar
      // triangles meet — is handled by Rapier's FIX_INTERNAL_EDGES.
      collider.shape = 'trimesh';
      break;
    case 'torus':
    case 'torusKnot':
      // Concave: a convex hull would fill the hole, which is the whole point of
      // the shape.
      collider.shape = 'trimesh';
      break;
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      // Convex by construction, and a hull is far cheaper than a triangle mesh.
      collider.shape = 'convexHull';
      break;
  }

  return collider;
}
