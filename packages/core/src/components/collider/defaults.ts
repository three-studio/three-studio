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
 * How far the bottom of a collider sits below the entity's origin.
 *
 * Physics centres a shape on the body it hangs from — a capsule and a cuboid
 * both straddle the origin — so an entity's origin is its *middle*, not its
 * feet. Anything that wants to place something at ground level has to subtract
 * this, and `PlayerController` is the one that taught us so: `eyeHeight` was
 * measured from the origin, which put the default player's eye at 2.2 m for a
 * character 1 m tall, with no way to work out the offset from the Inspector.
 *
 * **Zero for a mesh-derived shape is an answer, not a shrug.** A triangle mesh
 * and a convex hull are built from the entity's own geometry in its own local
 * space, so the origin is already wherever the author put it — usually the
 * feet, for a model exported to stand on a floor. It is also the only answer
 * the scene migration can give, having no geometry to measure, and the two must
 * agree or a migrated scene and a running one would disagree about the ground.
 *
 * Unscaled, like `eyeHeight` itself: both are read in the entity's own units.
 * Physics does scale the shape (see `describeCollider`), so a player entity at
 * anything other than scale 1 keeps the mismatch it has always had — correcting
 * one half of it here would be a second, invisible change of behaviour on top
 * of the one that was wanted.
 */
export function colliderHalfHeight(collider: ColliderComponent): number {
  switch (collider.shape) {
    case 'box':
      return collider.size[1];
    case 'sphere':
      return collider.radius;
    case 'capsule':
      return collider.halfHeight + collider.radius;
    case 'trimesh':
    case 'convexHull':
      return 0;
  }
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
