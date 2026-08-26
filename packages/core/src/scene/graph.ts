import { createId } from '../ids';
import {
  COMPONENT_TYPES,
  copyComponentsOf,
  dropComponentsOf,
  setComponentsOf,
} from './components';
import type { EntityTemplate } from './defaults';
import { splitInstancedId } from './prefab';
import { collectDescendants, cycles, isAncestorOf } from './query';
import type { EntityDoc, SceneDoc } from './schema';

/*
 * The one place the hierarchy is edited.
 *
 * The tree is stored three times over — `child.parent`, `parent.children[]` and
 * `scene.rootOrder` — which is what makes reparenting O(1) and immer patches
 * shallow (ADR-1). The price is that three writes have to agree, and until this
 * module existed the only thing checking that was `repairHierarchy`, at load
 * time. An edit that broke an edge stayed broken for the rest of the session:
 * that is B1.
 *
 * Two rules hold everything here together.
 *
 * **Refuse rather than corrupt.** Every function checks its arguments against
 * the document and returns `false` — or `[]`, or `null` — when the operation
 * cannot be performed. A partial write is worse than no write: the entity that
 * B1 loses is still rendered, still clickable, and reachable from nothing.
 *
 * **Never throw.** These run inside immer producers. An exception there leaves
 * the draft half-applied and the message reaches no one, so a refusal is a
 * return value the caller can notify about, not a failure it has to catch.
 *
 * They take a `SceneDoc` or an immer draft of one indifferently — a draft
 * behaves like the object, so there is one implementation rather than two.
 */

/**
 * Whether this id can be an edge of the document's own tree.
 *
 * An `owner/local` id names an entity prefab expansion produced. It is not in
 * `scene.entities`, so writing an edge to it produces exactly B1: a `parent`
 * pointing at nothing, and an entity in no children list at all.
 */
function isDocumentId(id: string): boolean {
  return splitInstancedId(id) === null;
}

/** The list `parentId` holds its children in, or `undefined` if there is none. */
function siblingsOf(scene: SceneDoc, parentId: string | null): string[] | undefined {
  if (parentId === null) return scene.rootOrder;
  return scene.entities[parentId]?.children;
}

/**
 * Whether `id` may be linked under `parentId`.
 *
 * Split out because `reparentEntity` has to know the answer *before* it unlinks
 * anything: checking afterwards would leave an entity detached from a move that
 * then turned out to be illegal.
 */
function canLink(scene: SceneDoc, id: string, parentId: string | null): boolean {
  if (!isDocumentId(id) || scene.entities[id] === undefined) return false;
  if (parentId === null) return true;
  if (parentId === id) return false;
  if (!isDocumentId(parentId) || scene.entities[parentId] === undefined) return false;
  // Dropping a node onto its own descendant would take the subtree out of the
  // scene with no way back to it.
  return !isAncestorOf(scene, id, parentId);
}

/** Detaches `id` from whichever list holds it, leaving `parent` as it was. */
export function unlinkEntity(scene: SceneDoc, id: string): boolean {
  const entity = scene.entities[id];
  if (!entity) return false;

  if (entity.parent === null) {
    scene.rootOrder = scene.rootOrder.filter((child) => child !== id);
    return true;
  }
  const parent = scene.entities[entity.parent];
  if (!parent) return false;
  parent.children = parent.children.filter((child) => child !== id);
  return true;
}

/**
 * Attaches `id` under `parentId`, at `index` or at the end.
 *
 * Assumes `id` is currently in no list — `reparentEntity` is what pairs this
 * with `unlinkEntity`. Linking something twice would put it in two lists, which
 * `validateHierarchy` reports and nothing else would notice.
 */
export function linkEntity(
  scene: SceneDoc,
  id: string,
  parentId: string | null,
  index?: number,
): boolean {
  if (!canLink(scene, id, parentId)) return false;

  const siblings = siblingsOf(scene, parentId);
  if (!siblings) return false;

  const entity = scene.entities[id];
  if (!entity) return false;
  entity.parent = parentId;

  const at = index === undefined || index < 0 || index > siblings.length ? siblings.length : index;
  siblings.splice(at, 0, id);
  return true;
}

/**
 * Adds an entity the document does not have yet, and links it in one step.
 *
 * Takes the entity and its components together, because they now live in two
 * places and inserting one without the other is a half-written document — the
 * failure this module exists to prevent, in a second dimension.
 */
export function insertEntity(
  scene: SceneDoc,
  template: EntityTemplate,
  parentId: string | null = null,
  index?: number,
): boolean {
  const { entity } = template;
  if (!isDocumentId(entity.id) || scene.entities[entity.id] !== undefined) return false;
  if (parentId !== null && (!isDocumentId(parentId) || scene.entities[parentId] === undefined)) {
    return false;
  }

  scene.entities[entity.id] = entity;
  setComponentsOf(scene, entity.id, template.components);
  if (linkEntity(scene, entity.id, parentId, index)) return true;

  // Unreachable as long as the checks above and `canLink` agree, but leaving a
  // half-inserted entity behind is the failure this module exists to prevent.
  delete scene.entities[entity.id];
  dropComponentsOf(scene, entity.id);
  return false;
}

/**
 * Moves `id` under `parentId`.
 *
 * Only the edges: the transform is the caller's business, because keeping an
 * object where it is across a reparent needs world matrices, and this package
 * has no maths in it. See `transformSpace.localTransformUnder`.
 */
