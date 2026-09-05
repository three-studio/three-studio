/**
 * The vocabulary a component is described in, below the union of components.
 *
 * These lived in `schema.ts` beside the union until a component type moved into
 * a folder of its own. That is what put them here: a slice imports the
 * vocabulary, and the union imports the slices, so the two cannot share a
 * module without every slice becoming an import cycle — one the architecture
 * test would name, and one that would be twelve files wide by the end.
 *
 * `schema.ts` re-exports all of it, so nothing that reads the scene document
 * has to know this file exists. It grows one slice at a time: geometry and
 * `MaterialSide` arrived with `water`, the first type in a folder of its own
 * to be described in them.
 *
 * Everything here must stay JSON-serialisable and structurally cloneable.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** `#rrggbb`. */
export type Hex = string;

export interface Transform {
  position: Vec3;
  /** Euler XYZ in radians. Degrees are a presentation concern of the inspector. */
  rotation: Vec3;
  scale: Vec3;
}

/**
 * What every component carries, whatever its type.
 *
 * The id is what a prefab override names and what the binder keys its builds
 * on. Before it, both used the component's **position** in the array: adding a
 * component to a prefab slid every override of every instance onto the wrong
 * one (B10), and removing one paired a cube's build with a sphere's component.
 *
 * Opaque. The migration happens to mint `<entityId>:<index>` — see
 * `serialization.ts` for why that particular shape — and nothing may read it
 * back out. An id that can be parsed into a position is a position again.
 */
export interface ComponentBase {
  id: string;
}

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

/** Which faces are drawn. Named because two component types now take it. */
export type MaterialSide = 'front' | 'back' | 'double';
