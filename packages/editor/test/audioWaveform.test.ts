import type { AssetResolver } from '@three-studio/runtime/assets/AssetResolver';
import type { AudioBufferLike } from '@three-studio/runtime/audio/AudioContextLike';
import { describe, expect, it } from 'vitest';
import { ClipPeaks } from '../src/audio/peaks';
import { peaksOf } from '../src/audio/waveform';
// The runtime's fake, reused rather than copied, for the reason
// `audioPreview.test.ts` gives: a second hundred-line stand-in for Web Audio
// would drift from the first the moment either grew a node.
import { clipBytes, FakeContext } from '../../runtime/test/audio/fakeContext';

const CLIP = 'clip-1';

/** A one-channel buffer written by hand, the style `sceneMigration.test.ts` uses. */
function bufferOf(samples: number[]): AudioBufferLike {
  const data = Float32Array.from(samples);
  return {
    duration: samples.length / 48000,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 48000,
    getChannelData: () => data,
  };
}

describe('peaksOf', () => {
  it('keeps a transient the mean would have flattened', () => {
    // One sample of a drum hit in a bar of near-silence. The average of this bar
    // is 0.1, which is the silence around it; the peak is the hit.
    const bar = [0.01, 0.01, 0.01, 1, 0.01, 0.01, 0.01, 0.01];
    expect(peaksOf(bufferOf(bar), 1)[0]).toBe(1);
  });

  it('measures the magnitude, so a trough counts as much as a crest', () => {
    expect(peaksOf(bufferOf([-0.8, 0.2]), 1)[0]).toBeCloseTo(0.8);
  });

  it('gives one peak per bar, each from its own slice', () => {
    // `toBeCloseTo` and not `toEqual`: a `Float32Array` rounds 0.9 to 0.899999976,
    // and pinning that number would be pinning IEEE-754 rather than the peaks.
    const peaks = peaksOf(bufferOf([0.1, 0.1, 0.9, 0.9]), 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(0.1);
    expect(peaks[1]).toBeCloseTo(0.9);
  });

  /*
   * The bar count never divides the sample count, so a step of
   * `floor(length / bars)` walks short and leaves a tail unread — and the tail
   * of a clip is where a fade-out lives, which is exactly what a waveform is
   * looked at for.
   */
  it('reaches the last sample when the bars do not divide the clip', () => {
    const peaks = peaksOf(bufferOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), 3);
    expect(Math.max(...peaks)).toBe(1);
  });
});

describe('ClipPeaks', () => {
  const resolver: AssetResolver = {
    url: (assetId) => (assetId === CLIP ? `asset://${assetId}` : null),
    settings: () => null,
  };

  function rig(options: { context?: FakeContext; fails?: boolean } = {}) {
    const context = options.context ?? new FakeContext();
    const reads: string[] = [];
    const peaks = new ClipPeaks({
      context: () => context,
      resolver,
      load: async (url) => {
        reads.push(url);
        if (options.fails) throw new Error('EBUSY');
        return clipBytes({ length: 64 });
      },
    });
    return { context, peaks, reads };
  }

  it('reads a clip once however many tiles ask at the same moment', async () => {
    const { peaks, reads } = rig();
    const [a, b, c] = await Promise.all([
      peaks.peaks(CLIP),
      peaks.peaks(CLIP),
      peaks.peaks(CLIP),
    ]);
    expect(reads).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('keeps what it measured, so scrolling back costs nothing', async () => {
    const { peaks, reads } = rig();
    await peaks.peaks(CLIP);
    await peaks.peaks(CLIP);
    expect(reads).toHaveLength(1);
  });

  it('answers null for an asset the project cannot resolve', async () => {
    const { peaks, reads } = rig();
    expect(await peaks.peaks('gone')).toBeNull();
    expect(reads).toHaveLength(0);
  });

  /*
   * The verdict of a refused decode is final and the verdict of a failed read is
   * not, which is the distinction `AudioClipCache` draws for the same two
   * failures: this browser will not learn the format before the page reloads,
   * while a `studio-asset://` read can fail because the file was still being
   * written.
   */
  it('remembers a refused decode rather than re-reading the file', async () => {
    const context = new FakeContext();
    context.decodeFails = true;
    const { peaks, reads } = rig({ context });

    expect(await peaks.peaks(CLIP)).toBeNull();
    expect(await peaks.peaks(CLIP)).toBeNull();
    expect(reads).toHaveLength(1);
  });

  it('retries a read that failed', async () => {
    const { peaks, reads } = rig({ fails: true });

    expect(await peaks.peaks(CLIP)).toBeNull();
    expect(await peaks.peaks(CLIP)).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it('holds peaks and not the buffer they came from', async () => {
    const { peaks } = rig();
    const measured = await peaks.peaks(CLIP);
    expect(measured).toBeInstanceOf(Float32Array);
    // 512 floats whatever the clip's length, which is what makes a folder of
    // them affordable.
    expect(measured?.length).toBe(512);
  });
});
