import { createEmptyScene, createMeshEntity, type PrefabDoc } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { commandById } from '../src/commands/registry';
import { addEntity } from '../src/commands/sceneCommands';
import { useAssetStore } from '../src/state/assetStore';
import { selectDirty, useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { sceneUnsaved, watchUnsaved, windowUnsaved } from '../src/state/unsaved';

/*
 * Two questions about unsaved work, which Prefab Mode makes different.
 *
 * Opening a prefab sets the scene's history aside and loads the prefab clean,
 * so the document — the one thing the dot, Cmd+S and the main process used to
 * ask — said "saved" while the scene's edits sat in the stash. Closing the
 * window with an untouched prefab open then lost them without a prompt.
 *
 * The prefabs are put straight into the asset store and left out of the
 * manifest, so leaving Prefab Mode saves nothing through the bridge, as in
 * `prefabMode.test.ts`.
 */

const doc = () => useDocumentStore.getState();
const prefabMode = () => usePrefabModeStore.getState();

const CRATE = 'prefab-crate';
const ROOM = 'prefab-room';

function prefabNamed(name: string): PrefabDoc {
  const root = createMeshEntity('box');
  root.entity.name = name;
  return prefabWith(name, [root], root.entity.id);
}

/** An edit to whatever the document holds, the way a person makes one. */
const edit = (): void => {
  addEntity(createMeshEntity('box'));
};

beforeEach(async () => {
  await prefabMode().exit();
  usePrefabModeStore.setState({ stack: [] });
  doc().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
  useAssetStore.setState({ prefabs: { [CRATE]: prefabNamed('Crate'), [ROOM]: prefabNamed('Room') } });
});

describe('what is unsaved', () => {
  it('follows the document outside Prefab Mode', () => {
    edit();
    expect(sceneUnsaved()).toBe(true);
    expect(windowUnsaved()).toBe(true);

    doc().markClean();
    expect(sceneUnsaved()).toBe(false);
    expect(windowUnsaved()).toBe(false);
  });

  it('counts the scene set aside behind an untouched prefab', async () => {
    edit();
    await prefabMode().open(CRATE);

    // What the dot read: the prefab, loaded clean.
    expect(selectDirty(doc())).toBe(false);
    expect(sceneUnsaved()).toBe(true);
    expect(windowUnsaved()).toBe(true);
  });

  it('tells an edited prefab apart from the scene', async () => {
    await prefabMode().open(CRATE);
    edit();

    // Revert would have nothing of the scene's to drop; closing the window
    // would still lose the prefab's edit.
    expect(sceneUnsaved()).toBe(false);
    expect(windowUnsaved()).toBe(true);
  });

  it('counts a prefab set aside behind another', async () => {
    await prefabMode().open(ROOM);
    edit();
    await prefabMode().open(CRATE);

    expect(selectDirty(doc())).toBe(false);
    expect(sceneUnsaved()).toBe(false);
    expect(windowUnsaved()).toBe(true);
  });

  it('is the scene again once Prefab Mode is left', async () => {
    edit();
    await prefabMode().open(CRATE);
    edit();
    await prefabMode().exit();

    expect(sceneUnsaved()).toBe(true);
    expect(windowUnsaved()).toBe(true);

    doc().markClean();
    expect(sceneUnsaved()).toBe(false);
    expect(windowUnsaved()).toBe(false);
  });

  it('lets Save Scene save a scene edited behind an untouched prefab', async () => {
    edit();
    await prefabMode().open(CRATE);

    expect(commandById('save').can()).toBe(true);
  });
});

describe('the main process, told as the answer changes', () => {
  const reports: boolean[] = [];

  beforeEach(() => {
    reports.length = 0;
    vi.stubGlobal('window', {
      studio: { project: { setDirty: (dirty: boolean) => void reports.push(dirty) } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports once when installed, then each change, before the next line runs', () => {
    const stop = watchUnsaved();
    expect(reports).toEqual([false]);

    // A drag is many mutations, and the answer moves once.
    for (let step = 0; step < 10; step++) edit();
    expect(reports).toEqual([false, true]);

    // Synchronous, which an effect was not: a gesture that marks the document
    // clean and then asks to switch scene needs the main process told first.
    doc().markClean();
    expect(reports).toEqual([false, true, false]);

    stop();
    edit();
    expect(reports).toEqual([false, true, false]);
  });

  it('says nothing while unsaved work moves in and out of Prefab Mode', async () => {
    edit();
    const stop = watchUnsaved();
    expect(reports).toEqual([true]);

    // The work moves between the document and a frame, and is never in
    // neither: an "unsaved: false" in between would be a window the main
    // process lets close without a word.
    await prefabMode().open(ROOM);
    await prefabMode().open(CRATE);
    await prefabMode().exit();
    expect(reports).toEqual([true]);

    stop();
  });
});
