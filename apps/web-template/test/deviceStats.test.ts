import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  createFrameWindow,
  readRenderer,
  type FrameSample,
  type FrameWindow,
} from '../src/device/stats';

/*
 * What a page measures of its own frames, on frame times the test writes: a
 * phone's display at 60 Hz, a scene that stutters, iOS's Low Power Mode
 * holding every page at 30, a page that stopped drawing.
 */

const HZ60 = 1000 / 60;
const HZ30 = 1000 / 30;

const repeat = (interval: number, count: number): number[] => Array<number>(count).fill(interval);

/** Frame times, one interval after another, from `start`. */
function timeline(intervals: number[], start = 0): number[] {
  const times = [start];
  for (const interval of intervals) times.push(times.at(-1)! + interval);
  return times;
}

/** Feeds a window its frames, and returns what it sampled, with the time of each sample. */
function feed(window: FrameWindow, times: number[]): { at: number; sample: FrameSample }[] {
  const samples: { at: number; sample: FrameSample }[] = [];
  for (const time of times) {
    const sample = window.frame(time);
    if (sample !== null) samples.push({ at: time, sample });
  }
  return samples;
}

/** A pattern of intervals, repeated for about `ms`. */
function during(ms: number, pattern: number[]): number[] {
  const length = pattern.reduce((sum, interval) => sum + interval, 0);
  return Array.from({ length: Math.ceil(ms / length) }, () => pattern).flat();
}

describe('a window of frames', () => {
  it('says nothing for a second, then samples a steady 60 Hz two seconds later', () => {
    const samples = feed(createFrameWindow(), timeline(repeat(HZ60, 360)));

    // The first second is the boot's — shaders compiling as they are first
    // needed — and the window that follows it lasts two. A frame or two late,
    // as times that add up sixtieths of a second land on either side of it.
    expect(samples[0]!.at).toBeGreaterThanOrEqual(3000);
    expect(samples[0]!.at).toBeLessThan(3000 + 3 * HZ60);
    expect(samples[0]!.sample).toMatchObject({ fps: 60, p95: 16.7, pinned30: false });
    expect(Math.abs(samples[0]!.sample.frames - 120)).toBeLessThanOrEqual(1);
    expect(samples).toHaveLength(2);
  });

  it('reads the slowest frames in the 95th percentile', () => {
    // Ten frames of 50 ms spread through a window of about a hundred.
    const stutter = during(2000, [...repeat(HZ60, 9), 50]);

    const samples = feed(
      createFrameWindow(),
      timeline([...repeat(HZ60, 61), ...stutter, ...repeat(HZ60, 30)]),
    );

    expect(samples[0]!.sample.p95).toBe(50);
    expect(samples[0]!.sample.fps).toBe(60);
  });

  it('is held at 30 fps only for the second window in a row that is', () => {
    const samples = feed(createFrameWindow(), timeline(repeat(HZ30, 180)));

    expect(samples.map(({ sample }) => sample.pinned30)).toEqual([false, true]);
    expect(samples[1]!.sample.fps).toBe(30);
  });

  it.each([
    // Its median is 33.35 — but no frame is anywhere near it.
    ['frames alternating between 60 and 20 fps', [HZ60, 50]],
    // The median is right, but a slow scene wobbles more than a capped one.
    ['eight frames in ten at 30 fps, the others faster or slower', [...repeat(HZ30, 8), HZ60, 50]],
    ['a page at 10 fps', [100]],
  ])('is not held at 30 fps for %s', (_name, pattern) => {
    const samples = feed(createFrameWindow(), timeline(during(8000, pattern)));

    expect(samples.length).toBeGreaterThanOrEqual(2);
    expect(samples.every(({ sample }) => !sample.pinned30)).toBe(true);
  });

  it('ends a window at a gap of 3 s, and warms up again', () => {
    const before = timeline(repeat(HZ60, 120));
    const resumed = before.at(-1)! + 3000;

    const samples = feed(createFrameWindow(), [...before, ...timeline(repeat(HZ60, 300), resumed)]);

    // The window the gap ended gives nothing; a second of warm-up and a whole
    // window come first.
    expect(samples[0]!.at).toBeGreaterThanOrEqual(resumed + 3000);
  });

  it('starts over when told, warm-up included', () => {
    const window = createFrameWindow();
    feed(window, timeline(repeat(HZ60, 150)));

    window.restart();
    const restarted = 2500 + HZ60;
    const samples = feed(window, timeline(repeat(HZ60, 300), restarted));

    expect(samples[0]!.at).toBeGreaterThanOrEqual(restarted + 3000);
  });

  it('forgets being held at 30 fps once it starts over', () => {
    const window = createFrameWindow();
    expect(feed(window, timeline(repeat(HZ30, 180))).at(-1)!.sample.pinned30).toBe(true);

    window.restart();
    const samples = feed(window, timeline(repeat(HZ30, 120), 7000));

    expect(samples.map(({ sample }) => sample.pinned30)).toEqual([false]);
  });
});

describe('the renderer’s counters', () => {
  it('are read from what three counts, with the ratio and the size it draws at', () => {
    const renderer = {
      info: {
        render: { drawCalls: 142, triangles: 85_210 },
        memory: { textures: 31, total: 188_743_680 },
      },
      getPixelRatio: () => 3,
      domElement: { width: 1179, height: 2556 },
    };

    expect(readRenderer(renderer as unknown as WebGPURenderer)).toEqual({
      drawCalls: 142,
      triangles: 85_210,
      textures: 31,
      gpuMemory: 188_743_680,
      pixelRatio: 3,
      width: 1179,
      height: 2556,
    });
  });

  it('read 0 for what a renderer does not have, and never throw', () => {
    const renderer = {
      getPixelRatio: () => {
        throw new Error('disposed');
      },
      domElement: { width: 393, height: 'x' },
    };

    expect(readRenderer(renderer as unknown as WebGPURenderer)).toEqual({
      drawCalls: 0,
      triangles: 0,
      textures: 0,
      gpuMemory: 0,
      pixelRatio: 0,
      width: 393,
      height: 0,
    });
  });
});
