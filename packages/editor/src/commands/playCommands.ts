import { showPanel } from '../shell/dockApi';
import { useEditorStore } from '../state/editorStore';

/**
 * Entering and leaving play mode.
 *
 * The tab switch belongs here rather than in the store: the Scene and Game
 * panels share one canvas, so starting the game without bringing the Game tab
 * forward leaves the player staring at an idle Scene view — or, if that tab had
 * been closed, at no view of the game at all.
 */
export function startPlay(): void {
  showPanel('game');
  useEditorStore.getState().play();
}

export function stopPlay(): void {
  useEditorStore.getState().stop();
  showPanel('viewport');
}

export function togglePlay(): void {
  if (useEditorStore.getState().playState === 'stopped') startPlay();
  else stopPlay();
}
