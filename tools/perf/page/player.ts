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
      game: detail.game,
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

/** Resolves once the first frame after Play has been drawn: when, since navigation, in ms. */
export function playerShown(): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = (): void => {
      const player = window.__perfPlayer;
      if (player?.state === 'failed') reject(new Error(`the player failed: ${player.error}`));
      else if (player?.state === 'running' && player.firstFrameAt !== null) {
        resolve({ firstFrameAt: player.firstFrameAt, startedAt: player.startedAt });
      } else if (performance.now() - started > 120_000) reject(new Error('the player never showed a frame'));
      else setTimeout(check, 20);
    };
    check();
  });
}

/**
 * Resolves once the game draws a steady frame: draw calls above zero and the
 * same for `frames` frames running.
 */
export function settlePlayer(frames: number): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const player = window.__perfPlayer;
    if (player?.state !== 'running') {
      reject(new Error('the player is not running'));
      return;
    }
    const started = performance.now();
    let last = -1;
    let steady = 0;
    const tick = (): void => {
      const calls = player.renderer.info.render.drawCalls;
      steady = calls > 0 && calls === last ? steady + 1 : 0;
      last = calls;
      if (steady >= frames) resolve({ drawCalls: calls, settledMs: performance.now() - started });
      else if (performance.now() - started > 60_000) reject(new Error(`the game's draw calls never settled (last ${calls})`));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** What the game drew in its last frame, and what its renderer holds. */
export function playerCounts(): Record<string, number> {
  const player = window.__perfPlayer;
  if (player?.state !== 'running') throw new Error('the player is not running');
  const { render, memory } = player.renderer.info;
  return { drawCalls: render.drawCalls, gpuBytes: memory.total };
}

/** The page's size, which a frame's work depends on. */
export function pageSize(): Record<string, number> {
  return { innerWidth, innerHeight, devicePixelRatio };
}
