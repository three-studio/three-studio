import {
  createEntity,
  createMeshEntity,
  createModelEntity,
  createPrefabInstance,
  instancedId,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { prefabWith, sceneWith } from '../../core/test/fixtures';
import {
  commandById,
  commandIds,
  contextFor,
  currentContext,
  type CommandId,
  type EditorContext,
} from '../src/commands/registry';
import { commandEntry } from '../src/shell/commandEntry';
import { useAssetStore } from '../src/state/assetStore';
import { useDialogStore } from '../src/state/dialogStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { STOP_TO_EDIT, isSceneLocked, sceneLocked } from '../src/state/sceneLock';
import { useToastStore } from '../src/state/toastStore';

/*
 * From the press of Play until Stop, nothing edits the scene document.
 *
 * Stop used to put back a copy taken at the press and keep the history, so an
 * edit made during Play vanished at Stop while its undo entry stayed, ready to
 * apply its patches to a document they were never made against. The document
 * now refuses the edit, and says so once, in a toast that goes at Stop. What it
 * still takes during Play is what does not edit the scene: an asset edit riding
 * the scene's stack, a load, a restore, a save.
 */

const doc = () => useDocumentStore.getState();
const toasts = () => useToastStore.getState().toasts;
const play = () => useEditorStore.getState().play();
const pause = () => useEditorStore.getState().togglePause();
const stop = () => useEditorStore.getState().stop();
const playState = () => useEditorStore.getState().playState;
const x = (id: string) => doc().scene.entities[id]!.transform.position[0];

interface Spied {
  apply: Mock<() => void>;
  revert: Mock<() => void>;
}
const spied = (): Spied => ({ apply: vi.fn(), revert: vi.fn() });

const PREFAB_ID = 'crate-prefab';
const real = (({ savePrefab, saveMaterial, createPrefab, createMaterial }) => ({
  savePrefab,
  saveMaterial,
  createPrefab,
  createMaterial,
}))(useAssetStore.getState());

let first = '';
let second = '';
/** A prefab instance carrying an override. */
let crate = '';
/** The entity that instance produces, by its expanded id. */
let produced = '';
/** A model entity that still draws its whole file. */
let chair = '';
/** The external edits riding the two entries, the one Undo would take and the one Redo would. */
let undoable: Spied;
let redoable: Spied;
/** The asset writes a scene-writing gesture can make before it reaches the document. */
let recorded: {
  savePrefab: Mock<() => Promise<void>>;
  saveMaterial: Mock<() => Promise<void>>;
  createPrefab: Mock<() => Promise<string>>;
  createMaterial: Mock<() => Promise<string>>;
};
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  stop();
  useToastStore.getState().clear();
  useDialogStore.getState().cancel();
  useEditorStore.getState().endRename();
  useEditorStore.getState().clearSelection();

  const inside = createMeshEntity('box');
  recorded = {
    savePrefab: vi.fn(async () => {}),
    saveMaterial: vi.fn(async () => {}),
    createPrefab: vi.fn(async () => 'new-prefab'),
    createMaterial: vi.fn(async () => 'new-material'),
  };
  useAssetStore.setState({
    prefabs: { [PREFAB_ID]: prefabWith('Crate', [inside], inside.entity.id) },
    ...recorded,
  });

  const a = createMeshEntity('box');
  const b = createMeshEntity('sphere');
  const instance = createEntity('Crate', [
    { ...createPrefabInstance(PREFAB_ID), overrides: { [inside.entity.id]: { name: 'Renamed' } } },
  ]);
  const model = createModelEntity('chair-model', 'Chair');
  first = a.entity.id;
  second = b.entity.id;
  crate = instance.entity.id;
  produced = instancedId(crate, inside.entity.id);
  chair = model.entity.id;
  doc().replaceScene(sceneWith([a, b, instance, model]));
  // Two edits, the second undone: Undo and Redo both have something to act on.
  undoable = spied();
  redoable = spied();
  doc().mutate('Move first', (scene) => void (scene.entities[first]!.transform.position[0] = 1), {
    external: undoable,
  });
  doc().mutate('Move second', (scene) => void (scene.entities[second]!.transform.position[0] = 2), {
    external: redoable,
  });
  doc().undo();
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stop();
  useAssetStore.setState(real);
  vi.restoreAllMocks();
});

