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
 * has to know this file exists. Two larger sub-vocabularies have modules of
 * their own beside this one, because each has factories as well as a type and
 * the two belong together: `geometry.ts` and `material.ts`.
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
