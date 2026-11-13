/*
 * Page functions that read frames, in the editor and in a player alike. Run by
 * `runInPage`: each is whole in itself — see `launch/cdp.ts`.
 */

/** How many frames the page draws in `ms`, counted by `requestAnimationFrame`. */
export function countFrames(ms: number): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    let frames = 0;
    let first = -1;
    const tick = (now: number): void => {
      if (first < 0) first = now;
      else frames += 1;
      if (now - first < ms) requestAnimationFrame(tick);
      else resolve({ frames, ms: now - first, perSecond: (frames * 1000) / (now - first) });
    };
    requestAnimationFrame(tick);
  });
}
