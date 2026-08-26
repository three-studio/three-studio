import {
  componentsOf,
  createAudioSourceEntity,
  createEmptyScene,
  createEntity,
  createMeshEntity,
  createModelEntity,
  type AudioSourceComponent,
} from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addComponentWithDependencies,
  addEntity,
  duplicateSelection,
  deleteSelection,
  removeComponent,
  renameEntity,
  reparentEntity,
  setComponentNestedField,
  setTransform,
} from '../src/commands/sceneCommands';
import { selectDirty, useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { Selection } from '../src/state/selection';
import { expandedScene } from '../src/state/expansion';

/** A selection over the scene as it is drawn, for commands that take one. */
const sel = (ids: readonly string[]) => Selection.of(ids, expandedScene().scene);

const doc = () => useDocumentStore.getState();
const scene = () => useDocumentStore.getState().scene;
const dirty = () => selectDirty(useDocumentStore.getState());
const selection = () => useEditorStore.getState().selection;

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

/*
 * The document store is the piece everything else is derived from: undo, save,
 * the play-mode snapshot and the web export all assume the scene is a plain
 * value edited through patches. These tests pin that contract down.
 */
describe('what the document refuses to take', () => {
  it('drops a number that is not one, rather than storing it', () => {
    // `NaN` costs nothing to write and everything to find. It survives into the
    // saved file as `null` — that is what `JSON.stringify` does with it — and
    // until then every comparison against it answers `false`, so a source with
    // `spatialBlend: NaN` is neither 2D nor 3D and nothing anywhere reports a
    // fault.
    //
    // It arrived through a live control. Dragging 2D ↔ 3D to zero changes
    // `inspectorSignature`, which rebuilds the pane *mid-drag*; Tweakpane keeps
    // its `mousemove` and `mouseup` on the document until the button comes up,
    // so the disposed slider took one more reading from an element no longer in
    // the layout — width zero — and mapped the pointer with a division of zero
    // by zero.
    const template = createAudioSourceEntity('clip');
    const component = template.components[0] as AudioSourceComponent;
    const entityId = addEntity(template);

    setComponentNestedField(entityId, component.id, ['spatialBlend'], 0);
    expect(read(entityId, component.id).spatialBlend).toBe(0);

    setComponentNestedField(entityId, component.id, ['spatialBlend'], Number.NaN);
    setComponentNestedField(entityId, component.id, ['spatialBlend'], Number.POSITIVE_INFINITY);

    expect(read(entityId, component.id).spatialBlend).toBe(0);
  });

  it('leaves every ordinary number alone, including zero and the negatives', () => {
    // The guard must be about *finiteness* and nothing else. A refusal that also
    // caught 0 would make half the fields in the inspector unusable.
    const template = createAudioSourceEntity('clip');
    const component = template.components[0] as AudioSourceComponent;
    const entityId = addEntity(template);

    for (const value of [0, -1200, 0.001, 1]) {
      setComponentNestedField(entityId, component.id, ['detune'], value);
      expect(read(entityId, component.id).detune).toBe(value);
    }
  });
});

function read(entityId: string, componentId: string): AudioSourceComponent {
  const found = componentsOf(scene(), entityId).find((c) => c.id === componentId);
  if (found?.type !== 'audioSource') throw new Error('no audio source');
  return found;
}

describe('document store', () => {
  it('adds an entity and undoes it', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    expect(scene().entities[cube.entity.id]?.name).toBe('Cube');
    expect(scene().rootOrder).toContain(cube.entity.id);

    doc().undo();
    expect(scene().entities[cube.entity.id]).toBeUndefined();
    expect(scene().rootOrder).not.toContain(cube.entity.id);

    doc().redo();
    expect(scene().entities[cube.entity.id]?.name).toBe('Cube');
  });

  it('records a label per history entry', () => {
    addEntity(createMeshEntity('sphere'));
    expect(doc().undoLabel()).toBe('Add Sphere');
    doc().undo();
    expect(doc().redoLabel()).toBe('Add Sphere');
  });

  it('deletes a subtree and restores it whole', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    addEntity(parent);
    addEntity(child, parent.entity.id);

    expect(scene().entities[parent.entity.id]?.children).toEqual([child.entity.id]);

    deleteSelection(sel([parent.entity.id]));
    expect(scene().entities[parent.entity.id]).toBeUndefined();
    // A deleted parent must take its descendants with it, not orphan them.
    expect(scene().entities[child.entity.id]).toBeUndefined();

    doc().undo();
    expect(scene().entities[child.entity.id]?.parent).toBe(parent.entity.id);
    expect(scene().entities[parent.entity.id]?.children).toEqual([child.entity.id]);
  });

  it('reparents and unparents', () => {
    const a = createEntity('A');
    const b = createEntity('B');
    addEntity(a);
    addEntity(b);

    reparentEntity(b.entity.id, a.entity.id);
    expect(scene().entities[b.entity.id]?.parent).toBe(a.entity.id);
    expect(scene().rootOrder).toEqual([a.entity.id]);

    reparentEntity(b.entity.id, null);
    expect(scene().entities[b.entity.id]?.parent).toBeNull();
    expect(scene().rootOrder).toEqual([a.entity.id, b.entity.id]);
  });

  it('refuses to reparent an entity under its own descendant', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    addEntity(parent);
    addEntity(child, parent.entity.id);

    reparentEntity(parent.entity.id, child.entity.id);

    // The move is rejected outright: allowing it would detach the subtree from
    // the scene with no way to reach it again.
    expect(scene().entities[parent.entity.id]?.parent).toBeNull();
    expect(scene().entities[child.entity.id]?.parent).toBe(parent.entity.id);
  });

  it('collapses a coalesced drag into one undo step', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const historyAfterAdd = doc().past.length;

    for (let step = 1; step <= 20; step++) {
      setTransform(cube.entity.id, { position: [step, 0, 0] }, { coalesceKey: `drag:${cube.entity.id}` });
    }

    expect(doc().past.length).toBe(historyAfterAdd + 1);
    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([20, 0, 0]);

    // One undo must return to where the gesture started, not to step 19.
    doc().undo();
    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([0, 0.5, 0]);
  });

  it('starts a new history entry when the coalesce key changes', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const base = doc().past.length;

    setTransform(cube.entity.id, { position: [1, 0, 0] }, { coalesceKey: 'drag:a' });
    setTransform(cube.entity.id, { position: [2, 0, 0] }, { coalesceKey: 'drag:b' });

    expect(doc().past.length).toBe(base + 2);
  });

  it('tracks which entities the binder must re-read', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const seen = doc().changesSince(0).revision;

    renameEntity(cube.entity.id, 'Renamed');
    expect([...(doc().changesSince(seen).entities as ReadonlySet<string>)]).toEqual([cube.entity.id]);
  });

  it('duplicates a subtree under a fresh set of ids', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    addEntity(parent);
    addEntity(child, parent.entity.id);

    duplicateSelection(sel([parent.entity.id]));

    const roots = scene().rootOrder;
    expect(roots).toHaveLength(2);
    const copyId = roots.find((id) => id !== parent.entity.id);
    const copy = copyId === undefined ? undefined : scene().entities[copyId];

    expect(copy?.name).toBe('Parent (1)');
    expect(copy?.children).toHaveLength(1);
    expect(copy?.children[0]).not.toBe(child.entity.id);
  });

  it('clears history when a new document replaces the current one', () => {
    addEntity(createMeshEntity('box'));
    expect(doc().canUndo()).toBe(true);

    doc().replaceScene(createEmptyScene());
    expect(doc().canUndo()).toBe(false);
    expect(dirty()).toBe(false);
  });
});

