import { componentsOfType, entitiesWith } from './components';
import type { SceneDoc } from './schema';

/*
 * Which body each collider rides.
 *
 * A collider rides the nearest entity up the tree, its own included, that holds
 * a Rigid Body — Unity's rule, and Godot's body made of its child shapes. With
 * none above it, it is level geometry: a fixed body of its own entity. A child
 * with a Rigid Body of its own keeps it, and so does whatever rides it.
 *
 * Written once, because three readers must agree: the build, the engine's
 * warnings and the editor's companions. Apart, the build attached a child's
 * collider to its parent while the warning said of the same body that it had
 * none.
 *
 * Walked up from each collider, never down from a body: in an expanded scene a
 * prefab's contents name the entity that placed them as their parent, and that
 * entity's `children` is the document's, which cannot name them.
 */

/** Every body the scene builds, by the entity it sits on, with the entities whose colliders it carries. */
export function physicsBodies(scene: SceneDoc): ReadonlyMap<string, readonly string[]> {
  const withBody = new Set(entitiesWith(scene, 'rigidbody'));
  const bodies = new Map<string, string[]>([...withBody].map((entityId) => [entityId, []]));
  for (const entityId of entitiesWith(scene, 'collider')) {
    const body = riddenBy(scene, entityId, withBody) ?? entityId;
    const carried = bodies.get(body);
    if (carried) carried.push(entityId);
    else bodies.set(body, [entityId]);
  }
  return bodies;
}

/** The entities whose colliders a body on `entityId` would carry, whether it holds its Rigid Body yet or not. */
export function collidersOfBody(scene: SceneDoc, entityId: string): readonly string[] {
  const withBody = new Set(entitiesWith(scene, 'rigidbody')).add(entityId);
  return entitiesWith(scene, 'collider').filter(
    (collider) => riddenBy(scene, collider, withBody) === entityId,
  );
}

/**
 * The entity whose Rigid Body carries the colliders of `entityId`: the nearest
 * up the tree, its own included. `null` when no entity above it holds one, and
 * its colliders are level geometry.
 *
 * The editor's collider outline asks it for each selected collider on every
 * frame, so it looks each entity up in the Rigid Body table rather than
 * gathering the table first: the cost is the entity's depth, whatever the scene
 * holds.
 */
export function bodyOf(scene: SceneDoc, entityId: string): string | null {
  const rigidbodies = componentsOfType(scene, 'rigidbody');
  return riddenBy(scene, entityId, { has: (id) => Object.hasOwn(rigidbodies, id) });
}

/**
 * The nearest of `bodies` up the tree from `entityId`, its own included, or
 * `null`. A cycle in a broken document ends the walk rather than looping it.
 *
 * Reads the colliders' entities and what lies above them, and nothing else: a
 * scene of two thousand props and a dozen colliders reads the dozen and their
 * ancestors.
 */
function riddenBy(
  scene: SceneDoc,
  entityId: string,
  bodies: Pick<ReadonlySet<string>, 'has'>,
): string | null {
  const seen = new Set<string>();
  let current: string | null = entityId;
  while (current !== null && !seen.has(current)) {
    if (bodies.has(current)) return current;
    seen.add(current);
    current = scene.entities[current]?.parent ?? null;
  }
  return null;
}
