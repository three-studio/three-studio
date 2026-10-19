import { createEmptyScene, createMeshEntity } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { contextFor } from '../src/commands/registry';
import { addEntity } from '../src/commands/sceneCommands';
import { commandEntry } from '../src/shell/commandEntry';
import { shortcutHint } from '../src/shell/shortcutBindings';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';

/*
 * A menu row is a command seen from a menu: its label, its key, its verdict and
 * its body. The menu bar, the Add menu and the hierarchy's context menu each
 * wrote those four fields by hand, and the one place now has to say exactly
 * what the command says — no more, and against the context it was handed.
 */

const doc = () => useDocumentStore.getState();

beforeEach(() => {
  doc().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

describe('a row says what its command says', () => {
  it('follows undo from greyed to the gesture it would take back', () => {
    const before = commandEntry('undo');
    expect(before.label).toBe('Undo');
    expect(before.disabled).toBe(true);
    expect(before.shortcut).toBe(shortcutHint('undo'));
    expect(before.shortcut).toBeDefined();

    const cube = createMeshEntity('box');
    addEntity(cube);

    const after = commandEntry('undo');
    expect(after.label).toBe(`Undo Add ${cube.entity.name}`);
    expect(after.disabled).toBe(false);
  });

  it('gives a command bound to no key no hint', () => {
    expect(commandEntry('newScene').shortcut).toBeUndefined();
  });
});

describe('the context it is given is the one it acts on', () => {
  it('hides the entity the context names, with nothing selected', () => {
    const id = addEntity(createMeshEntity('box'));
    // `addEntity` selects what it creates; the row has to work from its own
    // context, the way a right-click outside the selection does.
    useEditorStore.getState().clearSelection();

    const row = commandEntry('toggleVisibility', contextFor([id]));
    expect(row.label).toBe('Hide');
    expect(row.disabled).toBe(false);

    row.onSelect?.();
    expect(doc().scene.entities[id]?.visible).toBe(false);

    // Without a context the row reads the selection, which is empty.
    expect(commandEntry('toggleVisibility').disabled).toBe(true);
  });
});
