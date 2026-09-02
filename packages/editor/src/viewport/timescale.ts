import type { PlayState } from '../state/editorStore';

/*
 * When the clock runs, and how fast.
 *
 * Pure, and its own file, for the reason `markerStyles` and `capabilities` are:
 * "should this frame move" is a question about two booleans, and answering it
 * here rather than inside `tick` is what lets a test ask it without a renderer.
 *
 * The policy lives in the editor and not beside `StudioTime`, because it *is*
 * an editor policy. The runtime owns a clock; what a transport button means is
 * not its business, and the exported player has no transport at all.
 */

/**
 * The timescale for a frame.
 *
 * @param playState What the transport says.
 * @param viewportAnimated The viewport's own toggle, which only has a say while
 *   nothing is running. This is Unreal's **Realtime** (`Ctrl+R`) and Unity's
 *   **Effects ▸ Always Refresh**: both editors animate materials in the edit
 *   view, and both make it a switch you can see, because a surface that moves
 *   while nothing is playing reads as a game that is already running. Ours is
 *   off by default, which is the behaviour this project already had.
 *
 * `'paused'` is zero rather than "leave it alone" on purpose: pausing has to
 * stop the water and the clouds as well as the physics, and one clock is what
 * makes that a single number instead of a flag per shader.
 */
export function timescaleFor(playState: PlayState, viewportAnimated: boolean): number {
  if (playState === 'paused') return 0;
  if (playState === 'playing') return 1;
  return viewportAnimated ? 1 : 0;
}
