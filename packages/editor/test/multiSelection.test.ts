import {
  createEmptyScene,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  createTransform,
  instancedId,
} from '@three-studio/core';
import { Matrix4 } from 'three/webgpu';
import { beforeEach, describe, expect, it } from 'vitest';
import { close, prefabWith } from '../../core/test/fixtures';
import {
  addEntity,
  reparentSelection,
  setTransform,
  transformSelection,
} from '../src/commands/sceneCommands';
import { worldPosition } from '../src/commands/transformSpace';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { expandedScene } from '../src/state/expansion';
import { Selection } from '../src/state/selection';

/*
 * The gestures, now that phase 4 has handed over `Selection` and its filters.
 * What is tested here is the part that is easy to get wrong: one undo step per
 * gesture, and the filters that stop an entity being moved twice.
 */

const doc = () => useDocumentStore.getState();
const sel = (ids: readonly string[]) => Selection.of(ids, expandedScene().scene);
const at = (id: string) => doc().scene.entities[id]?.transform.position ?? [];

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
  // The expansion is memoised on the prefab table as well as the scene, so a
  // file that leaves one behind hands it to the next test.
  useAssetStore.setState({ prefabs: {} });
});

function three() {
  return [0, 1, 2].map((i) => {
    const cube = createMeshEntity('box');
    cube.entity.transform = { ...createTransform(), position: [i * 2, 1, 0] };
    addEntity(cube);
    return cube;
  });
}

describe('moving several objects at once', () => {
  it('gives the same result as the equivalent single moves', () => {
    const cubes = three();
    const before = cubes.map((cube) => [...at(cube.entity.id)]);

    transformSelection(sel(cubes.map((c) => c.entity.id)), new Matrix4().makeTranslation(0, 3, -1));

    cubes.forEach((cube, i) => {
      close(at(cube.entity.id), [before[i]![0]!, before[i]![1]! + 3, before[i]![2]! - 1]);
    });
  });

  it('is one undo step for the whole gesture', () => {
    const cubes = three();
    const base = doc().past.length;
    const selection = sel(cubes.map((c) => c.entity.id));

    // Sixty frames of a drag, as the gizmo produces them.
    for (let frame = 1; frame <= 60; frame++) {
      transformSelection(selection, new Matrix4().makeTranslation(0.1, 0, 0), {
        coalesceKey: 'gizmo:1',
      });
    }

    expect(doc().past.length).toBe(base + 1);
    close(at(cubes[0]!.entity.id), [6, 1, 0]);

    // And one undo puts all three back where the gesture started.
    doc().undo();
    close(at(cubes[0]!.entity.id), [0, 1, 0]);
    close(at(cubes[2]!.entity.id), [4, 1, 0]);
  });

  it('does not move a child twice when its parent is selected too', () => {
    const parent = createEntity('Parent');
    addEntity(parent);
    const child = createEntity('Child');
    addEntity(child, parent.entity.id);

    transformSelection(sel([parent.entity.id, child.entity.id]), new Matrix4().makeTranslation(5, 0, 0));

    // The child rides along under its parent.entity. Moving it on its own account as
    // well would put it at ten.
    close(at(parent.entity.id), [5, 0, 0]);
    close(at(child.entity.id), [0, 0, 0]);
  });

  it('refuses the whole gesture when one member is locked', () => {
    const cubes = three();
    doc().mutate('Lock', (draft) => {
      draft.entities[cubes[1]!.entity.id]!.locked = true;
    });
    const base = doc().past.length;

    transformSelection(sel(cubes.map((c) => c.entity.id)), new Matrix4().makeTranslation(9, 0, 0));

    // `transformable()` drops the locked one; the others still move, which is
    // what Unity does. What must not happen is a silent partial move recorded as
    // if everything had gone.
    close(at(cubes[1]!.entity.id), [2, 1, 0]);
    expect(doc().past.length).toBe(base + 1);
  });
});

