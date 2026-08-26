import type { AssetResolver } from '../assets/AssetResolver';
import type { AudioBufferLike, AudioContextLike } from './AudioContextLike';

/** How the bytes of an asset are fetched. A parameter so a test needs no network. */
export type ClipLoader = (url: string) => Promise<ArrayBuffer>;

/**
 * Sixty-four megabytes of decoded audio before anything is evicted.
 *
 * The number is in *bytes and not in clips* because a decoded `AudioBuffer` is
 * 32-bit float whatever the file was: `seconds × sampleRate × channels × 4`.
 * Three minutes of 44.1 kHz stereo is about 63 MB on its own, which is why a
 * count of entries would be a budget that means nothing.
 */
const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024;

interface Entry {
  /**
   * Settles to `null` when the clip could not be had, for whatever reason.
   *
   * This is also what makes a failed decode final: the entry stays in the map
   * with a promise that is already resolved to `null`, so every later `acquire`
   * gets that answer back without touching the file again. A fetch that failed
   * deletes its entry instead, and is therefore retried.
   */
  readonly pending: Promise<AudioBufferLike | null>;
  buffer: AudioBufferLike | null;
  refs: number;
  bytes: number;
  used: number;
}

/**
 * Decoded clips, one entry per asset id, reference counted.
 *
 * Reference counted **and not evicted at zero**: the normal case is playing the
 * same footstep again two seconds later, and throwing a buffer away to decode it
 * again is the wrong economy. A reference of zero only makes an entry
 * *eligible*, and eviction happens when the budget is exceeded, oldest use
 * first.
 *
 * The asset's imported `gain` is deliberately **not** baked in here. It is a
 * constant multiplier, and a voice already owns a gain node — folding it into
 * that node's value costs nothing, while baking it into the samples would mean
 * a pass over every sample and a second copy of the buffer for a value the
 * author can change in the import dialog. `forceMono` *is* baked in, because a
 * downmix cannot be folded into a scalar.
 */
export class AudioClipCache {
  private readonly entries = new Map<string, Entry>();
  private readonly budgetBytes: number;
  private readonly load: ClipLoader;
  private readonly onWarning: (message: string) => void;
  private clock = 0;

  constructor(
    private readonly context: AudioContextLike,
    private readonly resolver: AssetResolver,
    options: {
      load?: ClipLoader;
      budgetBytes?: number;
      onWarning?: (message: string) => void;
    } = {},
  ) {
    this.budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
    this.load = options.load ?? defaultLoader;
    this.onWarning = options.onWarning ?? (() => {});
  }

  /**
   * Takes a reference and yields the clip.
   *
   * The reference is taken **synchronously**, before the first `await`: an entry
   * that is still decoding must not be evictable, and a caller that has asked
   * for a clip is holding it whether or not it has arrived.
   */
  acquire(assetId: string): { clip: Promise<AudioBufferLike | null>; release: () => void } {
    const existing = this.entries.get(assetId);
    if (existing) {
      existing.refs += 1;
      existing.used = ++this.clock;
      return { clip: existing.pending, release: () => this.release(assetId) };
    }

    const entry: Entry = {
      pending: this.fetchAndDecode(assetId),
      buffer: null,
      refs: 1,
      bytes: 0,
      used: ++this.clock,
    };
    this.entries.set(assetId, entry);
    void entry.pending.then((buffer) => {
      // The entry may have been cleared while the fetch was in flight — a scene
      // change, a dispose. Writing into a map we no longer own would resurrect
      // an entry nothing releases.
      if (this.entries.get(assetId) !== entry) return;
      entry.buffer = buffer;
      entry.bytes = buffer === null ? 0 : bytesOf(buffer);
      this.evict();
    });
    return { clip: entry.pending, release: () => this.release(assetId) };
  }

  /** The clip if it is already decoded, without taking a reference or starting anything. */
  peek(assetId: string): AudioBufferLike | null {
    return this.entries.get(assetId)?.buffer ?? null;
  }