/** What the document holds, by identity. */
function held() {
  const { scene, past, future, revision } = doc();
  return { scene, past, future, revision };
}

describe('the rule', () => {
  it('locks the scene from the press of Play until Stop, through Pause', () => {
    expect(sceneLocked('stopped')).toBe(false);
    expect(sceneLocked('playing')).toBe(true);
    expect(sceneLocked('paused')).toBe(true);

    expect(isSceneLocked()).toBe(false);
    play();
    expect(isSceneLocked()).toBe(true);
    pause();
    expect(isSceneLocked()).toBe(true);
    stop();
    expect(isSceneLocked()).toBe(false);
  });
});

describe('the document while the game runs', () => {
  it.each([
    ['playing', play],
    ['paused', () => (play(), pause())],
  ])('refuses an edit while %s, before its recipe runs', (_state, enter) => {
    enter();
    const before = held();
    const recipe = vi.fn();
    const external = spied();

    doc().mutate('Probe', recipe, { external });

    expect(recipe).not.toHaveBeenCalled();
    expect(external.apply).not.toHaveBeenCalled();
    expect(held()).toEqual(before);
    expect(doc().scene).toBe(before.scene);
    expect(doc().past).toBe(before.past);
    expect(doc().future).toBe(before.future);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({ kind: 'warning', title: 'Stop the game to edit the scene' });
    expect(toasts()[0]!.actions).toEqual([{ label: 'Stop', primary: true, onClick: expect.any(Function) }]);
    // The backstop names what reached it: every gesture is meant to ask the
    // lock first, so whatever arrives here is one that forgot.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]![0])).toContain('"Probe"');
  });

  it('takes the same edit once stopped', () => {
    play();
    doc().mutate('Probe', (scene) => void (scene.entities[first]!.transform.position[0] = 7));
    expect(x(first)).toBe(1);

    stop();
    const revision = doc().revision;
    doc().mutate('Probe', (scene) => void (scene.entities[first]!.transform.position[0] = 7));

    expect(x(first)).toBe(7);
    expect(doc().revision).toBe(revision + 1);
    expect(doc().past.at(-1)!.label).toBe('Probe');
  });

  it('neither undoes nor redoes, and calls out to no edit outside it', () => {
    play();
    const before = held();

    doc().undo();
    doc().redo();

    expect(held()).toEqual(before);
    expect(doc().scene).toBe(before.scene);
    expect(x(first)).toBe(1);
    expect(x(second)).toBe(0);
    expect(undoable.revert).not.toHaveBeenCalled();
    expect(redoable.apply).not.toHaveBeenCalled();
    expect(toasts()).toHaveLength(1);
  });

  it('undoes and redoes again once stopped', () => {
    play();
    doc().undo();
    doc().redo();
    stop();

    doc().undo();
    expect(x(first)).toBe(0);
    expect(undoable.revert).toHaveBeenCalledTimes(1);

    doc().redo();
    doc().redo();
    expect(x(first)).toBe(1);
    expect(x(second)).toBe(2);
    expect(undoable.apply).toHaveBeenCalledTimes(1);
    expect(redoable.apply).toHaveBeenCalledTimes(1);
  });
});

