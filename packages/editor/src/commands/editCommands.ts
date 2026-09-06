import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { useProjectStore } from '../state/projectStore';
import { defineCommand } from './command';
import {
  deleteSelection,
  duplicateSelection,
  groupSelection,
  redo,
  undo,
} from './sceneCommands';

/*
 * The gestures on the open document: history, saving, and what can be done to a
 * selection.
 *
 * What this replaces is not four copies of the same code — it is four copies of
 * the same *decision*, which had already drifted. Select a locked entity and:
 * Cmd+G asked `Selection.can('group')`, which a lock refuses; Add ▸ Group
 * Selection asked `selection.length === 0`, which it does not — so the menu
 * grouped the object the shortcut had just refused to touch. A padlock that
 * stops one path and not the other is B11 in a second costume: phase 4 wired the
 * capability once, and three callers out of four used it.
 *
 * Counted before the registry was written: nine activation decisions across four
 * files, with `duplicate` written three times and `delete` three times. And two
 * gestures existed on one side only — `group` had no Edit-menu entry, and Cmd+S
 * saved a document the menu greyed out as unmodified.
 */

const documentStore = () => useDocumentStore.getState();

export const EDIT_COMMANDS = {
  undo: defineCommand({
    shortcut: 'Z',
    label: () => {
      const entry = documentStore().undoLabel();
      return entry === null ? 'Undo' : `Undo ${entry}`;
    },
    can: () => documentStore().canUndo(),
    run: () => undo(),
  }),

  redo: defineCommand({
    shortcut: 'Shift+Z',
    label: () => {
      const entry = documentStore().redoLabel();
      return entry === null ? 'Redo' : `Redo ${entry}`;
    },
    can: () => documentStore().canRedo(),
    run: () => redo(),
  }),

  save: defineCommand({
    shortcut: 'S',
    label: () => 'Save Scene',
    /**
     * The menu greyed this out on a clean document and Cmd+S wrote the file
     * anyway. Harmless, and exactly the shape of the divergence this table
     * exists to make impossible.
     */
    can: () => {
      const state = documentStore();
      return !useProjectStore.getState().saving && state.revision !== state.savedRevision;
    },
    run: () => {
      void useProjectStore.getState().save();
    },
  }),

  duplicate: defineCommand({
    shortcut: 'D',
    label: (ctx) =>
      ctx.selection.isMultiple ? `Duplicate ${ctx.selection.size} Objects` : 'Duplicate',
    can: (ctx) => ctx.selection.can('duplicate'),
    run: (ctx) => duplicateSelection(ctx.selection),
  }),

  delete: defineCommand({
    label: (ctx) => (ctx.selection.isMultiple ? `Delete ${ctx.selection.size} Objects` : 'Delete'),
    can: (ctx) => ctx.selection.can('delete'),
    run: (ctx) => deleteSelection(ctx.selection),
  }),

  group: defineCommand({
    shortcut: 'G',
    label: () => 'Group Selection',
    can: (ctx) => ctx.selection.can('group'),
    run: (ctx) => {
      groupSelection(ctx.selection);
    },
  }),

  /**
   * Renaming is the one gesture the registry cannot finish: what it does is put
   * a row into edit mode, and only the hierarchy has rows. It is here for its
   * `can()`, which three callers were asking in their own words, and `run` is
   * supplied by whoever owns the row.
   */
  rename: defineCommand({
    label: () => 'Rename',
    can: (ctx) => !ctx.selection.isMultiple && ctx.selection.can('rename'),
    run: () => {
      const [id] = useEditorStore.getState().selection;
      if (id !== undefined) onRenameRequested?.(id);
    },
  }),
};

/**
 * Where a rename actually happens. Set by the hierarchy panel while it is
 * mounted; `undefined` means nothing can show a text field, and the command
 * quietly does nothing rather than pretending.
 *
 * **Nothing calls the setter today**, so `rename` is a gesture that never runs.
 * That is milestone 8.2 and task T-063, which is the next one along; it is left
 * exactly as it was rather than half-fixed here.
 */
let onRenameRequested: ((entityId: string) => void) | undefined;

export function setRenameHandler(handler: ((entityId: string) => void) | undefined): void {
  onRenameRequested = handler;
}
