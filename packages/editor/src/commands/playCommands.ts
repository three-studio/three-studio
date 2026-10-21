import { useEditorStore } from '../state/editorStore';
import { defineCommand } from './command';

/*
 * Entering and leaving play mode.
 *
 * Nothing here touches the dock. Bringing the Game panel forward is a *reaction*
 * to the game starting, and it lives in `shell/panelFocus.ts` — T-066.
 *
 * **No toggle.** The card for this tranche said `startPlay`, `stopPlay` and
 * `togglePlay`, written from the file's exports rather than from its callers.
 * `togglePlay` had none, and once `play` and `stop` each carry a `can()` there
 * is nothing left for it to do: the toolbar's first button asks which of the
 * two applies — it has to, since it also picks the icon — and a palette shows
 * whichever one can act. The one transport key, Shift+Esc, only stops, so it
 * names `stop` rather than wanting a toggle.
 *
 * Play Full Screen is a second way in, not a mode of the first: the same game,
 * with the Game panel holding the whole screen until the session ends.
 */

function startPlay(fullScreen = false): void {
  useEditorStore.getState().play({ fullScreen });
}

function stopPlay(): void {
  useEditorStore.getState().stop();
}

export const PLAY_COMMANDS = {
  play: defineCommand({
    label: () => 'Play',
    can: () => useEditorStore.getState().playState === 'stopped',
    run: () => startPlay(),
  }),

  /**
   * The Game panel takes the whole screen, and leaving it ends the session —
   * Unreal's way, on Shift+Esc rather than its Esc, so the game keeps Esc for
   * its own menus. See `GamePanel`.
   */
  playFullScreen: defineCommand({
    label: () => 'Play Full Screen',
    can: () => useEditorStore.getState().playState === 'stopped',
    run: () => startPlay(true),
  }),

  /** Paused counts as running: it is Stop that gets you out of either. */
  stop: defineCommand({
    label: () => 'Stop',
    can: () => useEditorStore.getState().playState !== 'stopped',
    run: () => stopPlay(),
  }),
};
