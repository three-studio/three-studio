import { createEmptyScene, createId, createMeshEntity } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addEntity, reparentEntity } from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';

const doc = () => useDocumentStore.getState();
const scene = () => useDocumentStore.getState().scene;

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

/*
 * B1 through the command rather than through the tree layer, which
 * `packages/core/test/sceneGraph.test.ts` covers on its own. What is being
 * pinned here is the gesture: the drop the hierarchy panel performs, the undo
 * step it must not cost, and the fact that the command delegates its guards
 * instead of keeping its own.
 */
describe('the reparent command', () => {
  it('refuses a parent the document does not contain', () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const history = doc().past.length;

    // What `HierarchyPanel.onDrop` passes when a row a prefab produced is the
    // drop target: an `owner/local` id that names nothing in the document.
    reparentEntity(cube.entity.id, `${createId()}/root`);

    expect(scene().entities[cube.entity.id]?.parent).toBeNull();
    expect(scene().rootOrder).toContain(cube.entity.id);
    // A refused move is not an edit, so it must not cost an undo step either —
    // and it does not, because the recipe produces no patch.
    expect(doc().past.length).toBe(history);
  });

  it('keeps the world placement when the move is allowed', () => {
    const parent = createMeshEntity('box');
    addEntity(parent);
    reparentEntity(parent.entity.id, null);

    const child = createMeshEntity('sphere');
    addEntity(child);
    const before = scene().entities[child.entity.id]?.transform.position;

    reparentEntity(child.entity.id, parent.entity.id);

    // Both sit at y=0.5 from the factory, so the local transform under a parent
    // at the same height is what puts the child back where it was.
    expect(scene().entities[child.entity.id]?.parent).toBe(parent.entity.id);
    expect(scene().entities[child.entity.id]?.transform.position[1]).toBeCloseTo(
      (before?.[1] ?? 0) - 0.5,
      5,
    );
  });
});
