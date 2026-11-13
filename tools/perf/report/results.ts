import { isRecord } from '@three-studio/core';
import { median } from './stats';

/*
 * What a scenario answers: every metric by name, with its kind and its value
 * in each launch. The kind decides how a later run judges it (D23): a count
 * must stay identical, a memory or a timing within +5 % on its median, and a
 * reported value is shown and not judged.
 */

export type MetricKind = 'count' | 'memory' | 'timing' | 'reported';

export interface MetricSpec {
  readonly kind: MetricKind;
  readonly unit: string;
}

export interface Metric extends MetricSpec {
  readonly launches: readonly number[];
}

export interface ScenarioResult {
  readonly metrics: Readonly<Record<string, Metric>>;
  /**
   * What a frame time depends on besides the code: the window and its
   * canvases, as the first measured launch had them. A timing compared across
   * two windows compares two amounts of work.
   */
  readonly window: Readonly<Record<string, number>> | null;
  /** Lines for the report: the heaviest allocation sites, the captures written. */
  readonly notes: readonly string[];
}

/**
 * The launches' readings, gathered metric by metric. Every launch must carry
 * every metric the table declares, and nothing else: a missing one is a launch
 * that did not finish, and an undeclared one a typo that would otherwise be a
 * metric of its own in every report after it.
 */
export function metricsOf(
  table: ReadonlyMap<string, MetricSpec>,
  launches: readonly Readonly<Record<string, number>>[],
): Record<string, Metric> {
  const metrics: Record<string, Metric> = {};
  for (const [name, spec] of table) {
    metrics[name] = {
      ...spec,
      launches: launches.map((launch, index) => {
        const value = launch[name];
        if (value === undefined) throw new Error(`launch ${index + 1} has no ${name}`);
        return value;
      }),
    };
  }
  for (const launch of launches) {
    const unknown = Object.keys(launch).filter((name) => !table.has(name));
    if (unknown.length > 0) throw new Error(`readings no metric declares: ${unknown.join(', ')}`);
  }
  return metrics;
}

/**
 * JS memory from a `Runtime.getHeapUsage` reply: the V8 heap and the
 * ArrayBuffers behind it, which `usedSize` leaves out. three keeps a model's
 * attribute arrays in ArrayBuffers after the upload, so a big model's memory
 * is there and nowhere else.
 */
export function heapOf(reply: unknown): { heapBytes: number; heapUsedBytes: number; heapBackingBytes: number } {
  if (!isRecord(reply)) throw new Error('a heap usage reply that is not an object');
  const { usedSize, backingStorageSize } = reply;
  if (typeof usedSize !== 'number' || typeof backingStorageSize !== 'number') {
    throw new Error('a heap usage reply without usedSize and backingStorageSize');
  }
  return { heapBytes: usedSize + backingStorageSize, heapUsedBytes: usedSize, heapBackingBytes: backingStorageSize };
}

/** A scenario's metrics as lines to print while the run goes: each one's median over the launches. */
export function summaryOf(id: string, result: ScenarioResult): string {
  const lines = Object.entries(result.metrics).map(([name, metric]) => {
    const value = median(metric.launches);
    const shown = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return `[perf] ${id} ${name} ${shown}${metric.unit === '' ? '' : ` ${metric.unit}`} (${metric.kind})`;
  });
  return `${[...lines, ...result.notes.map((note) => `[perf] ${id} ${note}`)].join('\n')}\n`;
}
