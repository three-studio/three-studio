import {
  DEVICE_STATS_MS,
  DEVICE_STATS_WARMUP_MS,
  type DeviceStats,
} from '@three-studio/core/devices/protocol';
import type { PlayerAnnouncement } from '../announce';

/*
 * What a page measures of its own frames, without the page around it: frame
 * times come in, a summary comes out every two seconds. Pure, so that a test
 * writes the frame times a phone would — a steady display, a stutter, iOS
 * holding every page at 30 fps.
 *
 * The times are the client's own `requestAnimationFrame` timestamps. The
 * player's loop is `requestAnimationFrame` too, so both run in the same
 * frames: a frame late for the game is late here, with no hook in the player.
 */

/** What a window of frames says, before the renderer's counters join it. */
export type FrameSample = Pick<DeviceStats, 'fps' | 'p95' | 'frames' | 'pinned30'>;

export interface FrameWindow {
  /** One frame, at its timestamp: a sample when it closes a window, `null` otherwise. */
  frame: (time: number) => FrameSample | null;
  /**
   * Starts over, warm-up included: the page has just come back, and its next
   * frames are not yet the game's.
   */
  restart: () => void;
}

/** A frame later than this is a page that stopped drawing — hidden, asleep — not a slow one. */
const GAP_MS = 2_000;

/*
 * Held at 30 fps: what iOS's Low Power Mode does to every page, and Chrome's
 * Energy Saver too. A scene that is merely slow wobbles between multiples of
 * the display's interval; one held this steadily at 33.3 ms is capped.
 */
const HELD_30_MS = 1000 / 30;
/** How far from 33.3 ms an interval may be and still sit at 30 fps. */
const HELD_30_BAND_MS = 2;
/** Fewer frames than this in a window say too little to tell. */
const HELD_30_FRAMES = 30;
/** The share of a window's intervals that must sit in the band. */
const HELD_30_SHARE = 0.9;

/** A window's intervals, summed up; `held` says whether this window alone sat at 30 fps. */
function summarize(
  intervals: number[],
  heldBefore: boolean,
): { sample: FrameSample; held: boolean } {
  const sorted = [...intervals].sort((a, b) => a - b);
  const count = sorted.length;
  const below = sorted[Math.floor((count - 1) / 2)] ?? 0;
  const above = sorted[Math.floor(count / 2)] ?? 0;
  const median = (below + above) / 2;
  const p95 = sorted[Math.ceil(count * 0.95) - 1] ?? 0;
  const atThirty = (interval: number): boolean => Math.abs(interval - HELD_30_MS) <= HELD_30_BAND_MS;
  const inBand = sorted.filter(atThirty).length;
  const held =
    count >= HELD_30_FRAMES && atThirty(median) && inBand >= count * HELD_30_SHARE;
  return {
    sample: {
      fps: median > 0 ? Math.round(1000 / median) : 0,
      p95: Math.round(p95 * 10) / 10,
      frames: count,
      // Two windows in a row, four seconds: one alone can be a scene that
      // happened to sit there.
      pinned30: held && heldBefore,
    },
    held,
  };
}

/**
 * A rolling measure of the frames a page draws.
 *
 * The first `warmupMs` after a start, or a `restart()`, is not counted:
 * shaders compile as the frames that need them come, and those stalls are the
 * boot's, not the game's. Then every `windowMs` gives one sample — the median
 * interval as frames per second, and the 95th percentile, which is what
 * stutter is made of and an average hides.
 */
export function createFrameWindow({
  windowMs = DEVICE_STATS_MS,
  warmupMs = DEVICE_STATS_WARMUP_MS,
} = {}): FrameWindow {
  /** The first frame since a start, or `null` before it. */
  let start: number | null = null;
  let last = 0;
  /** Where the window being measured began; `null` while warming up. */
  let windowStart: number | null = null;
  let intervals: number[] = [];
  /** The window before this one sat at 30 fps. */
  let heldBefore = false;

  const restart = (): void => {
    start = null;
    windowStart = null;
    intervals = [];
    heldBefore = false;
  };

  return {
    frame(time) {
      if (start === null) {
        start = time;
        last = time;
        return null;
      }
      const interval = time - last;
      last = time;
      if (interval > GAP_MS) {
        // The page stopped drawing: what follows is a page coming back, which
        // warms up again like one that starts.
        restart();
        start = time;
        return null;
      }
      if (windowStart === null) {
        if (time - start >= warmupMs) windowStart = time;
        return null;
      }
      intervals.push(interval);
      if (time - windowStart < windowMs) return null;
      const { sample, held } = summarize(intervals, heldBefore);
      heldBefore = held;
      intervals = [];
      windowStart = time;
      return sample;
    },
    restart,
  };
}

/** The player's renderer, as its announcement hands it: a type only, so the bundle carries no three. */
type PlayerRenderer = Extract<PlayerAnnouncement, { state: 'running' }>['renderer'];

export type RendererCounts = Pick<
  DeviceStats,
  'drawCalls' | 'triangles' | 'textures' | 'gpuMemory' | 'pixelRatio' | 'width' | 'height'
>;

/** A number read from the renderer, or 0: a three older or newer than this may lack any of them. */
function read(get: () => unknown): number {
  try {
    const value = get();
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * What the renderer counts, read outside its loop.
 *
 * Three resets its draw calls and triangles as each animation frame begins,
 * before the player renders, so a read from another frame callback sees one
 * frame whole — this frame's or the last one's. Its memory is what it gave
 * the GPU, by its own count: a phone's browser says nothing of what it uses.
 */
export function readRenderer(renderer: PlayerRenderer): RendererCounts {
  return {
    drawCalls: read(() => renderer.info.render.drawCalls),
    triangles: read(() => renderer.info.render.triangles),
    textures: read(() => renderer.info.memory.textures),
    gpuMemory: read(() => renderer.info.memory.total),
    pixelRatio: read(() => renderer.getPixelRatio()),
    width: read(() => renderer.domElement.width),
    height: read(() => renderer.domElement.height),
  };
}
