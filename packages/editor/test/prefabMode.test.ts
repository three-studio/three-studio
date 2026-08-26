import { createEmptyScene, createMeshEntity } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { addEntity, renameEntity } from '../src/commands/sceneCommands';
import { useAssetStore } from '../src/state/assetStore';
import { selectDirty, useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';

/*
 * Opening a prefab sets the scene aside; leaving it must give back everything
 * that was set aside — the document, the selection, the undo stack, and whether
 * the work was saved.
 *
 * B4 was the third of those: `open` cleared history rather than stashing it, so
 * an unlucky double-click on a prefab erased an hour of scene undos with nothing
 * to restore from. B3 was the fourth: coming back forced the document clean.
 *
 * The prefab is put straight into the asset store and left out of the manifest,
 * so `savePrefab` returns before it reaches `window.studio` — there is no bridge
 * under vitest, and stubbing one would test the stub.
 */

const doc = () => useDocumentStore.getState();
const dirty = () => selectDirty(useDocumentStore.getState());

const ASSET_ID = 'prefab-under-test';

function givenAPrefab(): void {
  const root = createMeshEntity('box');
  root.entity.name = 'Crate';
  useAssetStore.setState({ prefabs: { [ASSET_ID]: prefabWith('Crate', [root], root.entity.id) } });
}

beforeEach(async () => {
  await usePrefabModeStore.getState().exit();
  usePrefabModeStore.setState({ stack: [] });
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
  givenAPrefab();
});

describe('a round trip through Prefab Mode', () => {
  it('gives the scene its undo stack back', async () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    renameEntity(cube.entity.id, 'Renamed');
    const depth = doc().past.length;
    expect(depth).toBe(2);

    await usePrefabModeStore.getState().open(ASSET_ID);
    // The prefab starts with a clean stack of its own: an undo in Prefab Mode
    // taking back a scene edit made ten minutes ago is the surprise this avoids.
    expect(doc().canUndo()).toBe(false);

    await usePrefabModeStore.getState().exit();

    expect(doc().past).toHaveLength(depth);
    expect(doc().undoLabel()).toBe('Rename entity');

    // And it still works, rather than merely being the right length.
    doc().undo();
    expect(doc().scene.entities[cube.entity.id]?.name).toBe('Cube');
  });

  it('keeps unsaved work marked as unsaved', async () => {
    addEntity(createMeshEntity('box'));
    expect(dirty()).toBe(true);

    await usePrefabModeStore.getState().open(ASSET_ID);
    await usePrefabModeStore.getState().exit();

    // B3 through the other door: leaving Prefab Mode restores a document, and a
    // restore has no business declaring it saved.
    expect(dirty()).toBe(true);
  });

  it('leaves a saved scene saved', async () => {
    addEntity(createMeshEntity('box'));
    doc().markClean();

    await usePrefabModeStore.getState().open(ASSET_ID);
    await usePrefabModeStore.getState().exit();

    expect(dirty()).toBe(false);
  });

  it('puts the selection back where it was', async () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    expect(useEditorStore.getState().selection).toEqual([cube.entity.id]);

    await usePrefabModeStore.getState().open(ASSET_ID);
    await usePrefabModeStore.getState().exit();

    expect(useEditorStore.getState().selection).toEqual([cube.entity.id]);
  });

  it('restores the scene document itself', async () => {
    const cube = createMeshEntity('box');
    addEntity(cube);

    await usePrefabModeStore.getState().open(ASSET_ID);
    expect(doc().scene.entities[cube.entity.id]).toBeUndefined();

    await usePrefabModeStore.getState().exit();
    expect(doc().scene.entities[cube.entity.id]).toBeDefined();
  });
});
