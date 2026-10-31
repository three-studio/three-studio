import type { BuiltShape, Vec3 } from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Mesh, Vector3, type Object3D } from 'three/webgpu';

/*
 * Mesh colliders: built from the entity's own geometry, which has to be gathered
 * from three's objects before Rapier can see it, in one of the ways a mesh
 * collider can be built, each falling back to a simpler one.
 */

/**
 * What stands where nothing can be built: a box 2 cm across, which a player
 * walks straight past, and which the engine warns about when the entity has no
 * geometry at all.
 */
function tinyBox(): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.cuboid(0.01, 0.01, 0.01);
}

/** A mesh collider, built from the vertices of the entity's object as `built` says. */
export function describeMesh(
  object: Object3D,
  built: Extract<BuiltShape, { kind: 'mesh' }>,
): RAPIER.ColliderDesc {
  const vertices = collectVertices(object, built.scale);
  if (!vertices) return tinyBox();
  switch (built.build) {
    case 'triangles':
      return RAPIER.ColliderDesc.trimesh(
        vertices.positions,
        vertices.indices,
        // Without this, a character catches on the shared edge between two
        // coplanar triangles — which is every seam in every imported piece of
        // level geometry. It cost half the strafing speed on a floor made of
        // two triangles, and only in the directions that crossed the diagonal.
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      );
    case 'hull':
      // Rapier hulls even a flat mesh; a soup it cannot hull gives nothing.
      return RAPIER.ColliderDesc.convexHull(vertices.positions) ?? tinyBox();
  }
}

/**
 * Flattens an entity's meshes into one vertex soup, in the entity's local space,
 * each vertex times `scale`.
 */
export function collectVertices(
  object: Object3D,
  scale: Vec3,
): { positions: Float32Array; indices: Uint32Array } | null {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  let found = false;

  object.updateWorldMatrix(true, true);
  _parentInverse.copy(object.matrixWorld).invert();
  const [sx, sy, sz] = scale;

  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const attribute = child.geometry.getAttribute('position');
    if (!attribute) return;
    found = true;

    _localMatrix.multiplyMatrices(_parentInverse, child.matrixWorld);

    for (let i = 0; i < attribute.count; i++) {
      _vertex.fromBufferAttribute(attribute, i).applyMatrix4(_localMatrix);
      positions.push(_vertex.x * sx, _vertex.y * sy, _vertex.z * sz);
    }

    const index = child.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < attribute.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += attribute.count;
  });

  if (!found) return null;
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const _parentInverse = new Matrix4();
const _localMatrix = new Matrix4();
const _vertex = new Vector3();
