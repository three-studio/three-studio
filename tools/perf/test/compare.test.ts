import { describe, expect, it } from 'vitest';
import {
  compareAb,
  compareRuns,
  decodeRunResult,
  newestRun,
  type RunResult,
} from '../report/compare';
import type { RunConditions } from '../report/conditions';
import type { Metric, ScenarioResult } from '../report/results';
import { runMarkdown } from '../report/write';

const CONDITIONS: RunConditions = {
  machine: 'Apple M1 Pro, 16 GB',
  os: 'macOS 26.3.1 (25D2128)',
  node: 'v24.8.0',
  electron: '43.2.0',
  chromium: '150.0.7871.129',
  chrome: '156.0.8078.80',
  three: '0.185.1',
  commit: 'abc1234',
  trackedChanges: false,
  power: 'AC Power',
  lowPowerMode: false,
  loadAverage: [2, 2, 2],
};

const metric = (kind: Metric['kind'], launches: number[], unit = 'ms'): Metric => ({ kind, unit, launches });

function run(
  metrics: Record<string, Metric>,
  options: { finishedAt?: string; kind?: 'run' | 'ab'; window?: Record<string, number> } = {},
): RunResult {
  const scenario: ScenarioResult = { metrics, window: options.window ?? { innerWidth: 1512 }, notes: [] };
  return {
    version: 1,
    kind: options.kind ?? 'run',
    label: 'test',
    startedAt: '2026-11-09T10:00:00.000Z',
    finishedAt: options.finishedAt ?? '2026-11-09T10:30:00.000Z',
    conditions: CONDITIONS,
    scenarios: { S3: scenario },
    noise: {},
  };
}

const verdicts = (current: RunResult, previous: RunResult): Record<string, string> =>
  Object.fromEntries(compareRuns(current, previous, new Map()).map((row) => [row.metric, row.verdict]));

describe('a run judged against the last one', () => {
  it('calls a count that moved changed', () => {
    expect(verdicts(run({ draws: metric('count', [9010], '') }), run({ draws: metric('count', [9006], '') }))).toEqual({
      draws: 'changed',
    });
  });

  it('lets a timing 4 % worse pass and suspects one 6 % worse', () => {
    const previous = run({ a: metric('timing', [100]), b: metric('timing', [100]) });
    expect(verdicts(run({ a: metric('timing', [104]), b: metric('timing', [106]) }), previous)).toEqual({
      a: 'ok',
      b: 'suspected',
    });
  });

  it('lets a memory that went down pass', () => {
    expect(verdicts(run({ heap: metric('memory', [90], 'B') }), run({ heap: metric('memory', [100], 'B') }))).toEqual({
      heap: 'ok',
    });
  });

  it('cannot compare timings taken in another window', () => {
    const previous = run({ frame: metric('timing', [8]) }, { window: { innerWidth: 1512 } });
    expect(verdicts(run({ frame: metric('timing', [9]) }, { window: { innerWidth: 1920 } }), previous)).toEqual({
      frame: 'not comparable',
    });
  });

  it('judges medians, not means', () => {
    const rows = compareRuns(run({ t: metric('timing', [100, 300, 101]) }), run({ t: metric('timing', [100, 99, 100]) }), new Map());
    expect(rows[0]?.verdict).toBe('ok');
  });
});

describe('the previous run', () => {
  it('is the newest by its finish, and never an A/B’s twin', () => {
    const older = run({}, { finishedAt: '2026-11-08T09:00:00.000Z' });
    const newer = run({}, { finishedAt: '2026-11-09T09:00:00.000Z' });
    const ab = run({}, { finishedAt: '2026-11-10T09:00:00.000Z', kind: 'ab' });
    expect(newestRun([older, ab, newer])).toBe(newer);
    expect(newestRun([ab])).toBeNull();
  });
});

describe('a result an older tree wrote', () => {
  it('is read without failing, a metric of an unknown kind left out', () => {
    const decoded = decodeRunResult({
      version: 1,
      kind: 'run',
      label: 'old',
      startedAt: 'x',
      finishedAt: 'y',
      conditions: CONDITIONS,
      scenarios: {
        S3: {
          metrics: {
            'edit.frameMs': { kind: 'timing', unit: 'ms', launches: [8, 8.2, 8.1] },
            'edit.something': { kind: 'histogram', unit: '', launches: [1] },
          },
          window: null,
          notes: [],
        },
      },
    });
    expect(Object.keys(decoded?.scenarios['S3']?.metrics ?? {})).toEqual(['edit.frameMs']);
  });

  it('calls a metric it lacks not comparable', () => {
    const older = run({ 'edit.frameMs': metric('timing', [8]) });
    const rows = compareRuns(run({ 'edit.frameMs': metric('timing', [8]), 'edit.newOne': metric('timing', [3]) }), older, new Map());
    expect(Object.fromEntries(rows.map((row) => [row.metric, row.verdict]))).toEqual({
      'edit.frameMs': 'ok',
      'edit.newOne': 'not comparable',
    });
  });

  it('is refused when it is not a run at all', () => {
    expect(decodeRunResult({ hello: 'world' })).toBeNull();
  });
});

describe('an A/B', () => {
  const pair = (ours: number[], theirs: number[]) =>
    compareAb(
      { S3: { metrics: { t: metric('timing', ours) }, window: null, notes: [] } },
      { S3: { metrics: { t: metric('timing', theirs) }, window: null, notes: [] } },
    )[0];

  it('confirms a breach that holds on the paired medians', () => {
    expect(pair([106, 106, 106], [100, 100, 100])?.verdict).toBe('confirmed');
  });

  it('calls one within the budget noise', () => {
    expect(pair([103, 103, 103], [100, 100, 100])?.verdict).toBe('noise');
  });

  it('measures the noise as the largest difference within a pair, against this tree’s median', () => {
    expect(pair([100, 104, 100], [101, 100, 99])?.noise).toBeCloseTo(0.04);
  });
});

describe('the Markdown', () => {
  it('has a row for every metric', () => {
    const current = run({ a: metric('timing', [1]), b: metric('count', [2], ''), c: metric('reported', [3]) });
    const text = runMarkdown(current, compareRuns(current, null, new Map()), null);
    for (const name of ['a', 'b', 'c']) expect(text).toMatch(new RegExp(`^\\| ${name} \\|`, 'm'));
  });
});
