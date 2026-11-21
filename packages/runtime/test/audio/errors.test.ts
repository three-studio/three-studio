import { audioSourceType, createEntity, createRenderingSettings, fixedId } from '@three-studio/core';
import { Group } from 'three/webgpu';
import { describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { AssetCache } from '../../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { audioSourceBehaviour, audioSourceOn } from '../../src/behaviour/audio';
import { World } from '../../src/world/World';
import { builtInRegistries, withoutPhysics } from '../registries';
import { FakeContext } from './fakeContext';
import { flush, rig } from './rig';
import { StudioTime } from '../../src/time/StudioTime';

/*
 * The eleven ways audio can go wrong, walked one at a time, under the one rule
 * that matters: **no audio error may take the runtime or the editor down**. The
 * pattern is `ScriptHost.guard` — one warning, once, and the source goes quiet
 * — so most of these assert two things: that the failure is contained, and that
 * it is *reported once* rather than every frame.
 *
 * Kept together rather than scattered through the files that own each piece,
 * because this is a checklist. A reader asking "what happens when the file is
 * corrupt" should find the answer in one place.
 */

const STEP = fixedId('asset', 'step');
const GONE = fixedId('asset', 'gone');
const WEIRD = fixedId('asset', 'weird');

const source = (overrides = {}) => ({ ...audioSourceType.create(), assetId: STEP, ...overrides });

const target = (overrides = {}) => ({
  entity: createEntity('noise').entity,
  object: new Group(),
  component: source(overrides),
});

function mount(audio: AudioEngine, overrides = {}) {
  return audioSourceOn(audio, target(overrides));
}

describe('nothing here may bring anything down', () => {
  it('a missing asset: one warning, a failed handle, no voice', async () => {
    const { engine, warnings } = rig();
    const voice = engine.play({ assetId: GONE });
    await flush();
    // A voice was built before anyone knew the file was missing, so it is
    // retired on the next tick like any other finished one.
    engine.update();

    expect(voice.state).toBe('failed');
    expect(engine.voices).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it('a file the browser cannot decode: one warning, and it is not retried', async () => {
    const { context, engine, warnings } = rig({ weird: {} });
    context.decodeFails = true;

    engine.play({ assetId: WEIRD });
    await flush();
    engine.play({ assetId: WEIRD });
    await flush();

    // Poisoned after the first attempt. The browser will not learn this format
    // before the page reloads, and a warning per play would bury everything.
    expect(warnings).toHaveLength(1);
  });

  it('no audio context at all: the component is inert, not broken', async () => {
    // A host that handed nothing over, or a browser with no Web Audio. The
    // behaviour declines to build, so nothing throws once a frame.
    const registries = builtInRegistries();
    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([]),
      registries: withoutPhysics(registries),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
    });
    onTestFinished(() => world.dispose());

    expect(audioSourceBehaviour.create(target(), world)).toBeNull();
  });

  it('a suspended context: the sound is queued, and unlock starts it', async () => {
    const { context, engine } = rig({ step: { duration: 5 } });
    context.state = 'suspended';

    const voice = engine.play({ assetId: STEP });
    await flush();
    // Playing as far as the graph is concerned; silent until the context runs.
    expect(voice.state).toBe('playing');

    await engine.unlock();
    expect(context.state).toBe('running');
  });

  it('a source deleted mid-play: its voice goes with it', async () => {
    const { engine } = rig({ step: { duration: 60 } });
    const behaviour = mount(engine, { playOnStart: true });
    behaviour?.start?.();
    await flush();
    expect(engine.voices).toHaveLength(1);

    behaviour?.dispose?.();
    engine.update();
    expect(engine.voices).toHaveLength(0);
  });

  it('an asset replaced mid-play: the voice finishes on what it holds', async () => {
    const { engine, loads } = rig({ step: { duration: 60 } });
    const voice = engine.play({ assetId: STEP });
    await flush();

    engine.invalidate(STEP);
    // A gap would be worse than an old sound: the voice keeps the buffer it
    // already has, and only the *next* play reads the file again.
    expect(voice.state).toBe('playing');

    engine.play({ assetId: STEP });
    await flush();
    expect(loads).toEqual(['step', 'step']);
  });

  it('the scene is left: everything it started stops', async () => {
    const { engine } = rig({ step: { duration: 60 } });
    const behaviour = mount(engine, { playOnStart: true });
    behaviour?.start?.();
    await flush();

    behaviour?.onSceneUnload?.();
    engine.update();
    expect(engine.voices).toHaveLength(0);
  });

  it('the runtime stops: disposing twice is as safe as once', async () => {
    const { engine } = rig({ step: { duration: 60 } });
    engine.play({ assetId: STEP });
    await flush();

    expect(() => {
      engine.dispose();
      engine.dispose();
      engine.update();
      engine.stopAll();
      engine.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]);
    }).not.toThrow();
    expect(engine.play({ assetId: STEP }).state).toBe('failed');
  });

  it('no voices left: a failed handle, and deliberately no warning', async () => {
    // A ceiling being reached is a normal regime, not a fault. Warning about it
    // would fill the panel during exactly the moment — a firefight — when the
    // panel needs to be readable.
    const { engine, warnings } = rig({ step: { duration: 60 } }, { maxVoices: 1 });
    engine.play({ assetId: STEP, priority: 0 });
    await flush();

    expect(engine.play({ assetId: STEP, priority: 200 }).state).toBe('failed');
    expect(warnings).toEqual([]);
  });

  it('sounds cancelled while they decoded do not close the ceiling behind them', async () => {
    // Every restart cancels the voice it replaces, and a source restarted twice
    // before its file has decoded cancels two voices that never made a node. If
    // those keep their slot the ceiling closes for good, and it closes *silently*
    // — the pool refuses, which is not a fault, so nothing is reported.
    const { engine } = rig({ step: { duration: 10 } }, { maxVoices: 2 });
    for (let i = 0; i < 5; i++) engine.play({ assetId: STEP, priority: 0 }).stop(0);
    await flush();
    engine.update();

    expect(engine.voices).toHaveLength(0);
    expect(engine.play({ assetId: STEP, priority: 128 }).state).not.toBe('failed');
  });

  it('a voice still fading when the engine goes hands its clip back', async () => {
    // The scene is left, sources stop with the fade-out they were authored with,
    // and the engine is disposed before the fade is over. The cache is the
    // host's — `SceneHost` shares one across scenes — so a reference left behind
    // here is never collected: `evict` only ever drops what nothing holds.
    const { engine, cache } = rig(
      { step: { duration: 30 } },
      { budgetBytes: 0, shareCache: true },
    );

    engine.play({ assetId: STEP });
    await flush();
    expect(cache.size).toBe(1);

    engine.stopAll(4);
    engine.dispose();

    // Budget zero, so anything nothing holds goes at once. Still here means the
    // reference never came back.
    expect(cache.size).toBe(0);
  });

  it('a handle outlives its sound: every method is a no-op', async () => {
    const { context, engine } = rig({ step: { duration: 1 } });
    const voice = engine.play({ assetId: STEP });
    await flush();

    context.advance(2);
    engine.update();
    expect(voice.state).toBe('stopped');

    expect(() => {
      voice.stop();
      voice.pause();
      voice.resume();
      voice.setVolume(1);
      voice.setPitch(2);
      voice.setSpatial(null);
    }).not.toThrow();
  });

  it('an empty clip field: refused in silence, because it is not a fault', async () => {
    // The normal state of a source that was just added. Warning per frame about
    // a field nobody has filled in yet is how a warning panel stops being read.
    const { engine, warnings } = rig();
    expect(engine.play({ assetId: null }).state).toBe('failed');
    expect(warnings).toEqual([]);
  });

  it('a context that never starts: unlock reports it and carries on', async () => {
    const context = new FakeContext();
    context.state = 'suspended';
    context.resume = () => Promise.reject(new Error('user gesture required'));
    const warnings: string[] = [];
    const engine = new AudioEngine({
      context,
      resolver: { url: () => null },
      onWarning: (message) => warnings.push(message),
    });

    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('could not be started');
  });
});
