/** One bar per few pixels: enough shape to recognise a clip, cheap to draw. */
const BAR_WIDTH = 3;

/**
 * Draws a clip's peaks across a canvas.
 *
 * Lives here rather than in the import dialog because two places want it and
 * they are on opposite sides of the import: the dialog, deciding whether to take
 * a file at all, and the Project panel, recognising one that is already in.
 *
 * **The peak of each bar, never the mean.** An average flattens transients, and
 * a drum hit would be drawn like the silence around it — which loses exactly the
 * thing a waveform is looked at for.
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  options: { colour?: string; height?: number } = {},
): void {
  const height = options.height ?? canvas.height;
  const width = Math.max(1, canvas.clientWidth);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return;

  const samples = buffer.getChannelData(0);
  const bars = Math.max(1, Math.floor(width / BAR_WIDTH));
  const perBar = Math.floor(samples.length / bars);
  const middle = height / 2;

  context.clearRect(0, 0, width, height);
  context.fillStyle = options.colour ?? '#4a8cff';
  for (let bar = 0; bar < bars; bar++) {
    let peak = 0;
    for (let sample = 0; sample < perBar; sample++) {
      peak = Math.max(peak, Math.abs(samples[bar * perBar + sample] ?? 0));
    }
    const bounded = Math.max(1, peak * middle);
    context.fillRect(bar * BAR_WIDTH, middle - bounded, BAR_WIDTH - 1, bounded * 2);
  }
}
