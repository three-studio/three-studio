import { isRecord } from '@three-studio/core';
import type { RunConditions } from './conditions';
import type { Metric, MetricKind, ScenarioResult } from './results';
import { median } from './stats';

/*
 * A run judged against the last one, and a suspected breach confirmed — or
 * not — against the commit the last one measured.
 *
 * The budget (D23): a timing or a memory may not get worse than the last run
 * by more than 5 % on its median; a count must not move at all. A timing
 * beyond the budget is only *suspected* until an A/B of each tree's own
 * harness confirms it on paired launches, and only a confirmed breach stops a
 * feature: one launch of a busy Mac is enough to move a median by 5 %.
 */

export const BUDGET = 0.05;

/** The format of a run's JSON: what an older tree writes and this one reads, or the reverse. */
export const RESULT_VERSION = 1;

export interface RunResult {
  readonly version: number;
  /** A run, or an A/B's twin. The previous run is never an A/B's. */
  readonly kind: 'run' | 'ab';
  readonly label: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly conditions: RunConditions;
  readonly scenarios: Readonly<Record<string, ScenarioResult>>;
  /**
   * Each metric's noise on identical code, `<scenario> <metric>` to how far
   * its paired medians fell apart in an A/B against the run's own commit. The
   * baseline records it, and the runs after it show it beside their changes.
   */
  readonly noise: Readonly<Record<string, number>>;
}

const KINDS: ReadonlySet<string> = new Set(['count', 'memory', 'timing', 'reported']);

function isKind(value: unknown): value is MetricKind {
  return typeof value === 'string' && KINDS.has(value);
}

function stringOr(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function decodeMetrics(value: unknown): Record<string, Metric> {
  const metrics: Record<string, Metric> = {};
  if (!isRecord(value)) return metrics;
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry) || !isKind(entry['kind']) || !Array.isArray(entry['launches'])) continue;
    const launches = entry['launches'].filter((launch: unknown): launch is number => typeof launch === 'number');
    if (launches.length === 0) continue;
    metrics[name] = { kind: entry['kind'], unit: stringOr(entry, 'unit', ''), launches };
  }
  return metrics;
}

function decodeWindow(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const window: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'number') window[key] = entry;
  return window;
}

function decodeConditions(value: unknown): RunConditions {
  const record = isRecord(value) ? value : {};
  const loads = record['loadAverage'];
  return {
    machine: stringOr(record, 'machine', 'unknown'),
    os: stringOr(record, 'os', 'unknown'),
    node: stringOr(record, 'node', 'unknown'),
    electron: stringOr(record, 'electron', 'unknown'),
    chromium: stringOr(record, 'chromium', 'unknown'),
    chrome: stringOr(record, 'chrome', 'unknown'),
    three: stringOr(record, 'three', 'unknown'),
    commit: stringOr(record, 'commit', 'unknown'),
    trackedChanges: record['trackedChanges'] === true,
    power: stringOr(record, 'power', 'unknown'),
    lowPowerMode: record['lowPowerMode'] === true,
    loadAverage: Array.isArray(loads) ? loads.filter((load: unknown): load is number => typeof load === 'number') : [],
  };
}

/**
 * A run's JSON, read whatever tree wrote it: a metric of a kind this tree does
 * not know is left out, and one this tree has and it lacks is simply absent —
 * the comparison calls it *not comparable*. `null` for what is not a run.
 */
export function decodeRunResult(value: unknown): RunResult | null {
  if (!isRecord(value) || typeof value['version'] !== 'number' || !isRecord(value['scenarios'])) return null;
  const scenarios: Record<string, ScenarioResult> = {};
  for (const [id, entry] of Object.entries(value['scenarios'])) {
    if (!isRecord(entry)) continue;
    const notes = entry['notes'];
    scenarios[id] = {
      metrics: decodeMetrics(entry['metrics']),
      window: decodeWindow(entry['window']),
      notes: Array.isArray(notes) ? notes.filter((note: unknown): note is string => typeof note === 'string') : [],
    };
  }
  return {
    version: value['version'],
    kind: value['kind'] === 'ab' ? 'ab' : 'run',
    noise: decodeWindow(value['noise']) ?? {},
    label: stringOr(value, 'label', ''),
    startedAt: stringOr(value, 'startedAt', ''),
    finishedAt: stringOr(value, 'finishedAt', ''),
    conditions: decodeConditions(value['conditions']),
    scenarios,
  };
}

/** The run a new one is compared with: the newest by its finish, never an A/B's twin. */
export function newestRun(results: readonly RunResult[]): RunResult | null {
  let newest: RunResult | null = null;
  for (const result of results) {
    if (result.kind !== 'run') continue;
    if (newest === null || result.finishedAt > newest.finishedAt) newest = result;
  }
  return newest;
}

