import type { BuiltShape, Vec3 } from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Mesh, Vector3, type Object3D } from 'three/webgpu';
import { MeshCache } from './MeshCache';

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

/**
 * How finely V-HACD voxelises a mesh it cuts into convex parts: how faithfully a
 * mesh is approximated, not a gameplay number. Rapier's default of 64 took
 * 238 ms on a torus and 5.4 s on a sphere of 100 000 vertices; 32 took 60 ms and
 * 1.1 s, and the torus kept its hole. A hole narrower than about a thirty-second
 * of the mesh closes.
 */
const PARTS_RESOLUTION = 32;

/**
 * Each mesh's convex parts, or `null` where it decomposed to nothing, for as
 * long as the page lives: the editor's window, a device's player or an exported
 * game. A second Play reuses what the first computed. The parts are Rapier's
 * own description of a shape, not a body of any world, so one world's disposal
 * leaves them whole and another builds from them as the first did.
 */
const PARTS = new MeshCache<RAPIER.Shape | null>();

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
      return hullOf(vertices.positions);
    case 'parts': {
      const { positions, indices } = vertices;
      const parts = PARTS.get(positions, indices, () => {
        const resolution = PARTS_RESOLUTION;
        return RAPIER.ColliderDesc.convexDecomposition(positions, indices, { resolution })?.shape ?? null;
      });
      // A mesh that decomposes to nothing is its hull.
      return parts ? new RAPIER.ColliderDesc(parts) : hullOf(positions);
    }
  }
}

function hullOf(positions: Float32Array): RAPIER.ColliderDesc {
  // Rapier hulls even a flat mesh; a soup it cannot hull gives nothing.
  return RAPIER.ColliderDesc.convexHull(positions) ?? tinyBox();
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
