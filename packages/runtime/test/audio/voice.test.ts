import { describe, expect, it } from 'vitest';
import type { FakeGain } from './fakeContext';
import { flush, rig } from './rig';

/*
 * A voice is where the two things Web Audio cannot do on its own are done: a
 * continuous `spatialBlend`, and a playback that can be paused.
 *
 * The gain nodes a voice builds arrive after the mixer's six, so `gains[6]` is
 * the first voice's own gain and `gains[7]` its dry branch. That is brittle by
 * nature and it is why the helpers below name them rather than the tests.
 */

const VOICE_GAIN = 6;
const DRY_GAIN = 7;

function gain(context: { gains: FakeGain[] }, index: number): number {
  return (context.gains[index] as FakeGain).gain.target;
}

describe('Voice', () => {
  it('multiplies the asked-for volume by the gain the asset was imported at', async () => {
    const { context, engine } = rig({ step: { duration: 1, gain: 0.5 } });
    engine.play({ assetId: 'step', volume: 0.4 });
    await flush();

    expect(gain(context, VOICE_GAIN)).toBeCloseTo(0.2);
  });

  it('builds no panner at all for a flat sound', async () => {
    const { context, engine } = rig();
    engine.play({ assetId: 'step' });
    await flush();

    expect(context.panners).toHaveLength(0);
    expect(gain(context, DRY_GAIN)).toBe(1);
  });

  it('builds the panner on the first blend that needs one', async () => {
    const { context, engine } = rig();
    const voice = engine.play({ assetId: 'step' });
    await flush();
    expect(context.panners).toHaveLength(0);

    voice.setSpatial({
      blend: 1,
      distanceModel: 'inverse',
      refDistance: 2,
      maxDistance: 40,
      rolloffFactor: 1,
      coneInnerAngle: 360,
      coneOuterAngle: 360,
      coneOuterGain: 0,
      position: [1, 2, 3],
      forward: [0, 0, -1],
    });

    expect(context.panners).toHaveLength(1);
    const panner = context.panners[0];
    expect(panner?.refDistance).toBe(2);
    expect(panner?.maxDistance).toBe(40);
    expect(panner?.positionX.target).toBe(1);
    expect(panner?.positionZ.target).toBe(3);
  });

  it('crossfades the two branches linearly, so the amplitude stays flat', async () => {
    const { context, engine } = rig();
    engine.play({
      assetId: 'step',
      spatial: {
        blend: 0.25,
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 50,
        rolloffFactor: 1,
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0,
        position: [0, 0, 0],
        forward: [0, 0, -1],
      },
    });
    await flush();

    // Dry and wet carry the same signal, so they add coherently: an equal-power
    // pair would put 3 dB in the middle of the slider. These two sum to one.
    const dry = gain(context, DRY_GAIN);
    const wet = (context.gains.at(-1) as FakeGain).gain.target;
    expect(dry).toBeCloseTo(0.75);
    expect(wet).toBeCloseTo(0.25);
    expect(dry + wet).toBeCloseTo(1);
  });

  it('ends when the buffer runs out, and never while looping', async () => {
    const { context, engine } = rig({ step: { duration: 2 } });
    const once = engine.play({ assetId: 'step' });
    const forever = engine.play({ assetId: 'step', loop: true });
    await flush();

    context.advance(1);
    engine.update();
    expect(once.state).toBe('playing');

    context.advance(1.5);
    engine.update();
    expect(once.state).toBe('stopped');
    expect(forever.state).toBe('playing');
    expect(engine.voices).toHaveLength(1);
  });

  it('ends sooner at a higher rate, because the buffer is consumed faster', async () => {
    const { context, engine } = rig({ step: { duration: 2 } });
    const voice = engine.play({ assetId: 'step', pitch: 2 });
    await flush();

    context.advance(1.1);
    engine.update();
    expect(voice.state).toBe('stopped');
  });

  it('reports how far in it is, and keeps that across a pause', async () => {
    const { context, engine } = rig({ step: { duration: 4 } });
    const voice = engine.play({ assetId: 'step' });
    await flush();

    context.advance(1.5);
    expect(voice.elapsed).toBeCloseTo(1.5);

    voice.pause();
    context.advance(10);
    expect(voice.state).toBe('paused');
    expect(voice.elapsed).toBeCloseTo(1.5);

    voice.resume();
    context.advance(0.5);
    expect(voice.elapsed).toBeCloseTo(2);
    // Resuming starts a second source node from where the first stopped.
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1]?.started?.offset).toBeCloseTo(1.5);
  });

  it('stays alive for the length of its fade out, then ends', async () => {
    const { context, engine } = rig({ step: { duration: 10 } });
    const voice = engine.play({ assetId: 'step' });
    await flush();

    voice.stop(0.5);
    engine.update();
    expect(engine.voices).toHaveLength(1);

    context.advance(0.6);
    engine.update();
    expect(engine.voices).toHaveLength(0);
    expect(voice.state).toBe('stopped');
  });

  it('never starts when it is stopped while the clip is still decoding', async () => {
    const { context, engine } = rig();
    const voice = engine.play({ assetId: 'step' });
    voice.stop();
    await flush();

    expect(voice.state).toBe('stopped');
    expect(context.sources).toHaveLength(0);
    // And the pool lets go of it. This line is the one that matters: the two
    // above passed for the whole of the first chantier while the voice sat in
    // the pool for ever, holding a slot and a clip reference. A test that only
    // asks an object about itself cannot see that.
    engine.update();
    expect(engine.voices).toHaveLength(0);
  });

  it('keeps a fade-in that a volume nobody changed would otherwise wipe', async () => {
    const { context, engine } = rig({ step: { duration: 10 } });
    const voice = engine.play({ assetId: 'step', volume: 0.8, fadeIn: 2 });
    await flush();
    const gain = context.gains[VOICE_GAIN] as FakeGain;
    expect(gain.gain.lastRamp).toEqual({ value: 0.8, time: 2 });

    // What the editor's preview does on every frame so that dragging a slider
    // is audible. Handing back the value that is already set must cost nothing:
    // `rampTo` cancels whatever was scheduled, so a fade-in of two seconds
    // became one of twenty milliseconds on the very next frame.
    context.advance(0.016);
    voice.setVolume(0.8);

    expect(gain.gain.lastRamp).toEqual({ value: 0.8, time: 2 });
  });

  it('lets an explicit volume change win over a fade that is still running', async () => {
    const { context, engine } = rig({ step: { duration: 10 } });
    const voice = engine.play({ assetId: 'step', volume: 0.8, fadeIn: 2 });
    await flush();

    context.advance(0.016);
    voice.setVolume(0.2);

    // The other half of the rule above: someone who *asks* for a new volume
    // gets it, fade or no fade. Only the write that changes nothing is free.
    expect((context.gains[VOICE_GAIN] as FakeGain).gain.lastRamp?.value).toBeCloseTo(0.2);
  });

  it('does not cut a delayed sound short when the pitch has not moved', async () => {
    const { context, engine } = rig({ step: { duration: 3 } });
    const voice = engine.play({ assetId: 'step', delay: 2, pitch: 1 });
    await flush();

    // Audible from t=2 to t=5. A frame of the preview lands during the delay and
    // re-baselines the clock, which used to move the end back by the whole delay
    // and stop the voice at t=3 — with two seconds of it still to play.
    context.advance(0.016);
    voice.setPitch(1, 0);

    context.advance(3.2);
    engine.update();
    expect(voice.state).toBe('playing');

    context.advance(2);
    engine.update();
    expect(voice.state).toBe('stopped');
  });

  it('starts at an offset and after a delay when it is asked to', async () => {
    const { context, engine } = rig({ step: { duration: 10 } });
    engine.play({ assetId: 'step', startOffset: 3, delay: 0.25 });
    await flush();

    expect(context.sources[0]?.started).toEqual({ when: 0.25, offset: 3 });
  });

  it('tells its listeners it started, and tells them once it is over', async () => {
    const { context, engine } = rig({ step: { duration: 1 } });
    const seen: string[] = [];
    const voice = engine.play({ assetId: 'step' });
    voice.on('started', () => seen.push('started'));
    voice.on('ended', () => seen.push('ended'));
    await flush();

    expect(seen).toEqual(['started']);
    context.advance(1.1);
    engine.update();
    expect(seen).toEqual(['started', 'ended']);
  });
});
