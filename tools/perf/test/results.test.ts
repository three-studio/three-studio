import { describe, expect, it } from 'vitest';
import { heapOf, metricsOf } from '../report/results';

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