describe('reparenting several objects at once', () => {
  it('is one undo step, and keeps every world placement', () => {
    const cubes = three();
    const parent = createEntity('Parent');
    parent.entity.transform = { ...createTransform(), position: [10, 0, 0] };
    addEntity(parent);
    const worldBefore = cubes.map((cube) => [...at(cube.entity.id)]);
    const base = doc().past.length;

    reparentSelection(sel(cubes.map((c) => c.entity.id)), parent.entity.id);

    expect(doc().past.length).toBe(base + 1);
    expect(doc().scene.entities[parent.entity.id]?.children).toHaveLength(3);
    // Ten units to the left in local terms, so each stays exactly where it was.
    cubes.forEach((cube, i) => {
      close(at(cube.entity.id), [worldBefore[i]![0]! - 10, worldBefore[i]![1]!, worldBefore[i]![2]!]);
    });

    doc().undo();
    expect(doc().scene.entities[parent.entity.id]?.children).toEqual([]);
    cubes.forEach((cube, i) => close(at(cube.entity.id), worldBefore[i]!));
  });

  it('inserts at an index in the order they were picked', () => {
    const [a, b, c] = three();
    // Reordering siblings was impossible before: `reparentEntity` has always
    // taken an index, and the panel never passed one.
    reparentSelection(sel([b!.entity.id, c!.entity.id]), null, 0);

    expect(doc().scene.rootOrder).toEqual([b!.entity.id, c!.entity.id, a!.entity.id]);
  });

  it('leaves a locked entity where it is', () => {
    const [a, b] = three();
    doc().mutate('Lock', (draft) => {
      draft.entities[b!.entity.id]!.locked = true;
    });
    const parent = createEntity('Parent');
    addEntity(parent);

    reparentSelection(sel([a!.entity.id, b!.entity.id]), parent.entity.id);

    // `roots()` keeps it, but `reparentEntity` refuses it — the capability is
    // checked where the edit happens, not only where the menu is greyed.
    expect(doc().scene.entities[b!.entity.id]?.parent).toBeNull();
  });
});

describe("a selection mixing the document and a prefab's contents", () => {
  it('moves the document entity and records an override for the other', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);

    // An id the document does not hold: `transformSelection` has to send it down
    // the override path, as a single transform already does.
    const produced = `${cube.entity.id}/inner`;
    expect(() =>
      transformSelection(sel([cube.entity.id, produced]), new Matrix4().makeTranslation(1, 0, 0)),
    ).not.toThrow();
    close(at(cube.entity.id), [1, 0.5, 0]);
  });

  it('does not reparent what a prefab produced', () => {
    const host = createEntity('Host');
    addEntity(host);
    const target = createEntity('Target');
    addEntity(target);

    reparentSelection(sel([`${host.entity.id}/inner`]), target.entity.id);
    // Nothing to do, and nothing thrown: the next expansion would undo it anyway.
    expect(doc().scene.entities[target.entity.id]?.children).toEqual([]);
  });
});

describe("moving an entity a prefab produced", () => {
  /*
   * The gizmo may drive an id the document has never heard of — `transformable()`
   * keeps what a prefab produced on purpose, because writing an override is
   * exactly what an instance is for.
   *
   * What it cost when the pose was computed against the raw document:
   * `worldMatrix` answers the identity for an id it cannot find, so `delta ×
   * world` collapsed to the delta itself, and the delta went into the override
   * as if it were a local transform. The child did not move by the gesture, it
   * jumped to it — on the first frame of the first drag.
   */
  function tree() {
    const branch = createMeshEntity('box');
    branch.entity.name = 'Branch';
    branch.entity.transform = { ...createTransform(), position: [0, 2, 0] };

    const trunk = createMeshEntity('cylinder');
    trunk.entity.name = 'Trunk';
    trunk.entity.transform = { ...createTransform(), position: [0, 1, 0] };
    trunk.entity.children = [branch.entity.id];
    branch.entity.parent = trunk.entity.id;

    return { branch, prefab: prefabWith('Tree', [trunk, branch], trunk.entity.id) };
  }

  it('moves it by the delta rather than to it', () => {
    const { branch, prefab } = tree();
    useAssetStore.setState({ prefabs: { tree: prefab } });

    const host = createEntity('Tree', [createPrefabInstance('tree')]);
    host.entity.transform = { ...createTransform(), position: [10, 0, 0] };
    addEntity(host);

    const produced = instancedId(host.entity.id, branch.entity.id);
    // Where the branch stands before anything is dragged: the instance at x=10,
    // the trunk a metre up, the branch two above that.
    close(worldPosition(expandedScene().scene, produced), [10, 3, 0]);

    transformSelection(sel([produced]), new Matrix4().makeTranslation(0, 0, 5));

    close(worldPosition(expandedScene().scene, produced), [10, 3, 5]);
  });

  it('records the move as an override on the instance, not on the asset', () => {
    const { branch, prefab } = tree();
    useAssetStore.setState({ prefabs: { tree: prefab } });

    const host = createEntity('Tree', [createPrefabInstance('tree')]);
    addEntity(host);

    transformSelection(
      sel([instancedId(host.entity.id, branch.entity.id)]),
      new Matrix4().makeTranslation(0, 0, 5),
    );

    // An override that reached back into the asset would move every other
    // placement of the same prefab.
    close(prefab.entities[branch.entity.id]!.transform.position, [0, 2, 0]);
  });
});

describe('a single object still goes through the same path', () => {
  it('matches what setTransform gives', () => {
    const [a] = three();
    transformSelection(sel([a!.entity.id]), new Matrix4().makeTranslation(0, 2, 0));
    const viaDelta = [...at(a!.entity.id)];

    doc().undo();
    setTransform(a!.entity.id, { position: [0, 3, 0] });

    // One code path that handles one object is worth more than two that disagree
    // at the edges.
    close(viaDelta, at(a!.entity.id));
  });
});