describe('what the lock leaves alone while the game runs', () => {
  it('an asset edit riding the scene’s stack', () => {
    play();
    const revision = doc().revision;
    const external = spied();

    doc().recordExternal('Edit material Stone', external);

    expect(doc().past.at(-1)).toMatchObject({ label: 'Edit material Stone', external });
    expect(doc().future).toEqual([]);
    expect(doc().revision).toBe(revision + 1);
    expect(toasts()).toEqual([]);
  });

  it('a restore, a history put back, an identity adopted and a save', () => {
    const stash = doc().historyStash();
    const other = sceneWith([createMeshEntity('box')]);
    play();

    doc().replaceScene(other, { keepHistory: true });
    expect(doc().scene).toBe(other);

    doc().restoreHistory({ ...stash, past: [], future: [] });
    expect(doc().past).toEqual([]);

    doc().adoptIdentity({ id: 'copy', name: 'Copy' });
    expect(doc().scene).toMatchObject({ id: 'copy', name: 'Copy' });

    doc().markClean();
    expect(doc().savedRevision).toBe(doc().revision);

    expect(toasts()).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('the toast that says it', () => {
  const refuse = () => doc().mutate('Probe', () => {});

  it('is one toast however many refusals, replaced where it stands', () => {
    play();
    refuse();
    const [shown] = toasts();

    refuse();
    doc().undo();

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.id).toBe(shown!.id);
  });

  it('stops the game from its action, and goes with the lock', () => {
    play();
    refuse();

    toasts()[0]!.actions![0]!.onClick();

    expect(playState()).toBe('stopped');
    expect(toasts()).toEqual([]);
  });

  it('goes at Stop, and comes back with a refusal in the next Play', () => {
    play();
    refuse();
    pause();
    expect(toasts()).toHaveLength(1);

    stop();
    expect(toasts()).toEqual([]);

    play();
    expect(toasts()).toEqual([]);
    refuse();
    expect(toasts()).toHaveLength(1);
  });

  it('is shown anew at the next refusal once the person has closed it', () => {
    play();
    refuse();
    const closed = toasts()[0]!.id;
    useToastStore.getState().dismiss(closed);

    refuse();

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.id).not.toBe(closed);
  });
});

/*
 * The commands. A gesture that writes the scene is refused by its `can()`,
 * before anything is asked or written: Create Prefab asks for a name and writes
 * the prefab, Apply Overrides writes the prefab, Unpack Model loads the file
 * and may ask to confirm — all before they reach the document, whose refusal
 * would come too late for any of it.
 */

/** Each command that writes the scene, in a context of the fixture where it acts. */
const WRITERS: Readonly<Record<string, () => EditorContext>> = {
  undo: () => currentContext(),
  redo: () => currentContext(),
  duplicate: () => contextFor([first]),
  delete: () => contextFor([first]),
  toggleVisibility: () => contextFor([first]),
  group: () => contextFor([first]),
  rename: () => contextFor([first]),
  createPrefab: () => contextFor([first]),
  applyPrefabOverrides: () => contextFor([crate]),
  revertPrefabOverrides: () => contextFor([crate]),
  unpackPrefab: () => contextFor([crate]),
  revertEntityOverride: () => contextFor([produced]),
  unpackModel: () => contextFor([chair]),
};

/**
 * Every other command. A command added later joins one of the two lists, or
 * the first test below fails: which side it is on is a decision, not a default.
 */
const OTHERS: readonly CommandId[] = [
  'save',
  'openCommandPalette',
  'createPrefabVariant',
  'selectPrefabInstances',
  'newScene',
  'saveSceneAs',
  'revertScene',
  'duplicateScene',
  'renameScene',
  'openScene',
  'openSceneInNewWindow',
  'setStartScene',
  'sceneSettings',
  'revealScene',
  'deleteScene',
  'revealAsset',
  'deleteAsset',
  'runExport',
  'play',
  'playFullScreen',
  'stop',
  'launchOnDevices',
  'stopDeviceServer',
  'deviceServerPort',
  'reclaimDevicePort',
  'copyDeviceLink',
  'openDevicePage',
  'newDeviceLink',
  'toggleLiveReload',
  'toggleDeviceStats',
  'captureDevices',
  'toggleForceWebGL',
];

/** The writers with their contexts, read now: a context is never kept. */
const writers = (): [CommandId, EditorContext][] =>
  Object.entries(WRITERS).map(([id, context]) => [id as CommandId, context()]);

describe('the commands that write the scene', () => {
  it('are thirteen, and every other command is listed as one that does not', () => {
    expect(Object.keys(WRITERS)).toHaveLength(13);
    expect(OTHERS).toHaveLength(32);
    expect([...Object.keys(WRITERS), ...OTHERS].sort()).toEqual([...commandIds()].sort());
  });

  it('wait for Stop: refused before anything is asked or written, and said in one toast', () => {
    for (const [id, context] of writers()) expect(commandById(id).can(context), id).toBe(true);

    play();
    const before = held();
    for (const [id, context] of writers()) {
      const command = commandById(id);
      expect(command.can(context), id).toBe(false);
      expect(command.waitsForStop(context), id).toBe(true);
      command.run(context);
    }

    expect(held()).toEqual(before);
    expect(doc().scene).toBe(before.scene);
    expect(doc().past).toBe(before.past);
    expect(doc().future).toBe(before.future);
    for (const [name, recorder] of Object.entries(recorded)) expect(recorder, name).not.toHaveBeenCalled();
    expect(useDialogStore.getState().prompt).toBeNull();
    expect(useDialogStore.getState().confirm).toBeNull();
    expect(useEditorStore.getState().renaming).toBeNull();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]!.title).toBe('Stop the game to edit the scene');
    // Refused by their `can()`: nothing reached the document's backstop.
    expect(consoleError).not.toHaveBeenCalled();

    stop();
    for (const [id, context] of writers()) expect(commandById(id).can(context), id).toBe(true);
  });

  it('say nothing during Play when they would not act anyway', () => {
    play();
    const nothing = contextFor([]);
    const remove = commandById('delete');

    expect(remove.can(nothing)).toBe(false);
    expect(remove.waitsForStop(nothing)).toBe(false);
    expect(commandEntry('delete', nothing).detail).toBeUndefined();
    remove.run(nothing);

    expect(toasts()).toEqual([]);
  });

  it('grey their menu rows during Play, beside Stop to edit', () => {
    for (const [id, context] of writers()) {
      const row = commandEntry(id, context);
      expect(row.disabled, id).toBe(false);
      expect(row.detail, id).toBeUndefined();
    }

    play();
    for (const [id, context] of writers()) {
      const row = commandEntry(id, context);
      expect(row.disabled, id).toBe(true);
      expect(row.detail, id).toBe(STOP_TO_EDIT);
    }

    stop();
    for (const [id, context] of writers()) expect(commandEntry(id, context).detail, id).toBeUndefined();
  });

  it('leave every other command as it was, Save offered', () => {
    const context = () => contextFor([first]);
    const stopped = OTHERS.map((id) => commandById(id).can(context()));

    play();
    const playing = OTHERS.map((id) => commandById(id).can(context()));

    for (const id of OTHERS) expect(commandById(id).waitsForStop(context()), id).toBe(false);
    expect(OTHERS.filter((_, index) => stopped[index] !== playing[index])).toEqual([
      'play',
      'playFullScreen',
      'stop',
    ]);
    // The document during Play is the one Play started from, and it is unsaved.
    expect(commandById('save').can()).toBe(true);
  });

  it('drop out of the palette during Play, which keeps Save and Stop', () => {
    useEditorStore.getState().setSelection([first]);
    const palette = () => commandIds().filter((id) => commandById(id).can());
    expect(palette()).toEqual(expect.arrayContaining(['undo', 'redo', 'duplicate', 'delete', 'save']));

    play();
    const listed = palette();

    for (const id of Object.keys(WRITERS)) expect(listed, id).not.toContain(id);
    expect(listed).toEqual(expect.arrayContaining(['save', 'stop']));
  });
});