/*
 * What one user action has to carry: the document change, the selection that
 * goes with it, and what it means for the file on disk. Three independent
 * writes across two stores before phase 2, of which undo took back one.
 */
describe('what a transaction carries', () => {
  it('leaves no selection pointing at an entity undo has removed', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    expect(selection()).toEqual([cube.entity.id]);

    doc().undo();

    // B2. The selection used to be set after `mutate`, so no entry described it
    // and undo could not take it back — the gizmo then asked the binder for an
    // object that no longer existed.
    expect(selection()).toEqual([]);

    doc().redo();
    expect(selection()).toEqual([cube.entity.id]);
  });

  it('puts back what was selected before a delete', () => {
    const keep = createMeshEntity('box');
    const gone = createMeshEntity('sphere');
    addEntity(keep);
    addEntity(gone);
    useEditorStore.getState().setSelection([keep.entity.id, gone.entity.id]);

    deleteSelection(sel([gone.entity.id]));
    expect(selection()).toEqual([keep.entity.id]);

    doc().undo();
    expect(selection()).toEqual([keep.entity.id, gone.entity.id]);
  });

  it('selects the copies a duplicate produced, and only inside its own entry', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);

    duplicateSelection(sel([cube.entity.id]));
    const copies = selection();
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe(cube.entity.id);

    // The ids only exist once the recipe has run, which is what the function
    // form of `select` is for.
    doc().undo();
    expect(selection()).toEqual([cube.entity.id]);
  });

  it('drops a selected id the scene no longer holds', () => {
    const parent = createEntity('Parent');
    const child = createEntity('Child');
    addEntity(parent);
    addEntity(child, parent.entity.id);
    useEditorStore.getState().setSelection([child.entity.id]);

    // The child goes with its parent, and nothing named it in the command.
    deleteSelection(sel([parent.entity.id]));
    expect(selection()).toEqual([]);
  });

  it('keeps a selection made inside a prefab instance', () => {
    const host = createEntity('Host');
    addEntity(host);
    const produced = `${host.entity.id}/root`;
    useEditorStore.getState().setSelection([produced]);

    renameEntity(host.entity.id, 'Renamed');

    // An expanded id is not in `scene.entities` and pruning against the document
    // alone would clear every selection made inside a prefab.
    expect(selection()).toEqual([produced]);
  });

  it('reaches the start of a gesture in one undo, selection included', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    useEditorStore.getState().setSelection([cube.entity.id]);

    for (let step = 1; step <= 5; step++) {
      setTransform(cube.entity.id, { position: [step, 0, 0] }, { coalesceKey: `drag:${cube.entity.id}` });
    }

    doc().undo();
    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([0, 0.5, 0]);
    expect(selection()).toEqual([cube.entity.id]);
  });
});

