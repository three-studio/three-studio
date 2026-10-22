import { useEffect } from 'react';
import { commandById, type CommandId } from '../commands/registry';
import { bindingOf, commandForBinding, isFunctionKey } from './shortcutBindings';
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
export const TOOL_KEYS: Readonly<Record<string, TransformMode>> = {
  KeyQ: 'select',
  KeyW: 'translate',
  KeyE: 'rotate',
  KeyR: 'scale',
};

/**
 * The handle space's key, matched by position like the tool keys. Exported with
 * them, so the toolbar names the keys this handler listens to rather than a
 * second list of letters.
 */
export const SPACE_KEY = 'KeyX';

/** What the decision below needs, so it can be taken without a `KeyboardEvent`. */
export interface ShortcutContext {
  /** The event landed in a text field, so the user is writing rather than acting. */
  typing: boolean;
  /** Something is open on top of the editor — a dialog, a menu, a picker. */
  covered: boolean;
  /** The event landed on the game's canvas: the game has the keyboard. */
  gameHasKeys: boolean;
}

/**
 * The commands whose keys the editor keeps while the game has the keyboard:
 * they drive the game, not the scene, and a game that heard them would stop,
 * pause or step itself in the editor and in no build. By command rather than
 * by key, so that a Stop rebound to another key is kept on that key.
 */
export const KEPT_FROM_THE_GAME: ReadonlySet<CommandId> = new Set<CommandId>(['stop', 'togglePause', 'stepFrame']);

/**
 * Whether an editor shortcut may act on this key press. `command` is what its
 * binding runs, `null` for a tool key, X or Esc.
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
 *
 * Unless the game has the keyboard, and then neither is asked: a key typed into
 * the game is the game's — no tool key, no X, no Esc emptying the selection,
 * no Delete answered by the scene lock's toast — but for the few the editor
 * keeps from it.
 */
export function shortcutsApply({ typing, covered, gameHasKeys }: ShortcutContext, command: CommandId | null): boolean {
  if (gameHasKeys) return command !== null && KEPT_FROM_THE_GAME.has(command);
  return !typing && !covered;
}

/** Whether a key was typed into the running game: it landed on the game's canvas. */
function landedInGame(event: KeyboardEvent): boolean {
  const game = peekViewport()?.gameView.canvas;
  return game !== undefined && event.target === game;
}

/**
 * Runs what a key's binding names. A toggle runs once a press, whatever the
 * key's repeats: F9 held would otherwise pause and resume at the repeat rate,
 * landing wherever the key happened to be let go. Step, held, steps at that
 * rate, which is what holding it is for.
 */
function runBound(id: CommandId, event: KeyboardEvent): void {
  if (event.repeat && id === 'togglePause') return;
  commandById(id).run();
}

/**
 * Global editor shortcuts.
 *
 * Deliberately window-level rather than per-panel: Unity and Blender both let
 * Cmd+Z and the tool keys work wherever the cursor is. Two things opt out — a
 * text field, so typing in a rename box does not switch tools or delete the
 * selection, and anything covering the editor, so a dialog's own keys are its
 * own. See `shortcutsApply`.
 *
 * And the game's canvas, whose keys are the game's but for Stop, Pause and
 * Step. Two listeners, one decision: the game's `Input` listens on its canvas,
 * so it hears a key at its target, before anything on `window` sees it bubble.
 * A listener on `window` in the capture phase runs before it, and takes the
 * keys the editor keeps — cancelled, and stopped there, so the game never hears
 * them. Every other key typed into the game goes on to the game, and the
 * listener of the bubble phase leaves it alone.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDownBeforeTheGame(event: KeyboardEvent) {
      if (!landedInGame(event)) return;
      const binding = bindingOf(event);
      const action = binding === null ? null : commandForBinding(binding);
      const context = { typing: isTypingTarget(event.target), covered: topOverlay() !== null, gameHasKeys: true };
      if (action === null || !shortcutsApply(context, action)) return;
      // Cancelled even when the command refuses — Step while the game plays:
      // the key is the editor's for as long as a game runs. Stopped at
      // `window`, the key still reaches the other listeners there, the
      // tooltips' among them; only the page below never sees it.
      event.preventDefault();
      event.stopPropagation();
      runBound(action, event);
    }

    function onKeyDown(event: KeyboardEvent) {
      // Typed into the game: the game's, but for what the capture listener
      // above has already taken.
      if (landedInGame(event)) return;
      const top = topOverlay();

      // Escape belongs to whatever is on top, and to it alone. Every surface
      // used to capture it on `document` for itself, so two open at once both
      // closed — and the editor cleared the selection behind them as well.
      if (event.key === 'Escape' && top !== null) {
        event.preventDefault();
        top.close();
        return;
      }

      const binding = bindingOf(event);
      const action = binding === null ? null : commandForBinding(binding);
      // A bound function key is the editor's whether or not its command acts,
      // in a text field or behind a dialog too. On Windows a key the page leaves
      // alone goes on to the window, and F10 there opens the window's menu bar,
      // which Electron keeps hidden: the editor would seem to stop answering
      // until something else was pressed.
      if (binding !== null && action !== null && isFunctionKey(binding)) event.preventDefault();

      if (!shortcutsApply({ typing: isTypingTarget(event.target), covered: top !== null, gameHasKeys: false }, action)) {
        return;
      }
      const store = useEditorStore.getState();

      if (action !== null) {
        const command = commandById(action);
        // A modifier binding is the editor's whether or not the command will
        // act — Cmd+S must not open the browser's save dialog on a clean
        // document. A bare one is only swallowed when something will happen: a
        // preventDefault on a refusal makes Backspace feel broken everywhere
        // else. A command that waits for Stop counts as something happening:
        // its refusal is answered, in the toast `run` raises, so the key was
        // the editor's.
        if (hasModifier(event) || command.can() || command.waitsForStop()) event.preventDefault();

        // Resolved, not decided. Every guard this used to hold — and the two it
        // was missing, `undo` and `save` — is the command's own `can()`, which
        // the menu asks in the same words.
        runBound(action, event);
        return;
      }
      // A modifier chord this table does not name belongs to the browser, not
      // to the tool keys below: Cmd+R is a reload, not the Rotate tool.
      if (hasModifier(event)) return;

      const tool = TOOL_KEYS[event.code];
      if (tool !== undefined) {
        // W/A/S/D belong to the fly camera while the right button is held;
        // switching tools mid-flight would be maddening.
        if (!event.repeat && peekViewport()?.controls.isNavigating !== true) {
          store.setTransformMode(tool);
        }
        return;
      }

      /*
       * The handle space, on Unity's key and matched the same way the tool keys
       * are — by position, so it stays under the same finger on AZERTY. It is
       * not in `DEFAULT_BINDINGS` for the reason given there: it names no
       * target, so it is not a command, and neither are Q/W/E/R.
       *
       * It steps rather than toggles, because there are three now — the order
       * is `TRANSFORM_SPACES`, which the toolbar menu lists in the same order
       * from the same array.
       *
       * Silent in Scale, where the toolbar button is greyed: three forces
       * local space for scale, so a Global the gizmo would ignore is not a
       * state to let someone into. Flipping it invisibly here would surface
       * two tools later, which is worse than a key that does nothing.
       */
      if (event.code === SPACE_KEY) {
        if (!event.repeat && store.transformMode !== 'scale') store.cycleTransformSpace();
        return;
      }

      if (event.key === 'Escape') store.clearSelection();
    }

    window.addEventListener('keydown', onKeyDownBeforeTheGame, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDownBeforeTheGame, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