/** What makes two runs' timings and memory incomparable: another machine, system, browser or power. */
export function differingConditions(current: RunConditions, previous: RunConditions): string[] {
  const keys = ['machine', 'os', 'electron', 'chromium', 'chrome', 'three', 'power', 'lowPowerMode'] as const;
  return keys.filter((key) => String(current[key]) !== String(previous[key]));
}

export type Verdict = 'ok' | 'suspected' | 'changed' | 'not comparable' | 'reported';

export interface Row {
  readonly scenario: string;
  readonly metric: string;
  readonly kind: MetricKind;
  readonly unit: string;
  /** The median over this run's launches. */
  readonly value: number;
  readonly previous: number | null;
  /** `value / previous - 1`. */
  readonly delta: number | null;
  readonly verdict: Verdict;
  /** The metric's noise on identical code, measured at the baseline. */
  readonly noise: number | null;
}

function verdictOf(kind: MetricKind, value: number, previous: number | null, comparable: boolean): Verdict {
  if (kind === 'reported') return 'reported';
  if (previous === null) return 'not comparable';
  if (kind === 'count') return value === previous ? 'ok' : 'changed';
  if (!comparable) return 'not comparable';
  return value / previous - 1 > BUDGET ? 'suspected' : 'ok';
}

/** Every metric of a run, judged against the previous run's. */
export function compareRuns(current: RunResult, previous: RunResult | null, noise: ReadonlyMap<string, number>): Row[] {
  const conditionsMatch = previous !== null && differingConditions(current.conditions, previous.conditions).length === 0;
  const rows: Row[] = [];
  for (const [scenario, result] of Object.entries(current.scenarios)) {
    const before = previous?.scenarios[scenario];
    const sameWindow = JSON.stringify(result.window) === JSON.stringify(before?.window ?? null);
    for (const [metric, measured] of Object.entries(result.metrics)) {
      const value = median(measured.launches);
      const earlier = before?.metrics[metric];
      const previousValue = earlier === undefined ? null : median(earlier.launches);
      rows.push({
        scenario,
        metric,
        kind: measured.kind,
        unit: measured.unit,
        value,
        previous: previousValue,
        delta: previousValue === null || previousValue === 0 ? null : value / previousValue - 1,
        verdict: verdictOf(measured.kind, value, previousValue, conditionsMatch && sameWindow),
        noise: noise.get(`${scenario} ${metric}`) ?? null,
      });
    }
  }
  return rows;
}

export type AbVerdict = 'confirmed' | 'noise' | 'ok' | 'changed' | 'reported' | 'not comparable';

export interface AbRow {
  readonly scenario: string;
  readonly metric: string;
  readonly kind: MetricKind;
  readonly unit: string;
  /** This tree's median over the pairs. */
  readonly ours: number;
  /** The other tree's. */
  readonly theirs: number | null;
  readonly delta: number | null;
  readonly verdict: AbVerdict;
}

/**
 * Each tree's launches, paired in the order they alternated: a breach that
 * holds on the paired medians is *confirmed*, one that does not was *noise*.
 * A count needs no pairing to be read: equal, or changed.
 */
export function compareAb(
  ours: Readonly<Record<string, ScenarioResult>>,
  theirs: Readonly<Record<string, ScenarioResult>>,
): AbRow[] {
  const rows: AbRow[] = [];
  for (const [scenario, result] of Object.entries(ours)) {
    for (const [metric, measured] of Object.entries(result.metrics)) {
      const other = theirs[scenario]?.metrics[metric];
      const oursMedian = median(measured.launches);
      if (other === undefined) {
        rows.push({ scenario, metric, kind: measured.kind, unit: measured.unit, ours: oursMedian, theirs: null, delta: null, verdict: 'not comparable' });
        continue;
      }
      const theirsMedian = median(other.launches);
      const delta = theirsMedian === 0 ? null : oursMedian / theirsMedian - 1;
      const verdict: AbVerdict =
        measured.kind === 'reported'
          ? 'reported'
          : measured.kind === 'count'
            ? oursMedian === theirsMedian ? 'ok' : 'changed'
            : delta !== null && delta > BUDGET ? 'confirmed' : 'noise';
      rows.push({ scenario, metric, kind: measured.kind, unit: measured.unit, ours: oursMedian, theirs: theirsMedian, delta, verdict });
    }
  }
  return rows;
}

/**
 * Each judged metric's noise, from an A/B of a commit against itself: how far
 * its paired medians fell apart, which is what the budget reads. Not the
 * largest difference within a pair: with six launches a metric, one launch out
 * of line put a dozen timings past half the budget whose medians agreed.
 */
export function noiseOf(rows: readonly AbRow[]): Record<string, number> {
  const noise: Record<string, number> = {};
  for (const row of rows) if (row.kind !== 'reported' && row.delta !== null) noise[`${row.scenario} ${row.metric}`] = Math.abs(row.delta);
  return noise;
}
