import { useEffect } from 'react';
import { commandById, type CommandId } from '../commands/registry';
import { hasModifier, isTypingTarget } from '../platform';
import { useEditorStore, type TransformMode } from '../state/editorStore';
import { topOverlay } from '../state/overlayStore';
import { peekViewport } from '../viewport/viewportHost';

/**
 * Tool keys are matched on `event.code`, i.e. physical position.
 *
 * `code` names keys by their place on a US layout, so on AZERTY these four are
 * the keys labelled A, Z, E, R — the cluster that sits next to WASD. That is
 * what Unity and Blender do, and it keeps the tools under the same fingers on
 * every layout.
 */
const TOOL_KEYS: Record<string, TransformMode> = {
  KeyQ: 'select',
  KeyW: 'translate',
  KeyE: 'rotate',
  KeyR: 'scale',
};

export type CommandAction = CommandId | null;

/**
 * Resolves a modifier shortcut from the character a key produces.
 *
 * Matching on `event.code` here was a bug: `code` names physical positions on
 * a US layout, so on AZERTY the key labelled Z reports as `KeyW` and Cmd+Z did
 * nothing at all. Users press the key they can read.
 */
export function commandShortcut(key: string, shiftKey: boolean): CommandAction {
  switch (key.toLowerCase()) {
    case 'z':
      return shiftKey ? 'redo' : 'undo';
    case 'y':
      return 'redo';
    case 'd':
      return 'duplicate';
    case 'g':
      // Ctrl+G groups, everywhere from Unreal to Figma. Shift+G is what
      // ungroups in Unreal, and is not wired yet.
      return shiftKey ? null : 'group';
    case 's':
      return 'save';
    default:
      return null;
  }
}

/** What the decision below needs, so it can be taken without a `KeyboardEvent`. */
export interface ShortcutContext {
  /** The event landed in a text field, so the user is writing rather than acting. */
  typing: boolean;
  /** Something is open on top of the editor — a dialog, a menu, a picker. */
  covered: boolean;
}

/**
 * Whether an editor shortcut may act on this key press.
 *
 * Two questions, and both have to be asked, because neither answers the other:
 *
 * **Is the user typing?** Renaming an entity in the Inspector happens with
 * nothing open at all, and `Delete` there has to delete a character.
 *
 * **Is something covering the editor?** This is the one that was missing.
 * Focus alone cannot answer it: Tweakpane commits a field and hands focus back
 * to the body, so the very next `Cmd+Z` had no text field under it and undid an
 * edit in the scene behind an open dialog. A button in a dialog was never a
 * text field to begin with. Both were reported, and both are this.
 */
export function shortcutsApply({ typing, covered }: ShortcutContext): boolean {
  return !typing && !covered;
}

/**
 * Global editor shortcuts.
 *
 * Deliberately window-level rather than per-panel: Unity and Blender both let
 * Cmd+Z and the tool keys work wherever the cursor is. Two things opt out — a
 * text field, so typing in a rename box does not switch tools or delete the
 * selection, and anything covering the editor, so a dialog's own keys are its
 * own. See `shortcutsApply`.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const top = topOverlay();

      // Escape belongs to whatever is on top, and to it alone. Every surface
      // used to capture it on `document` for itself, so two open at once both
      // closed — and the editor cleared the selection behind them as well.
      if (event.key === 'Escape' && top !== null) {
        event.preventDefault();
        top.close();
        return;
      }

      if (!shortcutsApply({ typing: isTypingTarget(event.target), covered: top !== null })) {
        return;
      }
      const store = useEditorStore.getState();

      if (hasModifier(event)) {
        const action = commandShortcut(event.key, event.shiftKey);
        if (action === null) return;
        event.preventDefault();

        // Resolved, not decided. Every guard this used to hold — and the two it
        // was missing, `undo` and `save` — is the command's own `can()`, which
        // the menu asks in the same words.
        commandById(action)?.run();
        return;
      }

      const tool = TOOL_KEYS[event.code];
      if (tool !== undefined) {
        // W/A/S/D belong to the fly camera while the right button is held;
        // switching tools mid-flight would be maddening.
        if (!event.repeat && peekViewport()?.controls.isNavigating !== true) {
          store.setTransformMode(tool);
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const remove = commandById('delete');
        // The key is only swallowed when something will happen: a preventDefault
        // on a refusal makes Backspace feel broken everywhere else.
        if (remove?.can()) {
          event.preventDefault();
          remove.run();
        }
        return;
      }

      if (event.key === 'Escape') store.clearSelection();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
