import { conform, isMemberOf, oneOf } from '../../conform';
import { createId } from '../../ids';
import { createPhysicsMaterial } from '../../scene/physicsMaterial';
import type { GeometryDef } from '../../scene/geometry';
import type { ComponentBase } from '../../scene/primitives';
import type { MeshComponent } from '../mesh/schema';
import {
  COLLIDER_SHAPE_LABELS,
  MESH_BUILD_LABELS,
  type ColliderComponent,
  type ColliderShape,
  type ColliderShapeKind,
  type ColliderShapeOf,
} from './schema';

/**
 * Each kind's default, checked against its own member: a factory that gave a
 * sphere a `size` would not compile.
 */
const SHAPE_FACTORIES: { readonly [K in ColliderShapeKind]: () => ColliderShapeOf<K> } = {
  box: () => ({ kind: 'box', size: [1, 1, 1] }),
  sphere: () => ({ kind: 'sphere', radius: 0.5 }),
  // The Capsule primitive's, caps included.
  capsule: () => ({ kind: 'capsule', radius: 0.5, height: 2 }),
  mesh: () => ({ kind: 'mesh', build: 'triangles' }),
};

/** A shape of this kind, at its defaults. */
export function createColliderShape<K extends ColliderShapeKind>(kind: K): ColliderShapeOf<K> {
  return SHAPE_FACTORIES[kind]();
}

/** A 1 m cube with the default material, which is what a bare entity gets. */
export function createCollider(): ColliderComponent {
  return {
    id: createId(),
    type: 'collider',
    shape: createColliderShape('box'),
    material: createPhysicsMaterial(),
    isSensor: false,
  };
}

/**
 * A stored shape, read against the factory of the kind it names.
 *
 * Against that kind's factory rather than the collider's: the collider's is a
 * box, and the wrong model for a stored sphere. A shape naming no kind this
 * build knows — a later one, or the bare name every collider held before scene
 * 11 — is the factory's box: its measures were written for another shape.
 */
export function conformColliderShape(value: unknown): ColliderShape {
  const kind = typeof value === 'object' && value !== null && 'kind' in value ? value.kind : undefined;
  if (!isMemberOf(kind, COLLIDER_SHAPE_LABELS)) return createColliderShape('box');

  // `conform` keeps the stored `kind`, the one just checked, and takes every
  // other string as it finds it: `build` is a union, read against its members.
  const shape = conform(value, createColliderShape(kind));
  if (shape.kind !== 'mesh') return shape;
  return { ...shape, build: oneOf(shape.build, MESH_BUILD_LABELS, createColliderShape('mesh').build) };
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
  const shape = collider.shape;
  switch (shape.kind) {
    case 'box':
      return shape.size[1] / 2;
    case 'sphere':
      return shape.radius;
    case 'capsule':
      // Never less than a cap: a capsule shorter than its diameter is built as its sphere.
      return Math.max(shape.height / 2, shape.radius);
    case 'mesh':
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
    if (hasModel) collider.shape = createColliderShape('mesh');
    return collider;
  }

  collider.shape = shapeOfGeometry(mesh.geometry);
  return collider;
}

/** The collider a primitive is drawn as, measured as it is drawn. */
function shapeOfGeometry(geometry: GeometryDef): ColliderShape {
  switch (geometry.kind) {
    case 'box':
      return { kind: 'box', size: [geometry.width, geometry.height, geometry.depth] };
    case 'sphere':
      return { kind: 'sphere', radius: geometry.radius };
    case 'capsule':
      // three measures a capsule's straight part alone; a collider, end to end.
      return { kind: 'capsule', radius: geometry.radius, height: geometry.height + 2 * geometry.radius };
    case 'cylinder': {
      const radius = Math.max(geometry.radiusTop, geometry.radiusBottom);
      return { kind: 'capsule', radius, height: geometry.height + 2 * radius };
    }
    case 'plane':
    case 'circle':
    case 'ring':
      // These have no volume. A thin box would be the obvious alternative, but
      // a slab thinner than the character controller's snap-to-ground distance
      // gets snapped straight through. The triangle mesh is the honest shape,
      // and its one hazard — catching on the diagonal where the two coplanar
      // triangles meet — is handled by Rapier's FIX_INTERNAL_EDGES.
      return createColliderShape('mesh');
    case 'torus':
    case 'torusKnot':
      // Concave: a convex hull would fill the hole, which is the whole point of
      // the shape.
      return createColliderShape('mesh');
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      // Convex by construction, and a hull is far cheaper than a triangle mesh.
      return { kind: 'mesh', build: 'hull' };
  }
}
