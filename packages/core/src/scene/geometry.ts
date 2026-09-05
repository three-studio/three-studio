/*
 * The geometry vocabulary: the shapes a component can be built out of, the
 * factory that produces one, and the two tables that read one.
 *
 * Shared rather than `mesh`'s own, because `water` is a plane and reads the
 * same definitions. A module beside `primitives.ts` rather than inside it: a
 * type and the factory that makes one belong together, and this is large
 * enough that keeping it with `Vec3` would have made "primitives" a drawer.
 */

// --- geometry ---------------------------------------------------------------

/**
 * One entry per three.js geometry class, rather than a generic "polyhedron"
 * with a shape field: the kind is what the binder switches on, what names the
 * entity and what the collider guess reads, so keeping it 1:1 with three means
 * none of those three tables needs a second lookup.
 */
export type GeometryDef =
  | {
      kind: 'box';
      width: number;
      height: number;
      depth: number;
      /** Subdivisions. Only matter under a displacement map, which moves vertices. */
      widthSegments: number;
      heightSegments: number;
      depthSegments: number;
    }
  | { kind: 'sphere'; radius: number; widthSegments: number; heightSegments: number }
  | { kind: 'plane'; width: number; height: number; widthSegments: number; heightSegments: number }
  | { kind: 'capsule'; radius: number; height: number; capSegments: number; radialSegments: number }
  | {
      kind: 'cylinder';
      radiusTop: number;
      radiusBottom: number;
      height: number;
      radialSegments: number;
    }
  | { kind: 'circle'; radius: number; segments: number }
  | { kind: 'ring'; innerRadius: number; outerRadius: number; thetaSegments: number }
  | { kind: 'torus'; radius: number; tube: number; radialSegments: number; tubularSegments: number }
  | {
      kind: 'torusKnot';
      radius: number;
      tube: number;
      tubularSegments: number;
      radialSegments: number;
      /** Winding counts. Coprime integers; anything else fails to close the knot. */
      p: number;
      q: number;
    }
  // The four solids take the same two arguments in three, so they share a shape
  // here too. `detail` subdivides towards a sphere.
  | { kind: 'tetrahedron'; radius: number; detail: number }
  | { kind: 'octahedron'; radius: number; detail: number }
  | { kind: 'dodecahedron'; radius: number; detail: number }
  | { kind: 'icosahedron'; radius: number; detail: number };

export type GeometryKind = GeometryDef['kind'];

/** Narrowed helper: `createGeometry` returns the union, which cannot be spread. */
export function createBoxGeometry(): Extract<GeometryDef, { kind: 'box' }> {
  return createGeometry('box') as Extract<GeometryDef, { kind: 'box' }>;
}

export function createGeometry(kind: GeometryKind): GeometryDef {
  switch (kind) {
    case 'box':
      return {
        kind,
        width: 1,
        height: 1,
        depth: 1,
        widthSegments: 1,
        heightSegments: 1,
        depthSegments: 1,
      };
    case 'sphere':
      return { kind, radius: 0.5, widthSegments: 32, heightSegments: 16 };
    case 'plane':
      return { kind, width: 10, height: 10, widthSegments: 1, heightSegments: 1 };
    case 'capsule':
      return { kind, radius: 0.5, height: 1, capSegments: 8, radialSegments: 16 };
    case 'cylinder':
      return { kind, radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 24 };
    case 'circle':
      return { kind, radius: 0.5, segments: 32 };
    case 'ring':
      return { kind, innerRadius: 0.25, outerRadius: 0.5, thetaSegments: 32 };
    case 'torus':
      return { kind, radius: 0.4, tube: 0.15, radialSegments: 16, tubularSegments: 48 };
    case 'torusKnot':
      return { kind, radius: 0.4, tube: 0.12, tubularSegments: 96, radialSegments: 16, p: 2, q: 3 };
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      return { kind, radius: 0.5, detail: 0 };
  }
}

export const GEOMETRY_LABELS: Record<GeometryKind, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  capsule: 'Capsule',
  cylinder: 'Cylinder',
  circle: 'Circle',
  ring: 'Ring',
  torus: 'Torus',
  torusKnot: 'Torus Knot',
  tetrahedron: 'Tetrahedron',
  octahedron: 'Octahedron',
  dodecahedron: 'Dodecahedron',
  icosahedron: 'Icosahedron',
};

/** three builds these in the XY plane, so they face the camera rather than up. */
export const FLAT_KINDS: ReadonlySet<GeometryKind> = new Set(['plane', 'circle', 'ring']);

/**
 * How far above its support point a fresh primitive's origin has to sit for the
 * shape to rest on that point rather than sink through it.
 *
 * Read in the entity's own frame, so the flat kinds answer zero: the rotation
 * `createMeshEntity` gives them has already laid them down, and a sheet on the
 * ground *is* the ground.
 *
 * Was a hard-coded `0.5`, which is the right answer for a unit cube and a
 * half-metre sphere and wrong for everything else — a torus floated by the
 * difference between its tube and that constant.
 */
export function restingOffsetY(geometry: GeometryDef): number {
  switch (geometry.kind) {
    case 'box':
    case 'cylinder':
      return geometry.height / 2;
    case 'sphere':
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'icosahedron':
      return geometry.radius;
    case 'capsule':
      // three's capsule height is the cylinder alone; the caps are extra.
      return geometry.height / 2 + geometry.radius;
    case 'plane':
    case 'circle':
    case 'ring':
      return 0;
    case 'torus':
      return geometry.tube;
    case 'torusKnot':
      // Exact, not a guess: three's `calculatePositionOnCurve` puts the curve at
      // `radius * (2 + cos θ) * 0.5` from the origin, so at most `radius * 1.5`.
      return geometry.radius * 1.5 + geometry.tube;
  }
}
