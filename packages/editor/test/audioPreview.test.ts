import { createAudioSourceEntity, createEmptyScene, type AudioSourceComponent } from '@three-studio/core';
import type { AssetResolver } from '@three-studio/runtime/assets/AssetResolver';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioPreview } from '../src/audio/preview';
import { addEntity, setComponentNestedField } from '../src/commands/sceneCommands';
import { useDocumentStore } from '../src/state/documentStore';
// The runtime's fake, reused rather than copied. It is a hundred lines of
// arithmetic standing in for Web Audio, and a second copy here would drift from
// the first the moment either engine grew a node.
import {
  clipBytes,
  FakeContext,
  type FakeGain,
  type FakeParam,
} from '../../runtime/test/audio/fakeContext';

/*
 * The editor's audition, driven by hand.
 *
 * This file exists because of two bugs that had nothing in common except where
 * they lived. `preview.ts` owns a frame loop, and a frame loop is exactly the
 * kind of thing that keeps working until it silently does not: after a pause and
 * a resume it stopped being scheduled, so the sound went on being audible while
 * never being advanced — never retired, its clip held for the life of the window.
 * Nothing could see that, because the file could not be loaded under node at all:
 * it reached for `AudioContext` and `requestAnimationFrame` directly.
 *
 * So both are parameters now, and the loop is driven a frame at a time below.
 */

const CLIP = 'clip-1';
const DURATION = 4;

/**
 * The mixer builds a root and one gain per bus before any voice exists, so the
 * first voice's own gain is the seventh. Brittle by nature, which is why it is
 * named here — the same convention `runtime/test/audio/voice.test.ts` uses.
 */
const VOICE_GAIN = 6;

const resolver: AssetResolver = {
  url: (assetId) => (assetId === CLIP ? `asset://${assetId}` : null),
  settings: (assetId) =>
    assetId === CLIP ? { kind: 'audio', loadMode: 'decode', gain: 1, forceMono: false } : null,
};

/** Drives the loop by hand, and moves the clock with it. */
class Frames {
  private pending = new Map<number, () => void>();
  private next = 1;

  constructor(private readonly context: FakeContext) {}

  readonly schedule = (callback: () => void): number => {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  };

  readonly cancel = (handle: number): void => {
    this.pending.delete(handle);
  };

  get scheduled(): boolean {
    return this.pending.size > 0;
  }

  /** One frame at 60 Hz: advance the clock, then run what was waiting. */
  run(count = 1): void {
    for (let i = 0; i < count; i++) {
      const due = [...this.pending.values()];
      this.pending.clear();
      this.context.advance(1 / 60);
      for (const callback of due) callback();
    }
  }
}

function harness() {
  const context = new FakeContext();
  const frames = new Frames(context);
  const preview = new AudioPreview({
    context: () => context,
    resolver,
    schedule: frames.schedule,
    cancel: frames.cancel,
  });
  return { context, frames, preview };
}

