import { useEditorStore } from '../state/editorStore';

/**
 * Entering and leaving play mode.
 *
 * Nothing here touches the dock any more. Bringing the Game panel forward is a
 * *reaction* to the game starting, and it lives in `shell/panelFocus.ts` with
 * the rest of what the arrangement does about state — see there for why it is
 * not merely a nicety.
 */
export function startPlay(): void {
  useEditorStore.getState().play();
}

export function stopPlay(): void {
  useEditorStore.getState().stop();
}

/**
 * One key for both, which is what a transport key is everywhere.
 *
 * No caller yet: T-062f is the tranche that puts these three into the registry,
 * and it was held back until this commit precisely so it would not register a
 * gesture that reached into the dock.
 */
export function togglePlay(): void {
  if (useEditorStore.getState().playState === 'stopped') startPlay();
  else stopPlay();
}
