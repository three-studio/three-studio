import { createEntity, createMeshEntity, createPrefabInstance } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { expandedScene } from '../src/state/expansion';

/*
 * The one expansion everything reads, and what it is memoised on.
 *
 * Two properties matter and neither is "it caches". The inputs are compared by
 * **identity**, which is what makes immer's structural sharing an exact
 * "nothing changed"; and the previous result is handed to the next computation,
 * which is what lets an untouched prefab instance give back the entities it
 * produced last time. Without the second the binder throws away every geometry
 * in the scene on each keystroke — it decides what to rebuild by comparing
 * identity.
 *
 * These were tested on a `derived()` primitive that had this as its only
 * caller. They are the same two properties, asked of the thing that has them.
 */

const trunk = createMeshEntity('cylinder');
trunk.entity.name = 'Trunk';
const tree = prefabWith('Tree', [trunk], trunk.entity.id);

/** A scene holding one instance of `Tree`, plus a plain entity beside it. */
function sceneWithInstance() {
  const host = createEntity('Tree', [createPrefabInstance('tree')]);
  return sceneWith([host, createEntity('Rock')]);
}

beforeEach(() => {
  useAssetStore.setState({ prefabs: { tree } });
  useDocumentStore.setState({ scene: sceneWithInstance() });
});

describe('the expansion everything shares', () => {
  it('computes once for as many reads as you like', () => {
    // Every panel calls this during its own render, several times over. The
    // same object each time is what makes that free.
    expect(expandedScene()).toBe(expandedScene());
  });

  it('recomputes when the document moves, and not before', () => {
    const first = expandedScene();
    useDocumentStore.setState({ scene: sceneWithInstance() });
    expect(expandedScene()).not.toBe(first);
  });

  it('recomputes when the prefab library moves', () => {
    // Editing a prefab changes what a scene shows without touching a single
    // entity in it. The store replaces the table, so this sees a new identity.
    const first = expandedScene();
    useAssetStore.setState({ prefabs: { tree: prefabWith('Tree', [trunk], trunk.entity.id) } });
    expect(expandedScene()).not.toBe(first);
  });

  it('is blind to a mutation in place, which is the contract', () => {
    // It holds because the stores never mutate: immer replaces. A test that
    // reached in and changed a field would be testing something the product
    // cannot do.
    const first = expandedScene();
    const scene = useDocumentStore.getState().scene;
    scene.name = 'Renamed';
    expect(expandedScene()).toBe(first);
  });

  it('gives back the entities an untouched instance produced last time', () => {
    // The property the binder rests on. A change elsewhere in the document must
    // not hand back fresh copies of what the instance produced, or every
    // geometry under it is rebuilt.
    const before = expandedScene();
    const scene = useDocumentStore.getState().scene;
    // The one the expansion invented: the document has never heard of it.
    const produced = Object.keys(before.scene.entities).find((id) => !(id in scene.entities));
    expect(produced).toBeDefined();

    useDocumentStore.setState({ scene: { ...scene, name: 'Renamed' } });

    const after = expandedScene();
    expect(after).not.toBe(before);
    expect(after.scene.entities[produced!]).toBe(before.scene.entities[produced!]);
  });
});
