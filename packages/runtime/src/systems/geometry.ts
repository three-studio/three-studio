import type { GeometryDef } from '@three-studio/core';
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
} from 'three/webgpu';

/*
 * Turning a `GeometryDef` into buffers, and naming one so two identical
 * definitions can share a single set.
 *
 * Pure: no pool, no arena, no binder. Which is the point of taking it out —
 * "does this description produce these buffers" is now a question that can be
 * asked without a scene.
 */

/**
 * A definition's identity, independent of how the object holding it was built.
 *
 * Sorted entries rather than `JSON.stringify` directly, because property order
 * depends on which build of the editor wrote the scene, and two orderings must
 * not mean two different things.
 */
export function stableKey(value: object): string {
  return JSON.stringify(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/** Two meshes described the same way are the same buffers. */
export function geometryKeyOf(def: GeometryDef): string {
  return stableKey(def);
}


export function buildGeometry(def: GeometryDef): BufferGeometry {
  switch (def.kind) {
    case 'box':
      return new BoxGeometry(
        def.width,
        def.height,
        def.depth,
        def.widthSegments,
        def.heightSegments,
        def.depthSegments,
      );
    case 'sphere':
      return new SphereGeometry(def.radius, def.widthSegments, def.heightSegments);
    case 'plane':
      return new PlaneGeometry(def.width, def.height, def.widthSegments, def.heightSegments);
    case 'capsule':
      return new CapsuleGeometry(def.radius, def.height, def.capSegments, def.radialSegments);
    case 'cylinder':
      return new CylinderGeometry(def.radiusTop, def.radiusBottom, def.height, def.radialSegments);
    case 'circle':
      return new CircleGeometry(def.radius, def.segments);
    case 'ring':
      return new RingGeometry(def.innerRadius, def.outerRadius, def.thetaSegments);
    case 'torus':
      return new TorusGeometry(def.radius, def.tube, def.radialSegments, def.tubularSegments);
    case 'torusKnot':
      return new TorusKnotGeometry(
        def.radius,
        def.tube,
        def.tubularSegments,
        def.radialSegments,
        def.p,
        def.q,
      );
    case 'tetrahedron':
      return new TetrahedronGeometry(def.radius, def.detail);
    case 'octahedron':
      return new OctahedronGeometry(def.radius, def.detail);
    case 'dodecahedron':
      return new DodecahedronGeometry(def.radius, def.detail);
    case 'icosahedron':
      return new IcosahedronGeometry(def.radius, def.detail);
  }
}
