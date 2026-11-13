/*
 * Page functions for an exported build in Chrome. `listenForPlayer` is the
 * init script, in place before the build's first byte; the others are run by
 * `runInPage`. Each is whole in itself — see `launch/cdp.ts`.
 */

/**
 * Hears the player announce itself, presses its Play, and stamps the first
 * frame after.
 *
 * The game draws from the start, behind the Play overlay, and `start` only
 * hides it: what is stamped is the first frame a person would see the game in.
 */
export function listenForPlayer(): void {
  window.addEventListener('three-studio:player', (event) => {
    const detail = event.detail;
    if (detail.state === 'failed') {
      window.__perfPlayer = detail;
      return;
    }
    detail.start();
    const player = {
      state: detail.state,
      renderer: detail.renderer,
      host: detail.host,
      startedAt: performance.now(),
      firstFrameAt: null,
    };
    window.__perfPlayer = player;
    // Read in the callback, not taken from its argument: the argument is when
    // the frame began, and a frame whose callbacks a long task held up began
    // before `start` was called — stamped that way, the first frame came before
    // the press.
    requestAnimationFrame(() => {
      if (window.__perfPlayer?.state === 'running') window.__perfPlayer.firstFrameAt = performance.now();
    });
  });
}

/** Where the player is: 1 or 0 for each state, and its times once it has them. */
export function playerState(): Record<string, number> {
  const player = window.__perfPlayer;
  const overlay = document.querySelector('#overlay');
  const state: Record<string, number> = {
    running: player?.state === 'running' ? 1 : 0,
    failed: player?.state === 'failed' ? 1 : 0,
    overlayHidden: overlay instanceof HTMLElement && overlay.hidden ? 1 : 0,
  };
  if (player?.state === 'running') {
    state['startedAt'] = player.startedAt;
    if (player.firstFrameAt !== null) state['firstFrameAt'] = player.firstFrameAt;
  }
  return state;
}
