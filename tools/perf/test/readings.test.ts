import { describe, expect, it } from 'vitest';
import { MISSED_START, oneWindow, readTwiceAtMost } from '../scenarios/readings';

/*
 * A reading whose start the driver missed — the model already drawn when it
 * arrived — cannot say when the first frame came. It is refused, and the
 * launch made again once; a second miss is a failure, not a third try.
 */

describe('a reading that started late', () => {
  it('is made again once, and the second one kept', async () => {
    const attempts: number[] = [];
    const reading = await readTwiceAtMost('S1-geometry-1', async (attempt) => {
      attempts.push(attempt);
      return attempt === 1 ? MISSED_START : { firstFrameMs: 4200 };
    });
    expect(reading).toEqual({ firstFrameMs: 4200 });
    expect(attempts).toEqual([1, 2]);
  });

  it('fails on a second miss, naming the reading', async () => {
    await expect(readTwiceAtMost('S1-geometry-1', async () => MISSED_START)).rejects.toThrow(/S1-geometry-1/);
  });

  it('is kept at once when it started in time', async () => {
    const attempts: number[] = [];
    await readTwiceAtMost('S1-textures-2', async (attempt) => {
      attempts.push(attempt);
      return { firstFrameMs: 900 };
    });
    expect(attempts).toEqual([1]);
  });
});

describe('the window launches share', () => {
  const laptop = { innerWidth: 1512, innerHeight: 858, devicePixelRatio: 2 };

  it('is the one every launch saw', () => {
    expect(oneWindow('S7', [laptop, { ...laptop }, { ...laptop }])).toEqual(laptop);
  });

  it('refuses launches that saw two, since their work differs', () => {
    expect(() => oneWindow('S7', [laptop, { ...laptop, devicePixelRatio: 1 }])).toThrow(/S7/);
  });
});

