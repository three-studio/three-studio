/*
 * The statistics a run is judged on. Medians, because a frame time or a load
 * has a long tail on one side — a GC, a compile, another app waking up — and a
 * mean would move with every one of them. p95 and max are reported beside.
 */

function sorted(values: readonly number[], what: string): number[] {
  if (values.length === 0) throw new Error(`${what} of nothing`);
  return [...values].sort((a, b) => a - b);
}

function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`no value at ${index} of ${values.length}`);
  return value;
}

/** The middle value, or the mean of the two middle ones for an even count. */
export function median(values: readonly number[]): number {
  const ordered = sorted(values, 'median()');
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? at(ordered, middle) : (at(ordered, middle - 1) + at(ordered, middle)) / 2;
}

/** Nearest rank: the smallest value at or above `p` percent of them. */
export function percentile(values: readonly number[], p: number): number {
  const ordered = sorted(values, 'percentile()');
  return at(ordered, Math.max(1, Math.ceil((p / 100) * ordered.length)) - 1);
}

export interface FrameStats {
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export function frameStats(deltas: readonly number[]): FrameStats {
  return { median: median(deltas), p95: percentile(deltas, 95), max: Math.max(...deltas) };
}

/**
 * The longest animation frame that started inside `span`, from `[start,
 * duration]` pairs as a page reads them out of its buffer: the longest
 * main-thread task a person waited through, between two moments.
 */
export function longestInside(
  pairs: readonly number[],
  span: { readonly from: number; readonly to: number },
): { longestMs: number; inside: number } {
  if (pairs.length % 2 !== 0) throw new Error('animation frames come as [start, duration] pairs');
  let longestMs = 0;
  let inside = 0;
  for (let at = 0; at < pairs.length; at += 2) {
    const start = pairs[at];
    const duration = pairs[at + 1];
    if (start === undefined || duration === undefined || start < span.from || start > span.to) continue;
    inside += 1;
    longestMs = Math.max(longestMs, duration);
  }
  return { longestMs, inside };
}
