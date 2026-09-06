import { createEmptyScene, createMeshEntity } from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addEntity, groupSelection } from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { Selection } from '../src/state/selection';

/*
 * One description per gesture, and every caller derives from it.
 *
 * The defect that motivated the registry: two paths to the same gesture that
 * answered the opposite. `useShortcuts` asked `Selection.can('group')` — which a
 * lock refuses — and the Add menu asked `selection.length === 0`, which it does
 * not. A padlock that stopped the shortcut and not the menu, which is B11 in a
 * second costume: phase 4 wired the capability once and three callers out of
 * four used it.
 */

const doc = () => useDocumentStore.getState();

beforeEach(() => {
  doc().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

/** A locked cube, selected. Everything below is a question about it. */
function lockedAndSelected(): string {
  const cube = createMeshEntity('box');
  const id = addEntity(cube);
  doc().mutate('Lock', (draft) => {
    const entity = draft.entities[id];
    if (entity) entity.locked = true;
  });
  useEditorStore.getState().setSelection([id]);
  return id;
}

describe('one answer per gesture, whoever asks', () => {
  it('refuses to group a locked entity, from the menu as from the shortcut', async () => {
    const id = lockedAndSelected();
    const { commandById } = await import('../src/commands/registry');
    const group = commandById('group');

    expect(Selection.current().can('group')).toBe(false);
    // The menu used to ask a different question — `selection.length === 0` —
    // and let the click through. `run` is the last guard: it asks `can` itself,
    // so a caller that forgets cannot put the divergence back one level down.
    expect(group.can()).toBe(false);
    const before = doc().past.length;
    group.run();
    expect(doc().past.length).toBe(before);
    expect(doc().scene.entities[id]?.parent).toBeNull();
  });

  it('groups an unlocked selection, so the refusal is about the lock', async () => {
    const first = addEntity(createMeshEntity('box'));
    const second = addEntity(createMeshEntity('sphere'));
    useEditorStore.getState().setSelection([first, second]);

    const { commandById } = await import('../src/commands/registry');
    const group = commandById('group');
    expect(group.can()).toBe(true);

    group.run();
    expect(doc().scene.entities[first]?.parent).not.toBeNull();
    expect(doc().scene.entities[second]?.parent).toBe(doc().scene.entities[first]?.parent);
  });

  it('refuses to delete and duplicate a locked entity through the registry', async () => {
    lockedAndSelected();
    const { commandById } = await import('../src/commands/registry');

    // Both were decided in three places each — the shortcut, the menu bar and
    // the hierarchy's context menu — with the same predicate written out three
    // times.
    expect(commandById('delete').can()).toBe(false);
    expect(commandById('duplicate').can()).toBe(true);
  });
});

describe('the gesture underneath, which is why one caller must own the asking', () => {
  it('groups a locked entity when nobody asks the capability', () => {
    const id = lockedAndSelected();

    // Measured, not assumed: this is what the Add menu was reaching. `graph.ts`
    // is right not to refuse it — a lock is a *capability*, not a rule about
    // structure, and `capabilities.ts` says so at the top. Mixing the two would
    // let a miscomputed capability corrupt a document. So the asking has to
    // happen above, and the point of the registry is that it happens once.
    groupSelection(Selection.current());
    expect(doc().scene.entities[id]?.parent).not.toBeNull();
  });
});

describe('the registry itself', () => {
  it('answers `false` rather than throwing for a gesture nothing can do yet', async () => {
    const { commandById } = await import('../src/commands/registry');

    // Nothing selected: every gesture on a selection is off, and none of them
    // may throw — a menu is built before the user has selected anything.
    for (const id of ['delete', 'duplicate', 'group', 'rename'] as const) {
      expect(commandById(id).can(), id).toBe(false);
    }
  });

  it('says the same thing about undo whether asked for a label or for a verdict', async () => {
    const { commandById } = await import('../src/commands/registry');
    const undo = commandById('undo');

    expect(undo.can()).toBe(false);
    expect(undo.label()).toBe('Undo');

    addEntity(createMeshEntity('box'));
    expect(undo.can()).toBe(true);
    // The label names the gesture it would take back, as every editor does.
    expect(undo.label()).toContain('Add');
  });
});

describe('the table is the list of ids, so nothing can be filed twice', () => {
  it('keeps every family whole when they are spread together', async () => {
    const { COMMANDS } = await import('../src/commands/registry');
    const { ASSET_COMMANDS } = await import('../src/commands/assetCommands');
    const { EDIT_COMMANDS } = await import('../src/commands/editCommands');
    const { SCENE_FILE_COMMANDS } = await import('../src/commands/sceneFileCommands');

    // The one failure mode a composed table has: two families using one id, in
    // which case the later spread wins and the earlier command disappears with
    // no error anywhere. `delete` and `deleteAsset` are one keystroke apart, so
    // this is not hypothetical.
    //
    // The list below is the one thing here that has to be kept up to date, and
    // it is meant to be: a family added to the registry and not to this line
    // makes the count wrong, which is the test asking whether the new family
    // arrived whole. `core`'s component registry checks the same thing against
    // `COMPONENT_TYPES`; commands have no such canonical union, precisely
    // because the table *is* the list.
    const families = [EDIT_COMMANDS, SCENE_FILE_COMMANDS, ASSET_COMMANDS];
    const declared = families.reduce((total, family) => total + Object.keys(family).length, 0);
    expect(Object.keys(COMMANDS)).toHaveLength(declared);

    // Counting alone would pass if two families collided and a third grew by
    // one in the same commit. Identity says each command is the one its family
    // declared.
    for (const family of families) {
      for (const [id, command] of Object.entries(family)) {
        expect(COMMANDS[id as keyof typeof COMMANDS], id).toBe(command);
      }
    }
  });

  it('offers no scene-file gesture while no project is open', async () => {
    const { commandById } = await import('../src/commands/registry');

    // The menu used to offer all four regardless: Duplicate and Rename with no
    // `disabled` at all, against gestures that open with
    // `if (sceneId === null) return`. A dialog that takes a name and does
    // nothing with it is worse than a greyed entry.
    for (const id of ['newScene', 'saveSceneAs', 'duplicateScene', 'renameScene', 'deleteScene'] as const) {
      expect(commandById(id).can(), id).toBe(false);
    }
  });
});

describe('a gesture aimed at an asset', () => {
  it('refuses when the context names none, and when the one it names is gone', async () => {
    const { commandById, contextForAsset } = await import('../src/commands/registry');

    // Both cases end at the same place — `byId` hands back `undefined` — and
    // both are real: the Inspector's asset slot can hold an id whose file was
    // deleted from another window, and a menu built from the registry has no
    // asset in mind at all.
    for (const id of ['revealAsset', 'deleteAsset'] as const) {
      expect(commandById(id).can(), `${id}, no target`).toBe(false);
      expect(commandById(id).can(contextForAsset('gone')), `${id}, missing`).toBe(false);
    }
  });

  it('names the asset in its label once there is one', async () => {
    const { commandById, contextForAsset } = await import('../src/commands/registry');
    const { useAssetStore } = await import('../src/state/assetStore');

    const asset = {
      id: 'tex1',
      name: 'brick',
      kind: 'texture',
      path: 'assets/textures/brick.png',
      folder: 'textures',
      sizeBytes: 1,
      modifiedAt: 0,
      importedAt: 0,
      hash: '',
      settings: {},
    };
    useAssetStore.setState({
      manifest: { version: 1, assets: [asset], folders: ['textures'] },
    } as never);

    const ctx = contextForAsset('tex1');
    expect(commandById('deleteAsset').can(ctx)).toBe(true);
    // The label names what it would act on, the way `undo` names what it would
    // take back — which is what a command palette shows.
    expect(commandById('deleteAsset').label(ctx)).toBe('Delete "brick"');
    expect(commandById('revealAsset').label(ctx)).toContain('brick');
  });
});
