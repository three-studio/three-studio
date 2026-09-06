import { useEditorStore } from '../state/editorStore';
import { defineCommand } from './command';

/*
 * Entering and leaving play mode.
 *
 * Nothing here touches the dock. Bringing the Game panel forward is a *reaction*
 * to the game starting, and it lives in `shell/panelFocus.ts` — T-066.
 *
 * **Two commands, not three.** The card for this tranche said `startPlay`,
 * `stopPlay` and `togglePlay`, written from the file's exports rather than from
 * its callers. `togglePlay` had none, and once `play` and `stop` each carry a
 * `can()` there is nothing left for it to do: the toolbar's single button asks
 * which of the two applies — it has to, since it also picks the icon — and a
 * palette shows whichever one can act. A transport *key* would want a toggle,
 * and nothing binds one; that is three lines on the day something does.
 */

function startPlay(): void {
  useEditorStore.getState().play();
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

  /** Paused counts as running: it is Stop that gets you out of either. */
  stop: defineCommand({
    label: () => 'Stop',
    can: () => useEditorStore.getState().playState !== 'stopped',
    run: () => stopPlay(),
  }),
};
