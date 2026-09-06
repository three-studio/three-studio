import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';

/*
 * What a command is, and nothing about which commands exist.
 *
 * Split from `registry.ts` so a family of gestures can be declared in its own
 * module without importing the table that will hold it. The table imports the
 * families; the families import this. That is the shape `core`'s component
 * registry already has, and it is the shape that has no cycle in it — three of
 * those have been paid for on this refactor.
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
  /**
   * The asset a gesture was aimed at, when it was aimed at one.
   *
   * An **id**, not the `AssetEntry` the caller is holding. The context is read
   * at the moment it is needed and never kept, and an entry copied into it would
   * be a copy that can go stale — the manifest is rebuilt after every mutation,
   * and another window can delete the file. The command looks the id up when it
   * runs, which is also what lets `can()` answer "that asset is gone" rather
   * than acting on a row that is no longer there.
   *
   * Absent for every gesture that acts on the selection, which is most of them.
   */
  readonly assetId?: string;
  /**
   * The scene a gesture was aimed at — the Scene menu lists one entry per scene,
   * and each is the same gesture pointed somewhere else.
   *
   * An id for the same reason `assetId` is one, and because the project says so
   * everywhere else: a scene is referred to by the id inside its own document,
   * never by its path or its name.
   */
  readonly sceneId?: string;
}

export function currentContext(): EditorContext {
  return { selection: Selection.current() };
}

/** The context for a specific set of ids — a right-click outside the selection. */
export function contextFor(ids: readonly string[]): EditorContext {
  return { selection: Selection.of(ids, expandedScene().scene) };
}

/** The context for a gesture aimed at one asset — a tile, a row, an Inspector slot. */
export function contextForAsset(assetId: string): EditorContext {
  return { ...currentContext(), assetId };
}

/** The context for a gesture aimed at one scene — a row of the Scene menu. */
export function contextForScene(sceneId: string): EditorContext {
  return { ...currentContext(), sceneId };
}

export interface Command {
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
  label: (ctx: EditorContext) => string;
  readonly shortcut?: string;
  can: (ctx: EditorContext) => boolean;
  /**
   * May be asynchronous, and most of the gestures still to arrive are: creating
   * a scene asks for a name, deleting one asks for a confirmation, and both then
   * cross to the main process.
   *
   * Nothing awaits it. A command is something a person asked for, and there is
   * no caller in a position to do anything useful with the outcome — so a
   * gesture that can fail **reports its own failure**, the way `sceneFiles`
   * does with `report(cause)`. A rejected promise reaching here would be an
   * unhandled rejection, which is the sign of a gesture that forgot to.
   */
  run: (ctx: EditorContext) => void | Promise<void>;
}

/**
 * Declares a gesture.
 *
 * **No `id`.** The key it is filed under in the table is its id, written once —
 * declaring it here as well would be the same string in two places, and two
 * places is where the list this whole refactor removes comes back from.
 *
 * `can` is required rather than optional. An optional guard is a guard somebody
 * forgets, which is the same argument ADR-4 makes for the selection carried by a
 * history entry — and forgetting it here is exactly how the menu and the
 * shortcut came to disagree.
 */
export function defineCommand(spec: CommandSpec): Command {
  return {
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
      void spec.run(context);
    },
  };
}
