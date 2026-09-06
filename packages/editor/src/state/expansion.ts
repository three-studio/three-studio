import { expandPrefabs, type ExpandedScene, type PrefabDoc, type SceneDoc } from '@three-studio/core';
import { useAssetStore } from './assetStore';
import { useDocumentStore } from './documentStore';

/*
 * The scene with every prefab instance replaced by its contents, shared by
 * everyone who needs to see inside an instance.
 *
 * One expansion, not one per consumer. The viewport used to keep its own, and
 * the moment the hierarchy needed the same view the two would have drifted —
 * worse, the binder decides what to rebuild by comparing object identity, so a
 * second expansion handing back fresh copies would have thrown away every
 * geometry in the scene on each keystroke.
 *
 * Memoised on its two inputs, below, and the comparison is written out there
 * rather than handed to a `derived()` primitive. That primitive had exactly one
 * caller — this one — and its whole argument was that memoisation by hand
 * cannot say *what it is memoised on*. Two named identity checks say it better
 * than a pair of callbacks does.
 */
let expanded: ExpandedScene | undefined;
let from: { scene: SceneDoc; prefabs: Record<string, PrefabDoc> } | null = null;

/**
 * The expansion, recomputed only when one of its two inputs moved.
 *
 * **Identity is the signal**, and immer is what makes it exact: anything a
 * mutation did not touch keeps its reference, so `scene === from.scene` is a
 * true "the document did not change" rather than a guess. Ten lines of
 * comparison rather than a signals library, which is the "more patterns" ADR-8
 * refuses.
 *
 * The previous result is handed back to `expandPrefabs` so an instance nothing
 * touched gives back the entities and components it produced last time. That is
 * not an optimisation of this function: the binder decides what to rebuild by
 * comparing identity, so without it every geometry in the scene is thrown away
 * on each keystroke.
 *
 * **This does not replace the dependency arrays of its consumers, and it must
 * not.** `HierarchyPanel` memoises its rows on `structureRevision`, which is
 * deliberately *narrower* than these two inputs: the scene changes on every
 * frame of a gizmo drag, and the whole point of the row extraction was that the
 * hierarchy does not rebuild four thousand rows when only a transform moved —
 * 422 ms per nudge, of which 404 ms was that walk. A component subscribing to
 * "the expansion changed" would put every one of those milliseconds back, and
 * the Inspector's are measured too: it watches the selected entity rather than
 * the scene because subscribing to the scene refreshed every Tweakpane binding
 * on every mutation. Narrower is not a mirror gone wrong; it is a filter this
 * cannot express.
 */
export function expandedScene(): ExpandedScene {
  const scene = useDocumentStore.getState().scene;
  const prefabs = useAssetStore.getState().prefabs;

  if (from !== null && from.scene === scene && from.prefabs === prefabs) {
    return expanded as ExpandedScene;
  }
  from = { scene, prefabs };
  expanded = expandPrefabs(scene, { get: (id) => prefabs[id] }, expanded);
  return expanded;
}

/** The entity as it is drawn — an instance's contents included. */
export function expandedEntity(id: string) {
  return expandedScene().scene.entities[id];
}

/**
 * Children as the hierarchy should show them.
 *
 * A produced entity knows its parent, but the parent's `children` list is the
 * document's and cannot name something the document has never heard of. Built
 * once per expansion rather than searched per row, which is the difference
 * between O(n) and O(n²) on a scene full of instances.
 */
export function expandedChildren(expanded: ExpandedScene): Map<string, string[]> {
  const extra = new Map<string, string[]>();

  for (const entity of Object.values(expanded.scene.entities)) {
    if (entity.parent === null) continue;
    const parent = expanded.scene.entities[entity.parent];
    if (!parent || parent.children.includes(entity.id)) continue;

    const siblings = extra.get(entity.parent);
    if (siblings) siblings.push(entity.id);
    else extra.set(entity.parent, [entity.id]);
  }

  return extra;
}
