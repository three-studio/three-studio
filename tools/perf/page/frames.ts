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

/**
 * The time between frames, `frames` of them, after `warmup` frames thrown
 * away: the first frames after a change pay for compiles and uploads, and are
 * not what the scene costs.
 *
 * Read with `performance.now()` inside the callback, as September's readings
 * were: the callback's argument is when the frame began, and that moves with
 * whatever held the frame's callbacks up.
 */
export function frameDeltas(args: { warmup: number; frames: number }): Promise<number[]> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let last = -1;
    let seen = 0;
    const tick = (): void => {
      const now = performance.now();
      if (last >= 0 && seen > args.warmup) deltas.push(now - last);
      last = now;
      seen += 1;
      if (deltas.length < args.frames) requestAnimationFrame(tick);
      else resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}

/** Resolves after `count` frames, with how long they took. */
export function waitFrames(count: number): Promise<number> {
  return new Promise((resolve) => {
    const started = performance.now();
    let left = count;
    const tick = (): void => {
      left -= 1;
      if (left > 0) requestAnimationFrame(tick);
      else resolve(performance.now() - started);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Every long animation frame the page has buffered, as `[start, duration]`
 * pairs, flat. Read after the fact: the buffer keeps what happened before
 * anyone observed it, which is the only way to see the frames of a start.
 */
export function animationFrames(): Promise<number[]> {
  return new Promise((resolve) => {
    const entries: PerformanceEntry[] = [];
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type: 'long-animation-frame', buffered: true });
    setTimeout(() => {
      entries.push(...observer.takeRecords());
      observer.disconnect();
      resolve(entries.flatMap((entry) => [entry.startTime, entry.duration]));
    }, 200);
  });
}
