import { createMeshEntity } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { isSceneLocked, sceneLocked } from '../src/state/sceneLock';
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

let first = '';
let second = '';
/** The external edits riding the two entries, the one Undo would take and the one Redo would. */
let undoable: Spied;
let redoable: Spied;
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  stop();
  useToastStore.getState().clear();
  const a = createMeshEntity('box');
  const b = createMeshEntity('sphere');
  first = a.entity.id;
  second = b.entity.id;
  doc().replaceScene(sceneWith([a, b]));
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
