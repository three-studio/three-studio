import type { AssetResolver, AudioContextLike, ClipLoader } from '@three-studio/runtime';
import { editorAssetResolver } from '../state/assetStore';
import { editorAudioContext } from './context';
import { peaksOf } from './waveform';

/**
 * How finely a clip is measured, once, whatever size it is later drawn at.
 *
 * A tile is never wider than a couple of hundred pixels and draws one bar per
 * three of them, so 512 is comfortably more than any fold will ask for, and
 * `drawPeaks` folds down without lying. Two kilobytes per asset, against the
 * tens of megabytes the buffer it came from occupied.
 */
const RESOLUTION = 512;

export interface ClipPeaksOptions {
  /** `null` where the window has no Web Audio, which the caller must tolerate. */
  context?: () => AudioContextLike | null;
  resolver?: AssetResolver;
  load?: ClipLoader;
}

/**
 * A clip's shape, measured once and kept, so the Project panel can draw it.
 *
 * The decode is the whole cost here and it is not small — it is the number
 * `AudioClipCache` puts in its warning when an asset asks to stream. So the
 * buffer is measured and dropped on the same turn, and what stays is
 * `RESOLUTION` floats. The map therefore grows with the number of *audio assets
 * the panel has shown*, at two kilobytes each, and never with their length: a
 * thousand sounds is two megabytes, which is a size worth not thinking about.
 *
 * Context, resolver and loader are parameters for the reason ADR-7 gives: under
 * node `AudioContext` is a type with no value behind it, and a module that
 * reaches for one directly cannot be tested at all.
 */
export class ClipPeaks {
  /**
   * Doubles as the in-flight record and as the cache.
   *
   * One entry per asset means the six tiles that scroll into view together
   * decode once between them rather than six times, and it means the answer is
   * already there when the same folder is opened again.
   */
  private readonly entries = new Map<string, Promise<Float32Array | null>>();
  private readonly context: () => AudioContextLike | null;
  private readonly resolver: AssetResolver;
  private readonly load: ClipLoader;

  constructor(options: ClipPeaksOptions = {}) {
    this.context = options.context ?? editorAudioContext;
    this.resolver = options.resolver ?? editorAssetResolver;
    this.load = options.load ?? (async (url) => (await fetch(url)).arrayBuffer());
  }

  /** `null` for a clip that cannot be read or cannot be decoded, and the caller draws its icon. */
  peaks(assetId: string): Promise<Float32Array | null> {
    const existing = this.entries.get(assetId);
    if (existing) return existing;
    const pending = this.measure(assetId);
    this.entries.set(assetId, pending);
    return pending;
  }

  /** Forgets one asset, for a file replaced on disk under the id it already had. */
  invalidate(assetId: string): void {
    this.entries.delete(assetId);
  }

  private async measure(assetId: string): Promise<Float32Array | null> {
    const context = this.context();
    const url = this.resolver.url(assetId);
    if (context === null || url === null) {
      this.entries.delete(assetId);
      return null;
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await this.load(url);
    } catch {
      // Dropped rather than remembered, the same call `AudioClipCache` makes on
      // the same failure: a `studio-asset://` read can fail because the file was
      // still being written, and the next look should try again rather than
      // inherit a verdict from a race.
      this.entries.delete(assetId);
      return null;
    }

    try {
      const buffer = await context.decodeAudioData(bytes);
      // Measured and dropped on the same turn. Nothing here ever holds a buffer.
      return peaksOf(buffer, RESOLUTION);
    } catch {
      // Kept, unlike the read failure above: this browser cannot decode this
      // format and will not learn to before the page reloads, so the tile keeps
      // its icon without going back to the file on every scroll.
      return null;
    }
  }
}

/** One measurement of each clip for the whole editor. */
export const clipPeaks = new ClipPeaks();
