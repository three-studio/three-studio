import { createEmptyScene, createEntity, createMeshEntity, serializeScene } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addEntity,
  duplicateSelection,
  groupSelection,
  deleteSelection,
  renameEntity,
  reparentEntity,
  setEntityVisible,
  setTransform,
} from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { Selection } from '../src/state/selection';
import { expandedScene } from '../src/state/expansion';

/** A selection over the scene as it is drawn, for commands that take one. */
const sel = (ids: readonly string[]) => Selection.of(ids, expandedScene().scene);

/*
 * The round-trip property, which ADR-4 calls the measure that pays for itself
 * most: on any sequence of commands, N undos return the editor to where it
 * started and N redos to where it ended.
 *
 * It is worth more than the same number of per-command tests because it does not
 * name the commands. "The inverse of X is wrong" is caught for every X, today
 * and for the ones nobody has written yet — which is the only kind of test that
 * resists a codebase still growing features.
 *
 * State here means the document *and* the selection. Undo that restores the
 * scene but not the selection is exactly B2, and a property test that ignored
 * the selection would have passed straight through it.
 */

const doc = () => useDocumentStore.getState();

/** Deterministic, so a failure can be replayed rather than guessed at. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything a user could notice, as one comparable value. */
function snapshot(): string {
  return JSON.stringify({
    scene: serializeScene(doc().scene),
    selection: [...useEditorStore.getState().selection],
  });
}

const KINDS = ['box', 'sphere', 'cylinder'] as const;

/**
 * One random command against whatever is currently in the scene.
 *
 * Every one may legitimately do nothing — deleting from an empty scene, grouping
 * an empty selection — which is itself worth exercising: a command that records
 * an entry for a no-op breaks the count on which the round trip rests.
 */
function step(pick: () => number): void {
  const ids = Object.keys(doc().scene.entities);
  const any = () => ids[Math.floor(pick() * ids.length)];
  const choice = Math.floor(pick() * 8);

  switch (choice) {
    case 0:
      addEntity(createMeshEntity(KINDS[Math.floor(pick() * KINDS.length)]!));
      return;
    case 1:
      addEntity(createEntity('Empty'), ids.length > 0 ? (any() ?? null) : null);
      return;
    case 2: {
      const id = any();
      if (id !== undefined) deleteSelection(sel([id]));
      return;
    }
    case 3: {
      const id = any();
      const parent = any();
      if (id !== undefined) reparentEntity(id, pick() < 0.3 ? null : (parent ?? null));
      return;
    }
    case 4: {
      const id = any();
      if (id !== undefined) renameEntity(id, `Renamed ${Math.floor(pick() * 1000)}`);
      return;
    }
    case 5: {
      const id = any();
      if (id === undefined) return;
      // Sometimes coalesced, sometimes not: an entry that absorbs later writes
      // has a different shape, and both must undo to the same place.
      const key = pick() < 0.5 ? { coalesceKey: 'drag' } : undefined;
      setTransform(id, { position: [pick() * 10, pick() * 10, pick() * 10] }, key);
      return;
    }
    case 6: {
      const id = any();
      if (id !== undefined) duplicateSelection(sel([id]));
      return;
    }
    default: {
      const id = any();
      if (id === undefined) return;
      if (pick() < 0.5) {
        useEditorStore.getState().setSelection([id]);
        groupSelection(Selection.current());
      } else {
        setEntityVisible(id, pick() < 0.5);
      }
    }
  }
}

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

describe('undo and redo, on any sequence of commands', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`returns to where it started and back again (seed ${seed})`, () => {
      const pick = random(seed);
      const start = snapshot();

      for (let n = 0; n < 40; n++) step(pick);
      const end = snapshot();
      // Otherwise the property is vacuous: forty no-ops undo perfectly.
      expect(end).not.toBe(start);

      const depth = doc().past.length;
      expect(depth).toBeGreaterThan(5);

      for (let n = 0; n < depth; n++) doc().undo();
      expect(doc().canUndo()).toBe(false);
      expect(snapshot()).toBe(start);

      for (let n = 0; n < depth; n++) doc().redo();
      expect(doc().canRedo()).toBe(false);
      expect(snapshot()).toBe(end);
    });
  }

  it('stays consistent when undo and redo interleave', () => {
    const pick = random(2024);
    for (let n = 0; n < 30; n++) step(pick);

    // Walk back and forth over the middle of the stack, landing where we began.
    const marks: string[] = [];
    for (let n = 0; n < 8; n++) {
      marks.push(snapshot());
      doc().undo();
    }
    for (let n = 0; n < 8; n++) {
      doc().redo();
      expect(snapshot()).toBe(marks.pop());
    }
  });

  it('drops the redo stack when an edit follows an undo', () => {
    addEntity(createMeshEntity('box'));
    addEntity(createMeshEntity('sphere'));
    doc().undo();
    expect(doc().canRedo()).toBe(true);

    addEntity(createMeshEntity('cylinder'));
    expect(doc().canRedo()).toBe(false);
  });
});
