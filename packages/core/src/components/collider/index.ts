import type { GeometryDef } from '../../scene/geometry';
import type { ComponentDoc } from '../../scene/schema';
import { defineComponent } from '../registry';
import { colliderSchema, createColliderShape, type ColliderComponent, type ColliderShape } from './schema';

/** What a collider is: see `colliderSchema`. */
export const colliderType = defineComponent({
  id: 'collider',
  label: 'Collider',
  version: 1,
  schema: colliderSchema,
  runtime: true,
  addable: true,
  // A body is shaped by all the colliders that ride it: a compound of simple
  // shapes, several of them on one entity.
  multiple: true,
  createFor: createColliderFor,
  // A mesh Collider is built from its own entity's meshes. Once Unpack Model
  // has passed the drawing to the pieces the host has none, so a copy goes to
  // each piece that draws, and the model collides as it did.
  followsDrawing: (collider) => collider.shape.kind === 'mesh',
});

/**
 * A collider shaped from what the entity it joins already has — added to a
 * capsule mesh, it comes out as a matching capsule.
 *
 * A collider whose size has nothing to do with the object it belongs to is the
 * kind of thing an author only notices once the physics behaves oddly, so the
 * guess is worth making. It reads the mesh and the model it would be shaped
 * from: a collider guessed from a mesh depends on the mesh, and that is the
 * coupling, not an accident of it.
 */
function createColliderFor(siblings: readonly ComponentDoc[]): ColliderComponent {
  const mesh = siblings.find((sibling) => sibling.type === 'mesh');
  const collider = colliderType.create();

  if (mesh?.type !== 'mesh') {
    // A model's real shape is only known once it has loaded, so fall back to
    // the mesh it renders rather than an arbitrary box.
    const hasModel = siblings.some((sibling) => sibling.type === 'model');
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