  /**
   * Forgets an asset, so the next play re-reads it.
   *
   * For a file that changed on disk under an id that did not — replacing a sound
   * without breaking the scenes that point at it. Voices already playing keep
   * the buffer they hold: they finish with the old sound, which is far better
   * than a gap.
   */
  invalidate(assetId: string): void {
    this.entries.delete(assetId);
  }

  clear(): void {
    this.entries.clear();
  }

  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  get size(): number {
    return this.entries.size;
  }

  private release(assetId: string): void {
    const entry = this.entries.get(assetId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    entry.used = ++this.clock;
    this.evict();
  }

  private evict(): void {
    if (this.bytes <= this.budgetBytes) return;
    const idle = [...this.entries]
      .filter(([, entry]) => entry.refs === 0 && entry.bytes > 0)
      .sort((a, b) => a[1].used - b[1].used);
    let total = this.bytes;
    for (const [assetId, entry] of idle) {
      if (total <= this.budgetBytes) return;
      this.entries.delete(assetId);
      total -= entry.bytes;
    }
  }

  private async fetchAndDecode(assetId: string): Promise<AudioBufferLike | null> {
    const url = this.resolver.url(assetId);
    if (url === null) {
      this.onWarning(`No audio asset ${assetId} in this project; the sound will not play.`);
      return null;
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await this.load(url);
    } catch (error) {
      // Not poisoned: a `studio-asset://` read can fail because the file was
      // being written, and the next play should try again rather than inherit a
      // verdict from a race.
      this.entries.delete(assetId);
      this.onWarning(`Could not read audio asset ${assetId}: ${message(error)}`);
      return null;
    }

    try {
      const decoded = await this.context.decodeAudioData(bytes);
      const settings = this.resolver.settings?.(assetId);
      if (settings?.kind === 'audio' && settings.loadMode === 'stream') {
        // Persisted since the importer was written, and not implemented: a
        // stream is a `MediaElementAudioSourceNode`, a different kind of node
        // with its own limits, and it is V2 (CIBLE §16). Decoding it instead is
        // the right fallback — the sound plays — but it is not what the asset
        // asked for, and the cost is the whole point of the setting: two minutes
        // of stereo is tens of megabytes resident. Said once per asset, here,
        // because this runs once per entry.
        this.onWarning(
          `Audio asset ${assetId} is set to stream, which is not supported yet; ` +
            `it has been decoded into memory instead (${mib(decoded)} MiB).`,
        );
      }
      const mono =
        settings?.kind === 'audio' && settings.forceMono ? this.downmix(decoded) : decoded;
      return mono;
    } catch (error) {
      // Left in the map on purpose, unlike the fetch failure above: the browser
      // cannot decode this format and will not learn to before the page
      // reloads, so the entry stays with its `pending` resolved to `null` and
      // every later play gets that answer without reading the file again.
      this.onWarning(`Could not decode audio asset ${assetId}: ${message(error)}`);
      return null;
    }
  }

  /**
   * Averages the channels into one.
   *
   * Positional audio needs mono anyway — a `PannerNode` places a source at a
   * point, and a stereo image at a point is a contradiction the browser resolves
   * by ignoring one of the two.
   */
  private downmix(buffer: AudioBufferLike): AudioBufferLike {
    if (buffer.numberOfChannels <= 1) return buffer;
    const mono = this.context.createBuffer(1, buffer.length, buffer.sampleRate);
    const out = mono.getChannelData(0);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (samples[i] ?? 0);
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / buffer.numberOfChannels;
    return mono;
  }
}

function bytesOf(buffer: AudioBufferLike): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

/** Rounded to a tenth, because the number is there to be recognised, not summed. */
function mib(buffer: AudioBufferLike): string {
  return (bytesOf(buffer) / (1024 * 1024)).toFixed(1);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultLoader: ClipLoader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.arrayBuffer();
};