export function reparentEntity(
  scene: SceneDoc,
  id: string,
  parentId: string | null,
  index?: number,
): boolean {
  // Asked first, and this is the whole of B1: `isAncestorOf` answers `false`
  // for an id the document does not have, so the ancestor guard alone looks
  // like it passed. It is not an existence check.
  if (!canLink(scene, id, parentId)) return false;
  if (!unlinkEntity(scene, id)) return false;
  return linkEntity(scene, id, parentId, index);
}

/**
 * Deletes `id` and everything under it, and says what went.
 *
 * The ids come back because the caller has to clean up after them — the
 * selection above all, which is how an undo of an Add leaves the gizmo pointing
 * at an entity that no longer exists (B2).
 */
export function removeSubtree(scene: SceneDoc, id: string): string[] {
  if (!isDocumentId(id) || scene.entities[id] === undefined) return [];

  const removed = [id, ...collectDescendants(scene, id)];
  // The root first, so its parent's `children` loses it before the entity goes;
  // descendants need no unlinking, since the lists holding them go too.
  unlinkEntity(scene, id);
  for (const victim of removed) {
    delete scene.entities[victim];
    // Components are keyed by entity id, not held by the entity, so deleting
    // one no longer takes them with it. Left behind they would be unreachable,
    // still serialised, and still counted by every query — invisible in exactly
    // the way B1 was.
    dropComponentsOf(scene, victim);
  }
  return removed;
}

/**
 * Deep-copies `id` and its descendants under `parentId`, returning the new id.
 *
 * `name` is the copy's name and only the root's: descendants keep theirs, which
 * is what Unity and Blender do — a duplicated `Parent` gives `Parent (1)` whose
 * child is still `Child`. Naming is the caller's job because it is a question
 * about the whole document (what names are taken), not about this subtree.
 */
export function cloneSubtree(
  scene: SceneDoc,
  sourceId: string,
  parentId: string | null,
  name?: string,
): string | null {
  const source = scene.entities[sourceId];
  if (!source || !isDocumentId(sourceId)) return null;

  const copy: EntityDoc = {
    ...deepCopy(source),
    id: createId(),
    name: name ?? source.name,
    parent: null,
    children: [],
  };

  scene.entities[copy.id] = copy;
  // Ids and all: a component id is unique within its entity, and an override
  // names one by it.
  copyComponentsOf(scene, sourceId, copy.id, deepCopy);
  if (!linkEntity(scene, copy.id, parentId)) {
    delete scene.entities[copy.id];
    dropComponentsOf(scene, copy.id);
    return null;
  }

  for (const childId of source.children) cloneSubtree(scene, childId, copy.id);
  return copy.id;
}

/**
 * A copy of plain data, through JSON.
 *
 * `structuredClone` is the obvious choice and it refuses an immer draft, which
 * is a Proxy — the old call site materialised the draft with `current()` first,
 * for which this package would have to depend on immer, and it depends on
 * nothing. Reading through the Proxy and writing JSON has neither problem, and
 * it is exact for an `EntityDoc` by construction: the document is defined as
 * what `serializeScene` writes to disk, so anything JSON loses here is
 * something a save loses too.
 */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Every way the three stored copies of the tree disagree, in plain words.
 *
 * A list rather than a boolean: a message naming the entity and the edge is the
 * difference between ten minutes and an afternoon. Empty means sound.
 *
 * Wired as a DEV assertion after every mutation (`documentStore.mutate`), so the
 * next operation that breaks an edge says so at once instead of waiting for a
 * reload to be quietly repaired by `repairHierarchy`.
 */
export function validateHierarchy(scene: SceneDoc): string[] {
  const problems: string[] = [];

  /** Which list claims each entity, so being in two is visible. */
  const claimedBy = new Map<string, string[]>();
  const claim = (id: string, by: string) => {
    const holders = claimedBy.get(id);
    if (holders) holders.push(by);
    else claimedBy.set(id, [by]);
  };

  for (const [index, id] of scene.rootOrder.entries()) {
    if (scene.entities[id] === undefined) {
      problems.push(`rootOrder[${index}] is "${id}", which is not in the table`);
      continue;
    }
    claim(id, 'rootOrder');
  }

  for (const [id, entity] of Object.entries(scene.entities)) {
    if (entity.id !== id) problems.push(`entities["${id}"] holds an entity whose id is "${entity.id}"`);

    for (const [index, childId] of entity.children.entries()) {
      if (scene.entities[childId] === undefined) {
        problems.push(`"${id}".children[${index}] is "${childId}", which is not in the table`);
        continue;
      }
      claim(childId, `"${id}".children`);
    }

    if (entity.parent === null) continue;

    const parent = scene.entities[entity.parent];
    if (!parent) {
      problems.push(`"${id}".parent is "${entity.parent}", which is not in the table`);
    } else if (!parent.children.includes(id)) {
      problems.push(`"${id}" claims "${entity.parent}" as its parent, which does not list it`);
    }
  }

  for (const id of Object.keys(scene.entities)) {
    const holders = claimedBy.get(id) ?? [];
    if (holders.length === 0) {
      problems.push(`"${id}" is in no children list and not in rootOrder — unreachable`);
    } else if (holders.length > 1) {
      problems.push(`"${id}" appears in ${holders.length} lists: ${holders.join(', ')}`);
    }
  }

  // Components keyed by an entity that is not there. Nothing draws them and
  // nothing lists them, but a save writes them out and every query counts them,
  // so the only way to notice is to ask.
  for (const type of COMPONENT_TYPES) {
    for (const entityId of Object.keys(scene.components[type])) {
      if (scene.entities[entityId] === undefined) {
        problems.push(`components.${type} holds "${entityId}", which is not in the entity table`);
      }
    }
  }

  problems.push(...cycles(scene).map((chain) => `cycle: ${chain.join(' → ')}`));
  return problems;
}
