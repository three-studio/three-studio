import { blankComponent, createEntity, type EntityTemplate } from './defaults';
import type { Transform } from './schema';


/*
 * Turning one imported file into one entity per node.
 *
 * The half of `unpackModel` that has no three.js in it, and the half worth
 * testing: `packages/core` depends on nothing, so this runs in a plain node
 * test with a description written by hand. The walk that produces that
 * description is `runtime/src/assets/modelNodes.ts`, where three lives.
 *
 * This is Unity's "Unpack Prefab" for a model, and it is one-way for the same
 * reason: the parts stop being a single object, which is the entire point. What
 * makes it cheap is that nothing new is invented — the pieces are ordinary
 * entities carrying ordinary `model` components, so the gizmo, the hierarchy,
 * the inspector, undo, prefabs and the web export all work on them already.
 */

/**
 * One node of a loaded model, as `unpackModel` needs to see it.
 *
 * Structurally the `ModelNodeDesc` the runtime produces. Restated here rather
 * than imported, because `packages/core` may not depend on `packages/runtime`
 * — the arrow points the other way, and this file is the reason the description
 * is plain data in the first place.
 */
export interface ModelNode {
  /** `'0'` for the root, `'0.2.1'` for its third child's second. */
  path: string;
  parentPath: string | null;
  name: string;
  transform: Transform;
  /** Whether this node draws something itself, rather than merely holding nodes. */
  draws: boolean;
}

/**
 * One entity to be inserted, and what to insert it under.
 *
 * The parent travels beside the template rather than inside it because that is
 * what `insertEntity` takes: it writes the edge itself, through `linkEntity`, so
 * a template arriving with `parent` and `children` already filled in would have
 * every edge recorded twice.
 */
export interface UnpackedEntity {
  template: EntityTemplate;
  /** The entity id of the template above; `null` on the root alone. */
  parentId: string | null;
}

/** What a node with no name of its own is called in the hierarchy. */
const UNNAMED = 'Part';

/**
 * Whether a node can be left out without moving anything.
 *
 * An exporter's tree is full of pass-throughs — glTF's own scene node, an
 * FBX pivot — that draw nothing, hold one child and sit at the origin. Each one
 * would become an entity that exists only to have a single child, doubling the
 * count of a scene for nothing.
 *
 * One child, not any number. Folding a node that holds several is just as exact
 * — it is at the origin — but a group of several is a structure the author put
 * there and recognises: an FBX "Wheels" holding four wheels is worth keeping,
 * where a chain of one is worth nothing to anybody.
 *
 * Only at identity, and that is what makes this exact rather than a heuristic:
 * folding a node that *does* transform would mean composing its matrix into its
 * child's, and this package has no maths in it — deliberately, see `graph.ts`.
 * A node that moves its child therefore stays, whatever else it does.
 */
function isPassThrough(node: ModelNode, childCount: number): boolean {
  if (node.draws || childCount !== 1) return false;
  const { position, rotation, scale } = node.transform;
  return (
    position.every((value) => value === 0) &&
    rotation.every((value) => value === 0) &&
    scale.every((value) => value === 1)
  );
}

/**
 * Entities for a model's nodes, parents before children.
 *
 * That order is the contract, not an accident: it is what lets the caller
 * `insertEntity` them in one pass, each one's parent already in the document.
 *
 * The root is included and is the one the caller parents under the host: it
 * carries the scale and the up-axis turn the import settings put on the wrapper,
 * so leaving it out would drop them and stand a centimetre-scale FBX up at a
 * hundred times its size.
 *
 * @param assetId The model the nodes were read from; every drawing entity names
 *   it, together with its own path.
 * @param rootName What to call the root when the file gave it no name — the
 *   host entity's name, so an unpacked "Chair" is still called "Chair".
 */
export function entitiesFromNodes(
  nodes: readonly ModelNode[],
  assetId: string,
  rootName: string,
): readonly UnpackedEntity[] {
  const childCount = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentPath === null) continue;
    childCount.set(node.parentPath, (childCount.get(node.parentPath) ?? 0) + 1);
  }

  const unpacked: UnpackedEntity[] = [];
  /**
   * Which entity a node's children hang from.
   *
   * A folded pass-through maps to *its own* parent's entity rather than to one
   * of its own, which is how its child lands where it did without anyone
   * composing a matrix.
   */
  const entityOf = new Map<string, string | null>();

  for (const node of nodes) {
    const parentId = node.parentPath === null ? null : entityOf.get(node.parentPath) ?? null;

    // The root is never folded: it is the entity the caller parents under the
    // host, and something has to carry the import scale.
    if (node.parentPath !== null && isPassThrough(node, childCount.get(node.path) ?? 0)) {
      entityOf.set(node.path, parentId);
      continue;
    }

    const name = node.name !== '' ? node.name : node.parentPath === null ? rootName : UNNAMED;
    const template = createEntity(
      name,
      // A node that only holds other nodes gets no component at all. It is a
      // group, and a `model` naming a path that draws nothing would load the
      // file to produce an empty object.
      node.draws
        ? [{ ...blankComponent('model'), assetId, nodePath: node.path, nodeName: node.name }]
        : [],
    );
    template.entity.transform = structuredClone(node.transform);

    unpacked.push({ template, parentId });
    entityOf.set(node.path, template.entity.id);
  }

  return unpacked;
}
