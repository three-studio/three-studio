import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { useProjectStore } from '../state/projectStore';
import { windowUnsaved } from '../state/unsaved';
import { defineCommand, type EditorContext } from './command';
import {
  deleteSelection,
  duplicateSelection,
  groupSelection,
  redo,
  setEntityVisible,
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
 * stops one path and not the other is the padlock defect in a second costume: phase 4 wired the
 * capability once, and three callers out of four used it.
 *
 * Counted before the registry was written: nine activation decisions across four
 * files, with `duplicate` written three times and `delete` three times. And two
 * gestures existed on one side only — `group` had no Edit-menu entry, and Cmd+S
 * saved a document the menu greyed out as unmodified.
 */

const documentStore = () => useDocumentStore.getState();

/** Whether the one entity a context names is currently visible. */
function visibleIn(ctx: EditorContext): boolean {
  return ctx.selection.entities()[0]?.visible ?? true;
}

export const EDIT_COMMANDS = {
  undo: defineCommand({
    label: () => {
      const entry = documentStore().undoLabel();
      return entry === null ? 'Undo' : `Undo ${entry}`;
    },
    writesScene: true,
    can: () => documentStore().canUndo(),
    run: () => undo(),
  }),

  redo: defineCommand({
    label: () => {
      const entry = documentStore().redoLabel();
      return entry === null ? 'Redo' : `Redo ${entry}`;
    },
    writesScene: true,
    can: () => documentStore().canRedo(),
    run: () => redo(),
  }),

  save: defineCommand({
    label: () => 'Save Scene',
    /**
     * The menu greyed this out on a clean document and Cmd+S wrote the file
     * anyway. Harmless, and exactly the shape of the divergence this table
     * exists to make impossible.
     *
     * The window's unsaved work, not the document's. With a prefab open the
     * document is the prefab, and the scene's edits sat set aside where asking
     * the document could not see them: Cmd+S did nothing, with the scene
     * unsaved behind an untouched prefab. Save Scene writes both — leaving
     * Prefab Mode saves the prefabs, then the scene is written.
     */
    can: () => !useProjectStore.getState().saving && windowUnsaved(),
    run: () => {
      void useProjectStore.getState().save();
    },
  }),

  /**
   * Shows every gesture that can act right now.
   *
   * A command rather than a special case in the key handler, so its key comes
   * out of the one binding table like every other. It lists itself, which is
   * what VS Code does too: running it from inside closes the palette and opens
   * it again, and nothing is worse for the entry being there.
   */
  openCommandPalette: defineCommand({
    label: () => 'Command Palette…',
    can: () => true,
    run: () => useEditorStore.getState().openPalette(),
  }),

  duplicate: defineCommand({
    label: (ctx) =>
      ctx.selection.isMultiple ? `Duplicate ${ctx.selection.size} Objects` : 'Duplicate',
    writesScene: true,
    can: (ctx) => ctx.selection.can('duplicate'),
    run: (ctx) => duplicateSelection(ctx.selection),
  }),

  delete: defineCommand({
    label: (ctx) => (ctx.selection.isMultiple ? `Delete ${ctx.selection.size} Objects` : 'Delete'),
    writesScene: true,
    can: (ctx) => ctx.selection.can('delete'),
    run: (ctx) => deleteSelection(ctx.selection),
  }),

  /**
   * Hide or show what the context names.
   *
   * One entity, because that is the gesture that exists: the hierarchy's eye
   * button acts on its own row. Hiding a whole selection would need a single
   * `mutate` over all of it — looping `setEntityVisible` would write one undo
   * entry per object — and there is no caller asking for it yet.
   *
   * A capability rather than a bare existence check, even though `toggleVisible`
   * is denied to nothing today: the answer belongs to `capabilitiesOf`, and
   * asking it here is what keeps a future denial from having to find this line.
   */
  toggleVisibility: defineCommand({
    label: (ctx) => (visibleIn(ctx) ? 'Hide' : 'Show'),
    writesScene: true,
    can: (ctx) => ctx.selection.isSingle && ctx.selection.can('toggleVisible'),
    run: (ctx) => {
      const id = ctx.selection.primary;
      if (id !== null) setEntityVisible(id, !visibleIn(ctx));
    },
  }),

  group: defineCommand({
    label: () => 'Group Selection',
    writesScene: true,
    can: (ctx) => ctx.selection.can('group'),
    run: (ctx) => {
      groupSelection(ctx.selection);
    },
  }),

  /**
   * Renaming asks a view to put a row into edit mode, because only a view has
   * rows — and it does it by writing `editorStore.renaming`, which is the state
   * "this entity is being renamed" rather than a message to a particular panel.
   *
   * It used to call a mutable module slot filled by `setRenameHandler`, which
   * **nothing ever called**: the slot stayed `undefined` and `run` did nothing
   * at all, while the hierarchy set its own local state behind the registry's
   * back. Two ways to start a rename, one of them dead — the exact shape this
   * layer exists to remove.
   *
   * `ctx.selection`, not `editorStore.selection`: the row that was
   * right-clicked is not always the one that is selected, and reading the store
   * directly was how this ignored the context it was handed.
   */
  rename: defineCommand({
    label: () => 'Rename',
    // It writes nothing itself, but it opens a row's name, and the only end of
    // that field is a scene write: opened during Play, its Enter would be
    // refused after the typing.
    writesScene: true,
    can: (ctx) => !ctx.selection.isMultiple && ctx.selection.can('rename'),
    run: (ctx) => {
      const id = ctx.selection.primary;
      if (id !== null) useEditorStore.getState().beginRename(id);
    },
  }),
};