describe('knowing whether the work is saved', () => {
  it('keeps the unsaved marker when a restore puts the same document back', () => {
    addEntity(createMeshEntity('box'));
    expect(dirty()).toBe(true);
    const snapshot = scene();

    // B3. What Play/Stop and leaving Prefab Mode do: hand back a document that
    // was set aside. `keepHistory` is what tells a restore from a load — a load
    // legitimately starts clean, a restore must not lie about unsaved work,
    // which is how it got lost with no warning on close.
    doc().replaceScene(snapshot, { keepHistory: true });

    expect(dirty()).toBe(true);
  });

  it('comes back clean when undo reaches the last save', () => {
    addEntity(createMeshEntity('box'));
    doc().markClean();
    expect(dirty()).toBe(false);

    addEntity(createMeshEntity('sphere'));
    expect(dirty()).toBe(true);

    // A boolean could not do this: it had no way back down, so undoing to the
    // save point left the document marked modified for ever.
    doc().undo();
    expect(dirty()).toBe(false);

    doc().redo();
    expect(dirty()).toBe(true);
  });

  it('is clean after loading a document, whatever came before', () => {
    addEntity(createMeshEntity('box'));
    doc().replaceScene(createEmptyScene());
    expect(dirty()).toBe(false);
  });
});

/*
 * The compaction that keeps a long drag from carrying six hundred patch pairs.
 * ADR-4 calls this the part where a mistake breaks undo subtly, so the property
 * test below is the real check and these pin the shape.
 */
