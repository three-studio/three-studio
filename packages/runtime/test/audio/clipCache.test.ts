import type { AssetSettings } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import type { AssetResolver } from '../../src/assets/AssetResolver';
import { AudioClipCache } from '../../src/audio/AudioClipCache';
import { clipBytes, FakeContext } from './fakeContext';

/*
 * The cache is where the web's own constraint lives: a decoded `AudioBuffer` is
 * 32-bit float whatever the file was, so three minutes of stereo is sixty-odd
 * megabytes and the budget has to be counted in bytes rather than in clips.
 *
 * Eight samples is 32 bytes per channel here, which is what lets a budget test
 * use small round numbers instead of allocating megabytes.
 */

interface Spec {
  channels?: number;
  length?: number;
  forceMono?: boolean;
  gain?: number;
  loadMode?: 'decode' | 'stream';
}

function cache(
  clips: Record<string, Spec>,
  options: { budgetBytes?: number; failDecode?: boolean } = {},
): {
  cache: AudioClipCache;
  context: FakeContext;
  loads: string[];
  warnings: string[];
} {
  const context = new FakeContext();
  context.decodeFails = options.failDecode ?? false;
  const loads: string[] = [];
  const warnings: string[] = [];

  const resolver: AssetResolver = {
    url: (assetId) => (assetId in clips ? `asset://${assetId}` : null),
    settings: (assetId) => {
      const spec = clips[assetId];
      if (!spec) return null;
      return {
        kind: 'audio',
        loadMode: spec.loadMode ?? 'decode',
        gain: spec.gain ?? 1,
        forceMono: spec.forceMono ?? false,
      } satisfies AssetSettings;
    },
  };

  return {
    context,
    loads,
    warnings,
    cache: new AudioClipCache(context, resolver, {
      budgetBytes: options.budgetBytes,
      onWarning: (message) => warnings.push(message),
      load: async (url) => {
        const assetId = url.replace('asset://', '');
        loads.push(assetId);
        return clipBytes(clips[assetId] ?? {});
      },
    }),
  };
}

describe('AudioClipCache', () => {
  it('decodes a clip once however many times it is asked for', async () => {
    const { cache: clips, loads } = cache({ step: {} });
    const a = clips.acquire('step');
    const b = clips.acquire('step');
    await Promise.all([a.clip, b.clip]);

    expect(loads).toEqual(['step']);
    expect(clips.size).toBe(1);
  });

  it('keeps a clip nothing is holding, because the next play is two seconds away', async () => {
    const { cache: clips, loads } = cache({ step: {} });
    const held = clips.acquire('step');
    await held.clip;
    held.release();

    const again = clips.acquire('step');
    await again.clip;
    expect(loads).toEqual(['step']);
  });

  it('evicts the least recently used clip once the budget is passed', async () => {
    // Eight mono samples is 32 bytes; two of them do not fit in forty.
    const { cache: clips, loads } = cache({ a: {}, b: {} }, { budgetBytes: 40 });

    const first = clips.acquire('a');
    await first.clip;
    first.release();

    const second = clips.acquire('b');
    await second.clip;
    second.release();

    expect(clips.bytes).toBeLessThanOrEqual(40);
    expect(clips.peek('a')).toBeNull();
    expect(clips.peek('b')).not.toBeNull();

    // And it is a real eviction, not a hidden hit: asking again re-reads.
    const third = clips.acquire('a');
    await third.clip;
    expect(loads).toEqual(['a', 'b', 'a']);
  });

  it('never evicts a clip something is still holding', async () => {
    const { cache: clips } = cache({ a: {}, b: {} }, { budgetBytes: 40 });
    const held = clips.acquire('a');
    await held.clip;

    const other = clips.acquire('b');
    await other.clip;
    other.release();

    expect(clips.peek('a')).not.toBeNull();
  });

  it('downmixes to mono when the asset was imported that way', async () => {
    const { cache: clips } = cache({ music: { channels: 2, forceMono: true } });
    const buffer = await clips.acquire('music').clip;

    expect(buffer?.numberOfChannels).toBe(1);
  });

  it('leaves the channels alone otherwise', async () => {
    const { cache: clips } = cache({ music: { channels: 2 } });
    const buffer = await clips.acquire('music').clip;

    expect(buffer?.numberOfChannels).toBe(2);
  });

  it('answers null and warns once for an asset the project does not have', async () => {
    const { cache: clips, warnings } = cache({});
    expect(await clips.acquire('gone').clip).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('does not retry a file the browser cannot decode', async () => {
    const { cache: clips, loads } = cache({ weird: {} }, { failDecode: true });
    expect(await clips.acquire('weird').clip).toBeNull();
    expect(await clips.acquire('weird').clip).toBeNull();

    // The entry stays, poisoned. The browser will not learn this format before
    // the page reloads, and asking again would fetch the bytes for nothing.
    expect(loads).toEqual(['weird']);
  });

  it('says so when an asset asked to stream and was decoded instead', async () => {
    // The setting has been persisted since the importer was written and is V2 in
    // the runtime (CIBLE §16). Falling back to a decode is right — the sound
    // plays — but it is the opposite of what the asset asked for, and the cost is
    // the whole reason someone chose it: minutes of audio resident rather than
    // streamed. Two documents already claimed this warning existed; it did not.
    const { cache: clips, warnings } = cache({ talk: { loadMode: 'stream' } });
    await clips.acquire('talk').clip;

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('set to stream');
    expect(warnings[0]).toContain('MiB');
  });

  it('says nothing about an asset that asked to be decoded, which is most of them', async () => {
    const { cache: clips, warnings } = cache({ step: {} });
    await clips.acquire('step').clip;

    expect(warnings).toEqual([]);
  });

  it('warns once per asset, not once per play', async () => {
    // `fetchAndDecode` runs once per entry, which is what makes this free. A
    // warning per play would fill the panel with the same line during exactly
    // the moment the panel needs to be readable.
    const { cache: clips, warnings } = cache({ talk: { loadMode: 'stream' } });
    await clips.acquire('talk').clip;
    await clips.acquire('talk').clip;
    await clips.acquire('talk').clip;

    expect(warnings).toHaveLength(1);
  });

  it('forgets a clip on demand, for a file replaced under the same id', async () => {
    const { cache: clips, loads } = cache({ step: {} });
    await clips.acquire('step').clip;
    clips.invalidate('step');
    await clips.acquire('step').clip;

    expect(loads).toEqual(['step', 'step']);
  });
});
