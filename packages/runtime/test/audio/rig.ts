import type { AssetSettings } from '@three-studio/core';
import type { AssetResolver } from '../../src/assets/AssetResolver';
import { AudioClipCache } from '../../src/audio/AudioClipCache';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { clipBytes, FakeContext } from './fakeContext';

export interface ClipSpec {
  channels?: number;
  length?: number;
  sampleRate?: number;
  duration?: number;
  /** The imported gain, as `AssetResolver.settings()` would report it. */
  gain?: number;
  forceMono?: boolean;
}

export interface Rig {
  context: FakeContext;
  engine: AudioEngine;
  warnings: string[];
  /** How many times the bytes of a clip were actually read. */
  loads: string[];
  /** The clips, whether this engine made the cache or was handed one. */
  cache: AudioClipCache;
}

/**
 * An engine over the fake context, with a project made of clip specs.
 *
 * An id that is not in `clips` is a missing asset, which is the same thing the
 * real resolver says by returning `null`.
 */
export function rig(
  clips: Record<string, ClipSpec> = { step: { duration: 1 } },
  options: {
    maxVoices?: number;
    budgetBytes?: number;
    /**
     * Hands the engine a cache it does not own, as `SceneHost` does.
     *
     * The difference matters for anything about teardown: an engine that made
     * its own cache clears it on dispose, which hides whether the voices ever
     * gave their clips back.
     */
    shareCache?: boolean;
  } = {},
): Rig {
  const context = new FakeContext();
  const warnings: string[] = [];
  const loads: string[] = [];

  const resolver: AssetResolver = {
    url: (assetId) => (assetId in clips ? `asset://${assetId}` : null),
    settings: (assetId) => {
      const spec = clips[assetId];
      if (!spec) return null;
      return {
        kind: 'audio',
        loadMode: 'decode',
        gain: spec.gain ?? 1,
        forceMono: spec.forceMono ?? false,
      } satisfies AssetSettings;
    },
  };

  const load = async (url: string): Promise<ArrayBuffer> => {
    const assetId = url.replace('asset://', '');
    loads.push(assetId);
    const spec = clips[assetId];
    if (!spec) throw new Error(`no clip ${assetId}`);
    return clipBytes(spec);
  };

  const shared = options.shareCache
    ? new AudioClipCache(context, resolver, {
        load,
        budgetBytes: options.budgetBytes,
        onWarning: (message) => warnings.push(message),
      })
    : undefined;

  const engine = new AudioEngine({
    context,
    resolver,
    maxVoices: options.maxVoices,
    budgetBytes: options.budgetBytes,
    onWarning: (message) => warnings.push(message),
    load,
    // Only when the caller asked, so the default rig keeps the shape an engine
    // has on its own: it made the cache, so it may clear it.
    cache: shared,
  });

  return { context, engine, warnings, loads, cache: shared ?? engineCache(engine) };
}

/**
 * Lets every pending microtask run.
 *
 * `play()` answers before the clip is decoded — deliberately, so a caller always
 * has something to stop — so a test that wants to see the nodes has to let the
 * decode land first.
 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The cache an engine built for itself.
 *
 * Reached through the private field on purpose: exposing it on `AudioEngine`
 * would be production surface that exists for one assertion, and the cache an
 * engine owns is exactly the thing the outside is not meant to hold.
 */
function engineCache(engine: AudioEngine): AudioClipCache {
  return (engine as unknown as { cache: AudioClipCache }).cache;
}
