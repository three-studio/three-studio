import { describe, expect, it } from 'vitest';
import { frameStats, median, percentile } from '../report/stats';

describe('the statistics a run is judged on', () => {
  it('takes the middle value of an odd count', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('takes the mean of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('reads a metric over three launches as their median, so one outlier moves nothing', () => {
    expect(median([12.1, 31.7, 11.8])).toBe(12.1);
  });

  it('reads p95 by nearest rank: the smallest value at or above 95 % of them', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile([10, 20, 30], 95)).toBe(30);
    expect(percentile([7], 95)).toBe(7);
  });

  it('summarises frame deltas', () => {
    expect(frameStats([8, 9, 10, 30, 9])).toEqual({ median: 9, p95: 30, max: 30 });
  });

  it('refuses to summarise nothing', () => {
    expect(() => median([])).toThrow();
    expect(() => percentile([], 95)).toThrow();
  });
});