describe('bounding a coalesced entry', () => {
  it('collapses repeated writes to one path', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);

    for (let step = 1; step <= 100; step++) {
      setTransform(cube.entity.id, { position: [step, 0, 0] }, { coalesceKey: 'drag' });
    }

    const entry = doc().past.at(-1);
    // One write per axis of `position`, not one per frame.
    expect(entry?.patches.length).toBeLessThanOrEqual(4);
    expect(entry?.inverse.length).toBeLessThanOrEqual(4);

    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([100, 0, 0]);
    doc().undo();
    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([0, 0.5, 0]);
    doc().redo();
    expect(scene().entities[cube.entity.id]?.transform.position).toEqual([100, 0, 0]);
  });

  it('leaves a patch set that is not all replaces alone', () => {
    addEntity(createEntity('A'));

    // Two inserts at the same index, coalesced. Both patches are `add` on
    // `rootOrder/0` — the same path — and merging by path would keep one and
    // lose an entity. An `add` or `remove` on an array moves the indices around
    // it, so it does not merge the way a `replace` does.
    for (let step = 0; step < 2; step++) {
      const extra = createEntity(`Extra ${step}`);
      doc().mutate(
        'Insert',
        (draft) => {
          draft.entities[extra.entity.id] = extra.entity;
          draft.rootOrder.splice(0, 0, extra.entity.id);
        },
        { coalesceKey: 'insert' },
      );
    }

    expect(scene().rootOrder).toHaveLength(3);
    const entry = doc().past.at(-1);
    expect(entry?.patches.filter((patch) => patch.op !== 'replace').length).toBeGreaterThan(0);

    doc().undo();
    expect(scene().rootOrder).toHaveLength(1);
    doc().redo();
    expect(scene().rootOrder).toHaveLength(3);
  });
});

/*
 * The synchronisation channel.
 *
 * It replaced a drained buffer: `clearDirtyEntities()` was a global `set()`, so
 * the first consumer to run emptied the information for every other one. With a
 * single viewport nothing broke — and a second one, or a panel dockview
 * remounts, was impossible by construction.
 */
