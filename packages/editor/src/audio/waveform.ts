import type { AudioBufferLike } from '@three-studio/runtime';

/** One bar per few pixels: enough shape to recognise a clip, cheap to draw. */
const BAR_WIDTH = 3;

/**
 * The absolute peak of each of `bars` equal slices of a clip's first channel.
 *
 * **The peak of each bar, never the mean.** An average flattens transients, and
 * a drum hit would be drawn like the silence around it — which loses exactly the
 * thing a waveform is looked at for.
 *
 * Separate from the drawing because one of the two callers cannot afford to keep
 * what it measured. A decoded buffer costs roughly ten times its file on the
 * heap — the number `AudioClipCache` warns about when an asset asks to stream —
 * and a folder of tiles would hold one each. A few hundred floats survive
 * instead, and the buffer is dropped on the line after this returns.
 */
export function peaksOf(buffer: AudioBufferLike, bars: number): Float32Array {
  const samples = buffer.getChannelData(0);
  const count = Math.max(1, Math.floor(bars));
  const peaks = new Float32Array(count);
  // Fractional, so the last bar reaches the end of the clip. Flooring the step
  // instead drops up to one bar's worth of samples off the tail, which is where
  // a fade-out lives.
  const perBar = samples.length / count;

  for (let bar = 0; bar < count; bar++) {
    const from = Math.floor(bar * perBar);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((bar + 1) * perBar)));
    let peak = 0;
    for (let index = from; index < to; index++) {
      peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    peaks[bar] = peak;
  }
  return peaks;
}

/**
 * Draws peaks across a canvas, folding them down to the bars it has room for.
 *
 * The fold takes the peak of each group, for the reason above and one more: the
 * peak of a set of peaks *is* the peak of the samples underneath them. A clip
 * measured once at a fixed resolution can therefore be drawn at any smaller one
 * and still be true, which is what lets a tile redraw on resize without going
 * back to the file.
 */
export function drawPeaks(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  options: { colour?: string; height?: number } = {},
): void {
  const height = options.height ?? canvas.height;
  const width = Math.max(1, canvas.clientWidth);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return;

  const bars = Math.max(1, Math.floor(width / BAR_WIDTH));
  const middle = height / 2;

  context.clearRect(0, 0, width, height);
  context.fillStyle = options.colour ?? '#4a8cff';
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar * peaks.length) / bars);
    const to = Math.min(peaks.length, Math.max(from + 1, Math.floor(((bar + 1) * peaks.length) / bars)));
    let peak = 0;
    for (let index = from; index < to; index++) peak = Math.max(peak, peaks[index] ?? 0);
    const bounded = Math.max(1, peak * middle);
    context.fillRect(bar * BAR_WIDTH, middle - bounded, BAR_WIDTH - 1, bounded * 2);
  }
}

/**
 * Draws a clip's peaks across a canvas.
 *
 * Lives here rather than in the import dialog because two places want it and
 * they are on opposite sides of the import: the dialog, deciding whether to take
 * a file at all, and the Project panel, recognising one that is already in.
 *
 * The dialog holds the buffer for as long as it is open, so this measures at
 * exactly the resolution it is about to draw at — there is nothing to save by
 * measuring coarsely. The panel, which cannot hold buffers, goes through
 * `peaksOf` and `drawPeaks` itself.
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBufferLike,
  options: { colour?: string; height?: number } = {},
): void {
  const bars = Math.max(1, Math.floor(Math.max(1, canvas.clientWidth) / BAR_WIDTH));
  drawPeaks(canvas, peaksOf(buffer, bars), options);
}
