import { expandPrefabs, type ExpandedScene } from '@three-studio/core';
import { useAssetStore } from './assetStore';
import { derived } from './derived';
import { useDocumentStore } from './documentStore';

/**
 * The scene with every prefab instance replaced by its contents, shared by
 * everyone who needs to see inside an instance.
 *
 * One expansion, not one per consumer. The viewport used to keep its own, and
 * the moment the hierarchy needed the same view the two would have drifted —
 * worse, the binder decides what to rebuild by comparing object identity, so a
 * second expansion handing back fresh copies would have thrown away every
 * geometry in the scene on each keystroke.
 *
 * A declared derivation since phase 12. It was a module-level `let` read during
 * React render, which meant every consumer restated these two inputs in its own
 * `useMemo` array — a global React cannot see, mirrored by hand. Now the inputs
 * are written once, beside what reads them, and a component subscribes rather
 * than guesses.
 *
 * The previous result is handed to `expandPrefabs` so an instance nothing
 * touched gives back the entities and components it produced last time. That is
 * what stops the binder rebuilding every geometry in the scene per keystroke.
 */
export const expansion = derived<ExpandedScene>(
  (previous) => {
    const scene = useDocumentStore.getState().scene;
    const prefabs = useAssetStore.getState().prefabs;
    return expandPrefabs(scene, { get: (id) => prefabs[id] }, previous);
  },
  // Identity is the signal: immer preserves it for anything untouched, so this
  // is an exact "neither the document nor the prefab library changed".
  () => [useDocumentStore.getState().scene, useAssetStore.getState().prefabs],
);

export function expandedScene(): ExpandedScene {
  return expansion.get();
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