/** Lets the decode land. `play` answers before the clip has arrived, by design. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  // The audition fetches through the resolver's URL like anything else. There is
  // no server here, so the bytes come from the same little JSON the runtime's
  // fake context knows how to decode.
  globalThis.fetch = (async () => ({
    ok: true,
    arrayBuffer: async () => clipBytes({ duration: DURATION }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the editor audition', () => {
  /*
   * The mixer builds its root before anything else, so the root — the node
   * `setMasterVolume` acts on, and the one that keeps the audition out of the
   * game's mix (ADR-4) — is the first gain the context ever made.
   */
  const ROOT_GAIN = 0;

  it('carries a level set before the engine existed', async () => {
    const { context, preview } = harness();
    // Which is the ordinary case, not an edge: the slider lives in a toolbar
    // that is there from the moment the window opens, and the engine is only
    // built on the first audition. Without the replay, turning auditions down
    // and then playing one plays it at full volume.
    preview.volume = 0.4;
    expect(context.gains).toHaveLength(0);

    preview.playClip(CLIP);
    await flush();

    expect(context.gains[ROOT_GAIN]?.gain.target).toBeCloseTo(0.4);
  });

  it('applies a level set mid-audition without restarting the voice', async () => {
    const { context, frames, preview } = harness();
    preview.playClip(CLIP);
    await flush();
    frames.run(2);

    const sources = context.sources.length;
    preview.volume = 0.25;

    expect(context.gains[ROOT_GAIN]?.gain.target).toBeCloseTo(0.25);
    expect(preview.playing).toBe(true);
    expect(context.sources).toHaveLength(sources);
  });

  /*
   * `setMasterVolume` clamps with `Math.max(0, v)`, and `Math.max(0, NaN)` is
   * `NaN`. A root gain at `NaN` silences everything while every comparison
   * against it answers `false` — the property that made `spatialBlend: NaN` so
   * expensive to find in phase 7. Refused at the boundary, as there.
   */
  it('refuses a level that is not a number', async () => {
    const { context, preview } = harness();
    preview.playClip(CLIP);
    await flush();

    preview.volume = Number.NaN;

    expect(preview.volume).toBe(1);
    expect(context.gains[ROOT_GAIN]?.gain.target).toBe(1);
  });

  it('goes on advancing after a pause and a resume', async () => {
    const { frames, preview } = harness();
    preview.playClip(CLIP);
    await flush();

    frames.run(2);
    expect(preview.playing).toBe(true);

    preview.pause();
    frames.run(1);
    expect(preview.paused).toBe(true);
    // The loop is allowed to stop while paused — there is nothing to advance.
    expect(frames.scheduled).toBe(false);

    preview.resume();
    // And it has to start again, which it did not: the audition stayed audible
    // and was never ticked, so it was never retired and never let go of its clip.
    expect(frames.scheduled).toBe(true);

    frames.run(1);
    expect(preview.playing).toBe(true);
  });

  it('retires the audition when the clip runs out, so the panel stops showing it', async () => {
    const { frames, preview } = harness();
    preview.playClip(CLIP);
    await flush();

    frames.run(2);
    expect(preview.assetId).toBe(CLIP);

    // Four seconds of clip at sixty frames a second, and a little over.
    frames.run(DURATION * 60 + 5);
    expect(preview.playing).toBe(false);
    // What the Project panel reads to decide whether its button says play or
    // stop. Left saying `CLIP` for ever, the row can never be started again.
    expect(preview.assetId).toBeNull();
  });

  it('places the ear where the camera already was, before the first sound', async () => {
    const { context, preview } = harness();
    // The viewport has been calling this since the window opened; the engine is
    // only built on the first audition, so every one of those calls went nowhere.
    preview.setListener([10, 2, -3], [0, 0, -1], [0, 1, 0]);

    preview.playClip(CLIP);
    await flush();

    const listener = context.listener as { positionX: FakeParam; positionY: FakeParam };
    expect(listener.positionX.target).toBe(10);
    expect(listener.positionY.target).toBe(2);
  });

  it('follows the document while it plays, which is what makes a slider audible', async () => {
    const { context, frames, preview } = harness();
    const template = createAudioSourceEntity(CLIP);
    const component = template.components[0] as AudioSourceComponent;
    component.volume = 1;
    component.spatialBlend = 0;
    const entityId = addEntity(template);

    preview.playSource(entityId, component.id, component, null);
    await flush();
    frames.run(1);

    setComponentNestedField(entityId, component.id, ['volume'], 0.25);
    frames.run(1);

    // The voice's own gain, which the mixer's six come before — the same index
    // convention `runtime/test/audio/voice.test.ts` names and for the same
    // reason: it is brittle, so it is written once rather than in each test.
    expect((context.gains[VOICE_GAIN] as FakeGain).gain.target).toBeCloseTo(0.25);
  });

  it('keeps a long fade-in through the frames that follow the document', async () => {
    // The check this replaces was on a list of things only an ear could settle:
    // "a two second fade-in has to sound like two seconds". It does not need an
    // ear. `follow` restates the component's volume once a frame so a slider is
    // audible while it is dragged, and restating a value used to cancel whatever
    // was scheduled on the gain — which is the fade. Sixty frames later the ramp
    // must still be the one `launch` wrote.
    const { context, frames, preview } = harness();
    const template = createAudioSourceEntity(CLIP);
    const component = template.components[0] as AudioSourceComponent;
    component.spatialBlend = 0;
    component.fadeIn = 2;
    component.volume = 1;
    const entityId = addEntity(template);

    preview.playSource(entityId, component.id, component, null);
    await flush();

    const gain = (context.gains[VOICE_GAIN] as FakeGain).gain;
    expect(gain.lastRamp).toEqual({ value: 1, time: 2 });

    frames.run(60);
    expect(gain.lastRamp).toEqual({ value: 1, time: 2 });
  });

  it('hands the clip back when the audition is stopped', async () => {
    const { context, frames, preview } = harness();
    preview.playClip(CLIP);
    await flush();
    frames.run(1);

    preview.stop();
    expect(preview.playing).toBe(false);
    expect(preview.assetId).toBeNull();
    // Taken apart rather than merely silenced. The disconnect and the release of
    // the decoded clip are the same step, so a graph still wired together is a
    // buffer nothing will ever collect.
    expect((context.gains[VOICE_GAIN] as FakeGain).disconnected).toBeGreaterThan(0);
  });
});
