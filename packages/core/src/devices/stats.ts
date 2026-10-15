import type { DeviceStats } from './protocol';

/*
 * A device's numbers, in words: the row the editor shows for it, and the
 * corner the device draws them in when asked, write them here, so that the two
 * never disagree on what a phone just measured.
 *
 * Imports nothing but a type, for the reason `protocol.ts` gives: the client a
 * phone runs takes this file by its path, and must not bring the rest of core
 * with it.
 */

/** What a row and the device's overlay say, a line each. */
export interface DescribedDeviceStats {
  /** `58 fps · p95 21 ms`: how smoothly it runs. */
  pace: string;
  /** `142 draws · 85.2k tris`: what one frame draws — the start of `scene`, for a row's one line. */
  draws: string;
  /** `142 draws · 85.2k tris · 31 textures · 180 MB`: what one frame costs. */
  scene: string;
  /** `drawn at 2× · 786×1704`: how many pixels it draws. */
  pixels: string;
}

/** Three significant digits at most, a unit once past a thousand. */
const UNITS = [
  [1e6, 'M'],
  [1e3, 'k'],
] as const;

/**
 * A count as a row has room for it: up to 999 as it is, then `1k`, `85.2k`,
 * `1.25M`. Three digits are as many as anyone reads in a glance, and a
 * trailing zero says nothing.
 */
export function formatCount(count: number): string {
  for (const [size, unit] of UNITS) {
    // Rounded first, so that 999 999 reads `1M`, not `1000k`.
    const value = Number((count / size).toPrecision(3));
    if (value >= 1) return `${value}${unit}`;
  }
  return String(count);
}

const MB = 1024 * 1024;

/** `180 MB`, `4.5 MB` under ten, `1.25 GB` from 1 024 MB. */
function formatBytes(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1024) return `${Number((mb / 1024).toFixed(2))} GB`;
  return `${Number(mb.toFixed(mb >= 10 ? 0 : 1))} MB`;
}

function counted(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function describeDeviceStats(stats: DeviceStats): DescribedDeviceStats {
  const draws = `${counted(stats.drawCalls, 'draw', 'draws')} · ${formatCount(stats.triangles)} tris`;
  return {
    // A tenth of a millisecond is what tells 16.7 from 16 — two refresh rates.
    pace: `${stats.fps} fps · p95 ${Number(stats.p95.toFixed(1))} ms`,
    draws,
    scene: [
      draws,
      counted(stats.textures, 'texture', 'textures'),
      formatBytes(stats.gpuMemory),
    ].join(' · '),
    // Android's ratios are not always halves: 2.625 is a common one.
    pixels: `drawn at ${Number(stats.pixelRatio.toFixed(2))}× · ${stats.width}×${stats.height}`,
  };
}