describe('asking what changed since', () => {
  it('gives two consumers their own delta, independently', () => {
    const a = createMeshEntity('box');
    const b = createMeshEntity('sphere');
    addEntity(a);
    addEntity(b);

    // Two consumers at the same point. Renames rather than adds, because an add
    // writes `rootOrder` and that is still a `'*'` — see the note below.
    const first = doc().changesSince(0).revision;
    const second = first;

    renameEntity(b.entity.id, 'First change');
    const forFirst = doc().changesSince(first);
    expect([...(forFirst.entities as ReadonlySet<string>)]).toEqual([b.entity.id]);

    renameEntity(a.entity.id, 'Second change');

    // The consumer that never read is still owed both, and the other one's read
    // took nothing away from it. Under the old drained buffer it would have been
    // owed nothing at all.
    const ids = doc().changesSince(second).entities as ReadonlySet<string>;
    expect([...ids].sort()).toEqual([a.entity.id, b.entity.id].sort());
  });

  /*
   * Adding or removing at the root writes `rootOrder`, which used to be answered
   * with `'*'` — so the commonest gesture in the editor degenerated into a full
   * reconcile of the scene.
   */
  it('names only what was added, not the whole scene', () => {
    addEntity(createMeshEntity('box'));
    const seen = doc().changesSince(0).revision;

    const added = createMeshEntity('sphere');
    addEntity(added);
    expect([...(doc().changesSince(seen).entities as ReadonlySet<string>)]).toEqual([added.entity.id]);
  });

  it('names only what was deleted', () => {
    const keep = createMeshEntity('box');
    const gone = createMeshEntity('sphere');
    addEntity(keep);
    addEntity(gone);
    const seen = doc().changesSince(0).revision;

    deleteSelection(sel([gone.entity.id]));

    // `rootOrder` names nothing: it is an ordering, and it decides what the
    // hierarchy lists rather than what is drawn. What left is named by the
    // `entities.<id>` removal in the same mutation.
    expect([...(doc().changesSince(seen).entities as ReadonlySet<string>)]).toEqual([gone.entity.id]);
  });

  it('reports a pure reorder as structural but touching nothing', () => {
    const a = createMeshEntity('box');
    const b = createMeshEntity('sphere');
    addEntity(a);
    addEntity(b);
    const seen = doc().changesSince(0).revision;
    const structure = doc().structureRevision;

    doc().mutate('Reorder', (draft) => {
      draft.rootOrder.reverse();
    });

    // The hierarchy has to redraw its list; the binder has nothing to do, since
    // the order of `rootOrder` changes nothing about the scene graph.
    expect((doc().changesSince(seen).entities as ReadonlySet<string>).size).toBe(0);
    expect(doc().structureRevision).toBeGreaterThan(structure);
  });

  it('says nothing changed when nothing has', () => {
    addEntity(createMeshEntity('box'));
    const seen = doc().changesSince(0).revision;

    const again = doc().changesSince(seen);
    expect((again.entities as ReadonlySet<string>).size).toBe(0);
    expect(again.environment).toBe(false);
    expect(again.materials).toBe(false);
    expect(again.prefabs).toBe(false);
    expect(again.revision).toBe(seen);
  });

  it('answers a consumer that has fallen too far behind with everything', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const stale = doc().changesSince(0).revision;

    // More than the ring holds. Merging that many deltas costs more than one
    // full reconcile, so the useful answer is "re-read".
    for (let step = 0; step < 300; step++) renameEntity(cube.entity.id, `Name ${step}`);

    expect(doc().changesSince(stale).entities).toBe('*');
  });

  it('reports the environment apart from the entities', () => {
    addEntity(createMeshEntity('box'));
    const seen = doc().changesSince(0).revision;

    doc().mutate('Fog', (draft) => {
      draft.environment.fogEnabled = true;
    });

    const changes = doc().changesSince(seen);
    expect(changes.environment).toBe(true);
    expect((changes.entities as ReadonlySet<string>).size).toBe(0);
  });

  it('reports a library change without naming an entity', () => {
    addEntity(createMeshEntity('box'));
    const seen = doc().changesSince(0).revision;

    // Editing a material touches no entity and still changes what is drawn.
    doc().noteLibraryChange('materials');

    const changes = doc().changesSince(seen);
    expect(changes.materials).toBe(true);
    expect((changes.entities as ReadonlySet<string>).size).toBe(0);
  });

  it('keeps the two asset tables apart, because they need opposite answers', () => {
    const seen = doc().changesSince(0).revision;
    doc().noteLibraryChange('prefabs');

    // A material edit invalidates a knowable set of bindings and the binder
    // hands it back; a prefab edit changes what the expansion *produces*, so
    // there is nothing to name and the pass has to be full. One flag for both
    // would force the expensive answer on the common case.
    const changes = doc().changesSince(seen);
    expect(changes.prefabs).toBe(true);
    expect(changes.materials).toBe(false);
  });

  it('tells everyone to re-read when a document is loaded', () => {
    addEntity(createMeshEntity('box'));
    const seen = doc().changesSince(0).revision;

    doc().replaceScene(createEmptyScene());

    // A delta cannot express "this is a different document".
    expect(doc().changesSince(seen).entities).toBe('*');
  });

  it('carries an undo like any other change', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    renameEntity(cube.entity.id, 'Renamed');
    const seen = doc().changesSince(0).revision;
    const marker = doc().revision;

    doc().undo();

    // The log's counter climbs while the save marker goes back down: two ideas,
    // two numbers. Sharing one would make an undo look like a rewind of the log,
    // and every consumer would miss the change.
    const changes = doc().changesSince(seen);
    expect(changes.revision).toBeGreaterThan(seen);
    expect(doc().revision).toBeLessThan(marker);
    expect([...(changes.entities as ReadonlySet<string>)]).toEqual([cube.entity.id]);
  });
});

