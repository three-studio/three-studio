import { describe, expect, it } from 'vitest';
import { heapOf, metricsOf, summaryOf } from '../report/results';

describe('the metrics of a scenario', () => {
  const TABLE = new Map([
    ['edit.frameMs', { kind: 'timing', unit: 'ms' }],
    ['edit.drawCalls', { kind: 'count', unit: '' }],
  ] as const);

  it('gathers each metric over the launches, with its kind and unit', () => {
    expect(
      metricsOf(TABLE, [
        { 'edit.frameMs': 8.1, 'edit.drawCalls': 9010 },
        { 'edit.frameMs': 7.9, 'edit.drawCalls': 9010 },
      ]),
    ).toEqual({
      'edit.frameMs': { kind: 'timing', unit: 'ms', launches: [8.1, 7.9] },
      'edit.drawCalls': { kind: 'count', unit: '', launches: [9010, 9010] },
    });
  });

  it('refuses a launch that lacks one, naming it', () => {
    expect(() => metricsOf(TABLE, [{ 'edit.frameMs': 8.1 }])).toThrow(/edit\.drawCalls/);
  });

  it('refuses a reading the table does not declare, so a typo is not a metric', () => {
    expect(() => metricsOf(TABLE, [{ 'edit.frameMs': 8.1, 'edit.drawCalls': 1, 'edit.drawcalls': 1 }])).toThrow(
      /edit\.drawcalls/,
    );
  });
});

describe('the JS memory', () => {
  it('is the V8 heap plus the ArrayBuffers behind it', () => {
    // three keeps a model's attribute arrays in ArrayBuffers after the upload:
    // `usedSize` alone would leave out the very memory a big model holds.
    expect(heapOf({ usedSize: 40_000_000, totalSize: 60_000_000, embedderHeapUsedSize: 0, backingStorageSize: 300_000_000 })).toEqual({
      heapBytes: 340_000_000,
      heapUsedBytes: 40_000_000,
      heapBackingBytes: 300_000_000,
    });
  });

  it('refuses a reply without both parts', () => {
    expect(() => heapOf({ usedSize: 1 })).toThrow();
  });
});

describe('the summary printed as a run goes', () => {
  it('gives each metric its median and every launch, and says when a count moved between launches', () => {
    const text = summaryOf('S3', {
      metrics: {
        'edit.frameMs': { kind: 'timing', unit: 'ms', launches: [8.3, 8.5, 8.5] },
        'edit.drawCalls': { kind: 'count', unit: '', launches: [9010, 9006, 9010] },
      },
      window: null,
      notes: ['edit: 10 B/frame at somewhere.ts:1'],
    });
    expect(text.split('\n')).toEqual([
      '[perf] S3 edit.frameMs 8.50 ms (timing) — 8.30 / 8.50 / 8.50',
      '[perf] S3 edit.drawCalls 9010 (count, LAUNCHES DIFFER) — 9010 / 9006 / 9010',
      '[perf] S3 edit: 10 B/frame at somewhere.ts:1',
      '',
    ]);
  });
});

