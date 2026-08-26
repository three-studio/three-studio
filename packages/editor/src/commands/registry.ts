import { expandedScene } from '../state/expansion';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { useProjectStore } from '../state/projectStore';
import { Selection } from '../state/selection';
import {
  deleteSelection,
  duplicateSelection,
  groupSelection,
  redo,
  undo,
} from './sceneCommands';

/*
 * One description per gesture, and every caller derives from it.
 *
 * What this replaces is not four copies of the same code — it is four copies of
 * the same *decision*, which had already drifted. Select a locked entity and:
 * Cmd+G asked `Selection.can('group')`, which a lock refuses; Add ▸ Group
 * Selection asked `selection.length === 0`, which it does not — so the menu
 * grouped the object the shortcut had just refused to touch. A padlock that
 * stops one path and not the other is B11 in a second costume: phase 4 wired the
 * capability once, and three callers out of four used it.
 *
 * Counted before writing this: nine activation decisions across four files, with
 * `duplicate` written three times and `delete` three times. And two gestures
 * existed on one side only — `group` had no Edit-menu entry, and Cmd+S saved a
 * document the menu greyed out as unmodified.
 *
 * **A table of descriptions, filled once**, like the component registry of phase
 * 9. It holds no state: the document remains the only thing that does.
 */

/**
 * What a gesture acts on.
 *
 * Read at the moment it is needed and never kept, which is what stops a command
 * deciding against a stale selection — the defect `CIBLE.md` attributed to the
 * Add menu. It can also be *supplied*: the hierarchy's context menu acts on the
 * row that was right-clicked, which is not always what is selected.
 */
export interface EditorContext {
  readonly selection: Selection;
}

export function currentContext(): EditorContext {
  return { selection: Selection.current() };
}

/** The context for a specific set of ids — a right-click outside the selection. */
export function contextFor(ids: readonly string[]): EditorContext {
  return { selection: Selection.of(ids, expandedScene().scene) };
}

export type CommandId =
  | 'undo'
  | 'redo'
  | 'save'
  | 'duplicate'
  | 'delete'
  | 'group'
  | 'rename';

export interface Command {
  readonly id: CommandId;
  /** A function, because "Undo Move" names the gesture it would take back. */
  label(ctx?: EditorContext): string;
  /** Shown in menus. The key handling itself is `useShortcuts`. */
  readonly shortcut?: string;
  /** Blender's `poll()`, Unreal's `CanEditChange`. */
  can(ctx?: EditorContext): boolean;
  run(ctx?: EditorContext): void;
}

/** What a gesture is declared as, before `run` is wrapped in its own guard. */
interface CommandSpec {
  readonly id: CommandId;
  label: (ctx: EditorContext) => string;
  readonly shortcut?: string;
  can: (ctx: EditorContext) => boolean;
  run: (ctx: EditorContext) => void;
}

const commands = new Map<CommandId, Command>();

/**
 * Declares a gesture.
 *
 * `can` is required rather than optional. An optional guard is a guard somebody
 * forgets, which is the same argument ADR-4 makes for the selection carried by a
 * history entry — and forgetting it here is exactly how the menu and the
 * shortcut came to disagree.
 */
function defineCommand(spec: CommandSpec): Command {
  const command: Command = {
    id: spec.id,
    shortcut: spec.shortcut,
    label: (ctx) => spec.label(ctx ?? currentContext()),
    can: (ctx) => spec.can(ctx ?? currentContext()),
    /**
     * Checked here as well as by the caller.
     *
     * A menu greys an entry and a shortcut ignores a key, but both are ways of
     * *showing* a refusal — the refusal itself belongs to the command. Without
     * this, a fifth caller that forgets to ask puts the divergence back one
     * level down, where nothing would notice.
     */
    run: (ctx) => {
      const context = ctx ?? currentContext();
      if (!spec.can(context)) return;
      spec.run(context);
    },
  };
  commands.set(spec.id, command);
  return command;
}

export function commandById(id: CommandId): Command | undefined {
  return commands.get(id);
}

/*
 * The gestures.
 *
 * In this module rather than beside it: a registry filled by an import has one
 * silent failure mode — a module nobody imports registers nothing, and the
 * command simply goes missing. Phase 9 paid for that lesson and answered it the
 * same way, by putting the entries in the same file as the table.
 *
 * **What is not here**, and deliberately: opening a panel, changing the layout,
 * the prefab entries of the hierarchy's context menu. The first two are not
 * gestures on the document and have no `can()` to state; the prefab entries are
 * decided in exactly one place, and a registry earns its keep by removing a
 * second.
 */

const documentStore = () => useDocumentStore.getState();

export const undoCommand = defineCommand({
  id: 'undo',
  shortcut: 'Z',
  label: () => {
    const entry = documentStore().undoLabel();
    return entry === null ? 'Undo' : `Undo ${entry}`;
  },
  can: () => documentStore().canUndo(),
  run: () => undo(),
});

export const redoCommand = defineCommand({
  id: 'redo',
  shortcut: 'Shift+Z',
  label: () => {
    const entry = documentStore().redoLabel();
    return entry === null ? 'Redo' : `Redo ${entry}`;
  },
  can: () => documentStore().canRedo(),
  run: () => redo(),
});

export const saveCommand = defineCommand({
  id: 'save',
  shortcut: 'S',
  label: () => 'Save Scene',
  /**
   * The menu greyed this out on a clean document and Cmd+S wrote the file
   * anyway. Harmless, and exactly the shape of the divergence this table exists
   * to make impossible.
   */
  can: () => {
    const state = documentStore();
    return !useProjectStore.getState().saving && state.revision !== state.savedRevision;
  },
  run: () => {
    void useProjectStore.getState().save();
  },
});

export const duplicateCommand = defineCommand({
  id: 'duplicate',
  shortcut: 'D',
  label: (ctx) => (ctx.selection.isMultiple ? `Duplicate ${ctx.selection.size} Objects` : 'Duplicate'),
  can: (ctx) => ctx.selection.can('duplicate'),
  run: (ctx) => duplicateSelection(ctx.selection),
});

export const deleteCommand = defineCommand({
  id: 'delete',
  label: (ctx) => (ctx.selection.isMultiple ? `Delete ${ctx.selection.size} Objects` : 'Delete'),
  can: (ctx) => ctx.selection.can('delete'),
  run: (ctx) => deleteSelection(ctx.selection),
});

export const groupCommand = defineCommand({
  id: 'group',
  shortcut: 'G',
  label: () => 'Group Selection',
  can: (ctx) => ctx.selection.can('group'),
  run: (ctx) => {
    groupSelection(ctx.selection);
  },
});

/**
 * Renaming is the one gesture the registry cannot finish: what it does is put a
 * row into edit mode, and only the hierarchy has rows. It is here for its
 * `can()`, which three callers were asking in their own words, and `run` is
 * supplied by whoever owns the row.
 */
export const renameCommand = defineCommand({
  id: 'rename',
  label: () => 'Rename',
  can: (ctx) => !ctx.selection.isMultiple && ctx.selection.can('rename'),
  run: () => {
    const [id] = useEditorStore.getState().selection;
    if (id !== undefined) onRenameRequested?.(id);
  },
});

/**
 * Where a rename actually happens. Set by the hierarchy panel while it is
 * mounted; `undefined` means nothing can show a text field, and the command
 * quietly does nothing rather than pretending.
 */
let onRenameRequested: ((entityId: string) => void) | undefined;

export function setRenameHandler(handler: ((entityId: string) => void) | undefined): void {
  onRenameRequested = handler;
}