/*
 * Two counters, because the panels want opposite answers.
 *
 * A component lives in `scene.components`, not in its entity, so nothing about
 * an `EntityDoc` moves when one is added, edited or removed. The Inspector had
 * no signal at all and showed a freshly added component only once something
 * else happened to wake it; the hierarchy had one that fired far too often and
 * rebuilt a full walk of the scene on every frame of a slider drag.
 */
describe('revision counters', () => {
  const revisions = () => {
    const state = doc();
    return { structure: state.structureRevision, component: state.componentRevision };
  };

  const meshComponentId = (entityId: string) =>
    componentsOf(scene(), entityId).find((component) => component.type === 'mesh')!.id;

  it('counts a value written inside a component as a component change only', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const componentId = meshComponentId(cube.entity.id);
    const before = revisions();

    setComponentNestedField(cube.entity.id, componentId, ['material', 'roughness'], 0.3);

    // The hierarchy lists nothing that moved — a roughness is not a row, not an
    // icon and not a name.
    expect(revisions().structure).toBe(before.structure);
    expect(revisions().component).toBeGreaterThan(before.component);
  });

  it('counts adding a component as both', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const before = revisions();

    addComponentWithDependencies(cube.entity.id, 'light');

    // Both, and the hierarchy half is earned: `iconFor` picks the row's icon
    // from which components the entity carries.
    expect(revisions().structure).toBeGreaterThan(before.structure);
    expect(revisions().component).toBeGreaterThan(before.component);
  });

  it('counts removing a component as both', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const componentId = meshComponentId(cube.entity.id);
    const before = revisions();

    removeComponent(cube.entity.id, componentId);

    expect(revisions().structure).toBeGreaterThan(before.structure);
    expect(revisions().component).toBeGreaterThan(before.component);
  });

  it('counts a transform as neither', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const before = revisions();

    setTransform(cube.entity.id, { position: [1, 2, 3] });

    // The one edit that changes nothing anyone lists, which is what makes a
    // gizmo drag free for both panels.
    expect(revisions()).toEqual(before);
  });

  it('moves the component counter on undo, so a taken-back edit reaches the panel', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const componentId = meshComponentId(cube.entity.id);
    setComponentNestedField(cube.entity.id, componentId, ['material', 'roughness'], 0.3);
    const before = revisions();

    doc().undo();

    // Without this the Inspector went on showing the value that had just been
    // taken back: no dependency it watched could move on a component write.
    expect(revisions().component).toBeGreaterThan(before.component);
  });
});

describe('components that cannot sit together', () => {
  it('refuses a mesh on an entity already drawing a model', () => {
    const model = createModelEntity('asset', 'Chair');
    addEntity(model);

    addComponentWithDependencies(model.entity.id, 'mesh');

    // Both draw, both hang from the same container, and both get drawn — so
    // "Add Component ▸ Mesh" on an import used to put a grey 1×1×1 box through
    // it, which reads as the model having been duplicated.
    expect(componentsOf(scene(), model.entity.id).map((c) => c.type)).toEqual(['model']);
  });

  it('refuses a model on an entity already drawing a mesh', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);

    // The table is read both ways round, so neither order has to be written out.
    addComponentWithDependencies(cube.entity.id, 'model');

    expect(componentsOf(scene(), cube.entity.id).map((c) => c.type)).toEqual(['mesh']);
  });
});
