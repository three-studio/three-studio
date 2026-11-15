import { planFields, type Infer, type Schema } from '../fieldSchema';

/*
 * The geometry vocabulary: the shapes a mesh can be built out of, the factory
 * that produces one, and the two tables that read one.
 *
 * A module beside `primitives.ts` rather than inside it: a type and the
 * factory that makes one belong together, and this is large enough that
 * keeping it with `Vec3` would have made "primitives" a drawer. A water surface
 * is a plane, and its geometry field infers this plane's shape.
 */

// --- geometry ---------------------------------------------------------------

/** A size, in metres. */
const size = (label: string, fallback: number, step: number, min = 0.01) =>
  ({ type: 'number', label, default: fallback, min, step }) as const;

/** A segment count: whole, and bounded, since each one costs triangles. */
const segments = (label: string, fallback: number, min: number, max: number) =>
  ({ type: 'number', label, default: fallback, min, max, step: 1 }) as const;

/** Segments a primitive is built with and that no row offers. */
const hidden = (label: string, fallback: number) => ({ type: 'number', label, default: fallback, shown: false }) as const;

/**
 * The four solids take the same two arguments in three, so they share their
 * fields here too. `detail` subdivides towards a sphere, and is capped low on
 * purpose: it is exponential, and 5 already puts one solid past a hundred
 * thousand triangles.
 */
const SOLID = {
  radius: size('Radius', 0.5, 0.1),
  detail: { type: 'number', label: 'Subdivisions', default: 0, min: 0, max: 5, step: 1 },
} as const;

/**
 * A mesh's primitive, one variant per three.js geometry class rather than a
 * generic "polyhedron" with a shape field: the kind is what the binder switches
 * on, what names the entity and what the collider guess reads, so keeping it
 * 1:1 with three means none of those tables needs a second lookup.
 *
 * Its selector has no row: the primitive is chosen when the mesh is added, and
 * the variants' labels are what the Add menu offers.
 */
export const geometryField = {
  type: 'union',
  label: 'Primitive',
  default: 'box',
  shown: false,
  variants: {
    box: {
      label: 'Cube',
      fields: {
        width: size('Width', 1, 0.1),
        height: size('Height', 1, 0.1),
        depth: size('Depth', 1, 0.1),
        // Displacement moves vertices, so a one-segment face cannot show any of it.
        widthSegments: segments('Segments X', 1, 1, 256),
        heightSegments: segments('Segments Y', 1, 1, 256),
        depthSegments: segments('Segments Z', 1, 1, 256),
      },
    },
    sphere: {
      label: 'Sphere',
      fields: {
        radius: size('Radius', 0.5, 0.1),
        widthSegments: segments('Segments U', 32, 3, 128),
        heightSegments: segments('Segments V', 16, 2, 64),
      },
    },
    plane: {
      label: 'Plane',
      fields: {
        width: size('Width', 10, 0.5),
        height: size('Height', 10, 0.5),
        widthSegments: segments('Segments X', 1, 1, 512),
        heightSegments: segments('Segments Y', 1, 1, 512),
      },
    },
    capsule: {
      label: 'Capsule',
      fields: {
        radius: size('Radius', 0.5, 0.1),
        height: size('Height', 1, 0.1),
        capSegments: hidden('Cap segments', 8),
        radialSegments: hidden('Radial segments', 16),
      },
    },
    cylinder: {
      label: 'Cylinder',
      fields: {
        radiusTop: size('Radius top', 0.5, 0.1, 0),
        radiusBottom: size('Radius bottom', 0.5, 0.1, 0),
        height: size('Height', 1, 0.1),
        radialSegments: hidden('Radial segments', 24),
      },
    },
    circle: {
      label: 'Circle',
      fields: { radius: size('Radius', 0.5, 0.1), segments: segments('Segments', 32, 3, 128) },
    },
    ring: {
      label: 'Ring',
      fields: {
        innerRadius: size('Inner radius', 0.25, 0.05, 0),
        outerRadius: size('Outer radius', 0.5, 0.05),
        thetaSegments: segments('Segments', 32, 3, 128),
      },
    },
    torus: {
      label: 'Torus',
      fields: {
        radius: size('Radius', 0.4, 0.05),
        tube: size('Tube', 0.15, 0.02),
        radialSegments: segments('Segments U', 16, 3, 64),
        tubularSegments: segments('Segments V', 48, 3, 256),
      },
    },
    torusKnot: {
      label: 'Torus Knot',
      fields: {
        radius: size('Radius', 0.4, 0.05),
        tube: size('Tube', 0.12, 0.02),
        // Winding counts. Coprime integers; anything else fails to close the knot.
        p: { type: 'number', label: 'Winding P', default: 2, min: 1, max: 20, step: 1 },
        q: { type: 'number', label: 'Winding Q', default: 3, min: 1, max: 20, step: 1 },
        radialSegments: segments('Segments U', 16, 3, 64),
        tubularSegments: segments('Segments V', 96, 3, 512),
      },
    },
    tetrahedron: { label: 'Tetrahedron', fields: SOLID },
    octahedron: { label: 'Octahedron', fields: SOLID },
    dodecahedron: { label: 'Dodecahedron', fields: SOLID },
    icosahedron: { label: 'Icosahedron', fields: SOLID },
  },
} as const;

/** The geometry alone, as a schema: what its type is inferred from and its factory planned on. */
const geometrySchema = { geometry: geometryField } as const satisfies Schema;

export type GeometryDef = Infer<typeof geometrySchema>['geometry'];
export type GeometryKind = GeometryDef['kind'];

const geometryPlan = planFields(geometrySchema);

/** Whether a primitive is of `kind`, by the one field that says it. */
function isOfKind<K extends GeometryKind>(geometry: GeometryDef, kind: K): geometry is Extract<GeometryDef, { kind: K }> {
  return geometry.kind === kind;
}

/** A primitive of `kind` at its defaults, typed as that primitive: a new value each time. */
export function createGeometry<K extends GeometryKind>(kind: K): Extract<GeometryDef, { kind: K }> {
  const geometry = geometryPlan.createVariant('geometry', kind);
  if (!isOfKind(geometry, kind)) throw new Error(`The variant "${kind}" came back as "${geometry.kind}"`);
  return geometry;
}

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
