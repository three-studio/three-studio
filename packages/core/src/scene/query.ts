import type { SceneDoc } from './schema';

/*
 * `findComponent` was here, taking an `EntityDoc`. It lives in `components.ts`
 * now and takes the document and an entity id, because an entity no longer
 * holds its components — see ADR-16.
 */

/*
 * `visitEntities` was here, a depth-first walk from the scene roots, and it was
 * removed in phase 1 with no caller it ever had.
 *
 * It looked like the canonical traversal the four hand-written walks should have
 * used, and it fitted none of them: `buildRows` descends conditionally and over
 * children *derived* from prefab expansion rather than the ones in the document,
 * `collectDescendants` starts from an id instead of the roots, `expandedChildren`
 * builds an index. Fitting all three would have meant passing in both the
 * children and the descent test, which is more ceremony than the twenty-line
 * `walk` each of them already has. Written down so it is not re-added as an
 * obvious missing piece.
 */

/** Every descendant of `id`, excluding `id` itself, in depth-first order. */
export function collectDescendants(scene: SceneDoc, id: string): string[] {
  const out: string[] = [];
  // A cycle would otherwise loop for ever, and this runs on delete — where the
  // document may already be in the state that made the cycle worth finding.
  const seen = new Set<string>([id]);
  const stack: string[] = [];
  // A loop rather than `push(...children)`: the spread passes one argument per
  // child, and a node with a very high degree overflows the argument limit.
  for (const child of scene.entities[id]?.children ?? []) stack.push(child);

  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    for (const child of scene.entities[next]?.children ?? []) stack.push(child);
  }
  return out;
}

/**
 * Guards reparenting: dropping an entity onto one of its own descendants would
 * detach that subtree from the scene and leak it.
 *
 * Answers `false` for an id the document does not hold, which reads like a guard
 * that passed and is not one — this is not an existence check, and mistaking it
 * for one is B1. Callers wanting both want `graph.reparentEntity`.
 */
export function isAncestorOf(scene: SceneDoc, ancestorId: string, id: string): boolean {
  const seen = new Set<string>();
  let current = scene.entities[id]?.parent ?? null;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = scene.entities[current]?.parent ?? null;
  }
  return false;
}

/**
 * Parent chains that close on themselves, one entry per cycle.
 *
 * Lives here, in the module that depends on nothing but the schema, because both
 * ends of the hierarchy need it and they cannot see each other: `graph.ts`
 * reports cycles as violations, and `repairHierarchy` cuts them at load — and
 * `graph.ts` already imports `prefab.ts`, which imports `serialization.ts`.
 *
 * Filtering dangling references cannot find a cycle, which is why load-time
 * repair never caught one: every edge of a cycle points at an entity that
 * exists. What gives it away is that a cycle is unreachable from `rootOrder`, so
 * the hierarchy panel simply does not draw the entities caught in it.
 */
export function cycles(scene: SceneDoc): string[][] {
  const found: string[][] = [];
  /** Ids already known to reach a root, or to belong to a cycle reported below. */
  const settled = new Set<string>();

  for (const start of Object.keys(scene.entities)) {
    if (settled.has(start)) continue;

    const path: string[] = [];
    const onPath = new Set<string>();
    let current: string | null = start;

    while (current !== null && !settled.has(current)) {
      if (onPath.has(current)) {
        found.push([...path.slice(path.indexOf(current)), current]);
        break;
      }
      path.push(current);
      onPath.add(current);
      current = scene.entities[current]?.parent ?? null;
    }

    for (const id of path) settled.add(id);
  }

  return found;
}

/** Chain of ids from the root down to `id`, inclusive. */
export function entityWorldMatrixPath(scene: SceneDoc, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null && !seen.has(current)) {
    path.unshift(current);
    seen.add(current);
    current = scene.entities[current]?.parent ?? null;
  }
  return path;
}
