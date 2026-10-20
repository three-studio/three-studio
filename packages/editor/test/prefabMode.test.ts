import { createEmptyScene, createMeshEntity, type PrefabDoc } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { addEntity, renameEntity } from '../src/commands/sceneCommands';
import { useAssetStore } from '../src/state/assetStore';
import { selectDirty, useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { composedPrefabMode, usePrefabModeStore } from '../src/state/prefabModeStore';
import { useToastStore } from '../src/state/toastStore';
import { sceneUnsaved, windowUnsaved } from '../src/state/unsaved';

/*
 * Opening a prefab sets the scene aside; leaving it must give back everything
 * that was set aside — the document, the selection, the undo stack, and whether
 * the work was saved.
 *
 * The third of those went wrong: `open` cleared history rather than stashing it, so
 * an unlucky double-click on a prefab erased an hour of scene undos with nothing
 * to restore from. The fourth went wrong too: coming back forced the document clean.
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

    // The same thing through the other door: leaving Prefab Mode restores a document, and a
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

describe('a prefab while the game runs', () => {
  /*
   * Stop puts back the scene Play started from, into whatever the document is.
   * With a prefab open that was the prefab: its edits went, its undo stack sat
   * over the scene, and leaving saved every entity of the scene into the
   * prefab's file.
   */
  const toastTitles = () => useToastStore.getState().toasts.map((toast) => toast.title);

  afterEach(() => {
    useEditorStore.getState().stop();
    useToastStore.getState().clear();
  });

  it('is refused until the game stops', async () => {
    const scene = doc().scene;
    useEditorStore.getState().play();

    await usePrefabModeStore.getState().open(ASSET_ID);

    expect(usePrefabModeStore.getState().stack).toEqual([]);
    expect(doc().scene).toBe(scene);
    expect(toastTitles()).toContain('Stop the game to open a prefab');

    // Paused is still a game Stop will end.
    useEditorStore.getState().togglePause();
    await usePrefabModeStore.getState().open(ASSET_ID);
    expect(usePrefabModeStore.getState().stack).toEqual([]);

    useEditorStore.getState().stop();
    await usePrefabModeStore.getState().open(ASSET_ID);
    expect(usePrefabModeStore.getState().stack).toHaveLength(1);
  });
});

describe('Prefab Mode composed without being left', () => {
  /*
   * A device launch from Prefab Mode runs the scene the prefab was opened from,
   * with the prefab's unsaved edits in it — and it may neither save nor leave.
   * `savePrefab` is a recorder here, so "nothing saved" is something the test
   * can see rather than something the missing bridge hides.
   */
  const OUTER_ID = 'prefab-outer';
  const saved: [string, PrefabDoc][] = [];
  const realSavePrefab = useAssetStore.getState().savePrefab;

  beforeEach(() => {
    saved.length = 0;
    useAssetStore.setState({
      savePrefab: async (assetId, prefab) => {
        saved.push([assetId, prefab]);
      },
    });
  });

  afterEach(() => {
    useAssetStore.setState({ savePrefab: realSavePrefab });
  });

  function givenAnOuterPrefab(): void {
    const root = createMeshEntity('box');
    root.entity.name = 'Room';
    useAssetStore.setState({
      prefabs: {
        ...useAssetStore.getState().prefabs,
        [OUTER_ID]: prefabWith('Room', [root], root.entity.id),
      },
    });
  }

  it('is null in a scene', () => {
    expect(composedPrefabMode()).toBeNull();
  });

  it('hands the scene set aside and the edited prefab, and stays in Prefab Mode', async () => {
    const cube = createMeshEntity('box');
    addEntity(cube);
    const scene = doc().scene;

    await usePrefabModeStore.getState().open(ASSET_ID);
    const inside = createMeshEntity('box');
    addEntity(inside);
    const document = doc().scene;

    const composed = composedPrefabMode()!;

    expect(composed.scene).toBe(scene);
    expect(composed.prefabs[ASSET_ID]!.entities[inside.entity.id]).toBeDefined();
    expect(usePrefabModeStore.getState().stack).toHaveLength(1);
    expect(doc().scene).toBe(document);
    expect(saved).toEqual([]);
  });

  it('composes nested prefabs exactly as leaving them saves them', async () => {
    givenAnOuterPrefab();
    const scene = doc().scene;

    await usePrefabModeStore.getState().open(OUTER_ID);
    addEntity(createMeshEntity('box'));
    await usePrefabModeStore.getState().open(ASSET_ID);
    addEntity(createMeshEntity('box'));

    const composed = composedPrefabMode()!;
    expect(saved).toEqual([]);
    expect(composed.scene).toBe(scene);

    await usePrefabModeStore.getState().exit();

    // Innermost first, as leaving goes; each one the same as composed.
    expect(saved.map(([id]) => id)).toEqual([ASSET_ID, OUTER_ID]);
    for (const [id, prefab] of saved) expect(composed.prefabs[id]).toEqual(prefab);
  });

  describe('every open prefab saved, and left open', () => {
    /*
     * For a gesture about to reload the window, which ends Prefab Mode by
     * itself. Leaving first would put the scene back for nothing — and leave it
     * there when the main process's unsaved-changes prompt is cancelled.
     */

    /** A room with a crate opened inside it, both edited. */
    async function inBothEdited(): Promise<void> {
      givenAnOuterPrefab();
      await usePrefabModeStore.getState().open(OUTER_ID);
      addEntity(createMeshEntity('box'));
      await usePrefabModeStore.getState().open(ASSET_ID);
      addEntity(createMeshEntity('box'));
    }

    it('saves what leaving would save, innermost first, and moves nothing', async () => {
      await inBothEdited();
      const composed = composedPrefabMode()!;
      const document = doc().scene;
      const past = doc().past;
      const selection = useEditorStore.getState().selection;

      await usePrefabModeStore.getState().saveAll();

      expect(saved.map(([id]) => id)).toEqual([ASSET_ID, OUTER_ID]);
      for (const [id, prefab] of saved) expect(prefab).toEqual(composed.prefabs[id]);
      expect(usePrefabModeStore.getState().stack).toHaveLength(2);
      expect(doc().scene).toBe(document);
      expect(doc().past).toBe(past);
      expect(useEditorStore.getState().selection).toBe(selection);
    });

    it('leaves unsaved only what it did not save: the scene', async () => {
      await inBothEdited();
      await usePrefabModeStore.getState().saveAll();
      expect(windowUnsaved()).toBe(false);

      await usePrefabModeStore.getState().exit();
      addEntity(createMeshEntity('box'));
      await inBothEdited();
      await usePrefabModeStore.getState().saveAll();
      expect(windowUnsaved()).toBe(true);
      expect(sceneUnsaved()).toBe(true);
    });

    it('lets leaving afterwards save the same again and give the scene back', async () => {
      const scene = doc().scene;
      await inBothEdited();
      await usePrefabModeStore.getState().saveAll();
      const first = saved.map(([, prefab]) => prefab);

      await usePrefabModeStore.getState().exit();

      expect(saved.slice(2).map(([id]) => id)).toEqual([ASSET_ID, OUTER_ID]);
      expect(saved.slice(2).map(([, prefab]) => prefab)).toEqual(first);
      expect(usePrefabModeStore.getState().stack).toEqual([]);
      expect(doc().scene).toBe(scene);
    });
  });
});
