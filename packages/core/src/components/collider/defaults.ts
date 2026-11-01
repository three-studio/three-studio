import { conform, isMemberOf, oneOf } from '../../conform';
import { createId } from '../../ids';
import { DEFAULT_LAYER_ID } from '../../project/layers';
import { createPhysicsMaterial } from '../../scene/physicsMaterial';
import type { GeometryDef } from '../../scene/geometry';
import type { ComponentBase, Vec3 } from '../../scene/primitives';
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
  box: () => ({ kind: 'box', size: [1, 1, 1], rounding: 0, ...centred() }),
  sphere: () => ({ kind: 'sphere', radius: 0.5, center: [0, 0, 0] }),
  // The Capsule primitive's, caps included.
  capsule: () => ({ kind: 'capsule', radius: 0.5, height: 2, ...centred() }),
  // The Cylinder primitive's.
  cylinder: () => ({ kind: 'cylinder', radius: 0.5, height: 1, rounding: 0, ...centred() }),
  cone: () => ({ kind: 'cone', radius: 0.5, height: 1, rounding: 0, ...centred() }),
  mesh: () => ({ kind: 'mesh', build: 'triangles' }),
};

/** At its entity's middle, turned as its entity is. */
function centred(): { center: Vec3; rotation: Vec3 } {
  return { center: [0, 0, 0], rotation: [0, 0, 0] };
}

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
    materialId: null,
    isSensor: false,
    layer: DEFAULT_LAYER_ID,
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
  const kind =
    typeof value === 'object' && value !== null && 'kind' in value ? value.kind : undefined;
  if (!isMemberOf(kind, COLLIDER_SHAPE_LABELS)) return createColliderShape('box');

  // `conform` keeps the stored `kind`, the one just checked, and takes every
  // other string as it finds it: `build` is a union, read against its members.
  const shape = conform(value, createColliderShape(kind));
  if (shape.kind !== 'mesh') return shape;
  const build = oneOf(shape.build, MESH_BUILD_LABELS, createColliderShape('mesh').build);
  return { ...shape, build };
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
      return {
        ...createColliderShape('box'),
        size: [geometry.width, geometry.height, geometry.depth],
      };
    case 'sphere':
      return { ...createColliderShape('sphere'), radius: geometry.radius };
    case 'capsule':
      // three measures a capsule's straight part alone; a collider, end to end.
      return {
        ...createColliderShape('capsule'),
        radius: geometry.radius,
        height: geometry.height + 2 * geometry.radius,
      };
    case 'cylinder': {
      const { radiusTop, radiusBottom, height } = geometry;
      if (radiusTop === radiusBottom) {
        return { ...createColliderShape('cylinder'), radius: radiusTop, height };
      }
      // A cone collider's apex points up, so one drawn apex down is turned over.
      if (radiusTop === 0) return { ...createColliderShape('cone'), radius: radiusBottom, height };
      if (radiusBottom === 0) {
        const cone = createColliderShape('cone');
        return { ...cone, radius: radiusTop, height, rotation: [Math.PI, 0, 0] };
      }
      // Any one radius would be wrong for a frustum, and its hull is exact.
      return { kind: 'mesh', build: 'hull' };
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
