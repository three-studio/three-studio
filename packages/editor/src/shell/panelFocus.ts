import { useAssetStore } from '../state/assetStore';
import { useEditorStore } from '../state/editorStore';
import { showPanel } from './dockApi';

/*
 * Which panel a change of state brings forward.
 *
 * `commands/` used to do this itself: `startPlay` called `showPanel('game')` and
 * `revealAsset` called `showPanel('project')`, so the command layer imported the
 * shell and reached into the dock. **Starting the game and showing a panel are
 * two things** — the second is a reaction to the first, and a reaction belongs
 * on the side that owns the arrangement.
 *
 * It is the same shape as `editorStore.renaming` and `paletteOpen`: a command
 * writes state, a view reads it. The difference is that a panel cannot bring
 * *itself* forward — a closed one is not mounted to read anything — so the
 * reading happens once, here, for the whole shell.
 */

/** The state this decision is made from, gathered from wherever it lives. */
export interface FocusInputs {
  /** Anything but stopped: paused still shows the game. */
  playing: boolean;
  /** The asset `assetStore.reveal` last pointed at, or `null`. */
  revealed: string | null;
}

/**
 * The panel to bring forward for this change, or `null` to leave the dock alone.
 *
 * A **transition**, never a state, and that is what makes it safe to run on
 * every store change: bringing Scene forward because nothing is playing would
 * yank the tab back every time the selection moved, and would do it once at
 * startup over whichever tab the author had left in front.
 *
 * Play wins over a reveal in the same change, which cannot happen today and
 * costs nothing to settle: what the author asked for last is the game.
 */
export function panelForChange(before: FocusInputs, after: FocusInputs): string | null {
  /*
   * The Scene and Game panels share one drawing surface, so starting the game
   * without bringing the Game tab forward leaves the player looking at an idle
   * Scene view — or, if that tab had been closed, at no view of the game at all.
   * `showPanel` reopens a closed one, which is the other half of why this is not
   * merely a nicety.
   */
  if (after.playing !== before.playing) return after.playing ? 'game' : 'viewport';

  /*
   * Revealing an asset is a request to look at it, and looking at it is not
   * possible with the Project panel behind another tab. Only a *new* reveal
   * counts: the panel clears `revealed` once it has drawn the highlight, and
   * that is not a request for anything.
   */
  if (after.revealed !== null && after.revealed !== before.revealed) return 'project';

  return null;
}

function inputs(): FocusInputs {
  return {
    playing: useEditorStore.getState().playState !== 'stopped',
    revealed: useAssetStore.getState().revealed,
  };
}

/**
 * Watches for those changes while the dock is mounted.
 *
 * Two subscriptions rather than a selector each, because the decision reads both
 * stores and has to see them together. Every store change recomputes two
 * booleans and compares three fields, which is nothing beside what a store
 * change already costs in React.
 */
export function watchPanelFocus(): () => void {
  let previous = inputs();

  const react = (): void => {
    const next = inputs();
    const panel = panelForChange(previous, next);
    previous = next;
    if (panel !== null) showPanel(panel);
  };

  const stops = [useEditorStore.subscribe(react), useAssetStore.subscribe(react)];
  return () => {
    for (const stop of stops) stop();
  };
}
