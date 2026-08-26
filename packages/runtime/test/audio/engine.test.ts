import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import type { AudioContextLike } from '../../src/audio/AudioContextLike';
import { FakeContext, LegacyFakeListener } from './fakeContext';
import { flush, rig } from './rig';

/*
 * The engine, and the ceiling underneath it.
 *
 * The one thing here that is not a runtime assertion is `RealContextFits`: it
 * proves at compile time that a real `AudioContext` satisfies the structural
 * contract. Without it the contract could drift until the day someone tries to
 * construct an engine in a browser, which is exactly the day nobody is looking
 * at a type error.
 */
type RealContextFits = AudioContext extends AudioContextLike ? true : never;
const realContextFits: RealContextFits = true;

describe('AudioContextLike', () => {
  it('is satisfied by the browser`s own AudioContext', () => {
    expect(realContextFits).toBe(true);
  });
});

describe('AudioEngine', () => {
  it('refuses a source with no clip, quietly', async () => {
    const { engine, warnings } = rig();
    const voice = engine.play({ assetId: '' });
    await flush();

    expect(voice.state).toBe('failed');
    expect(engine.voices).toHaveLength(0);
    // A source that was just added has no clip yet. Warning about it once per
    // frame would bury the warnings that mean something.
    expect(warnings).toEqual([]);
  });

  it('says so once when the asset is not in the project', async () => {
    const { engine, warnings } = rig();
    const voice = engine.play({ assetId: 'gone' });
    await flush();

    expect(voice.state).toBe('failed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('gone');
  });

  it('tells a failed voice`s listeners it is over, rather than leaving them waiting', async () => {
    const { engine } = rig();
    const seen: string[] = [];
    const voice = engine.play({ assetId: 'gone' });
    voice.on('ended', () => seen.push('ended'));
    await flush();

    expect(seen).toEqual(['ended']);
  });

  it('places the listener through the parameter form when the browser has one', () => {
    const { context, engine } = rig();
    engine.setListener([1, 2, 3], [0, 0, -1], [0, 1, 0]);

    const listener = context.listener as unknown as {
      positionX: { target: number };
      positionZ: { target: number };
      forwardZ: { target: number };
    };
    expect(listener.positionX.target).toBe(1);
    expect(listener.positionZ.target).toBe(3);
    expect(listener.forwardZ.target).toBe(-1);
  });

  it('falls back to the deprecated setters, the fork three carries too', () => {
    const context = new FakeContext();
    const legacy = new LegacyFakeListener();
    context.listener = legacy;
    const engine = new AudioEngine({ context, resolver: { url: () => null } });

    engine.setListener([4, 5, 6], [0, 0, -1], [0, 1, 0]);
    expect(legacy.position).toEqual([4, 5, 6]);
    expect(legacy.orientation).toEqual([0, 0, -1, 0, 1, 0]);
  });

  it('starts a suspended context once, and does not fight a running one', async () => {
    const { context, engine } = rig();
    context.state = 'suspended';
    await engine.unlock();
    await engine.unlock();

    expect(context.resumed).toBe(1);
    expect(context.state).toBe('running');
  });

  it('resumes an interrupted context too, which is what iOS leaves behind', async () => {
    const { context, engine } = rig();
    // Not `'suspended'`. A phone call, Siri or the ringer switch puts a context
    // here, and code that only tests for `'suspended'` leaves the device silent
    // for the rest of the session.
    context.state = 'interrupted';
    await engine.unlock();

    expect(context.resumed).toBe(1);
    expect(context.state).toBe('running');
  });

  it('goes silent when suspended without touching the shared context', () => {
    const { context, engine } = rig();
    engine.setSuspended(true);

    expect(engine.mixer.gains().root).toBe(0);
    // The context is shared with the editor's preview: suspending it would take
    // that down too.
    expect(context.state).toBe('running');

    engine.setSuspended(false);
    expect(engine.mixer.gains().root).toBe(1);
  });

  it('does not undo a mute the game asked for when the tab comes back', () => {
    // Pausing and backgrounding go through `setSuspended`; a settings screen
    // goes through `setMasterMute`. Sharing one flag between them means a player
    // who muted the game hears it again the moment they switch tabs and back.
    const { engine } = rig();
    engine.setMasterMute(true);

    engine.setSuspended(true);
    expect(engine.mixer.gains().root).toBe(0);

    engine.setSuspended(false);
    expect(engine.mixer.gains().root).toBe(0);

    engine.setMasterMute(false);
    expect(engine.mixer.gains().root).toBe(1);
  });

  it('stops everything it owns when it is disposed', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    engine.play({ assetId: 'step' });
    await flush();
    expect(engine.voices).toHaveLength(1);

    engine.dispose();
    expect(engine.voices).toHaveLength(0);
    expect(engine.play({ assetId: 'step' }).state).toBe('failed');
  });
});

describe('the voice ceiling', () => {
  it('admits everything under the ceiling', async () => {
    const { engine } = rig({ step: { duration: 10 } }, { maxVoices: 3 });
    for (let i = 0; i < 3; i++) engine.play({ assetId: 'step' });
    await flush();

    expect(engine.voices).toHaveLength(3);
  });

  it('steals the least important voice when the ceiling is reached', async () => {
    const { engine } = rig({ step: { duration: 10 } }, { maxVoices: 2 });
    const important = engine.play({ assetId: 'step', priority: 0 });
    const throwaway = engine.play({ assetId: 'step', priority: 200 });
    await flush();

    const newcomer = engine.play({ assetId: 'step', priority: 10 });
    await flush();

    expect(throwaway.state).toBe('stopped');
    expect(important.state).toBe('playing');
    expect(newcomer.state).toBe('playing');
    expect(engine.voices).toHaveLength(2);
  });

  it('refuses a newcomer that matters less than everything already playing', async () => {
    const { engine } = rig({ step: { duration: 10 } }, { maxVoices: 2 });
    engine.play({ assetId: 'step', priority: 0 });
    engine.play({ assetId: 'step', priority: 0 });
    await flush();

    const refused = engine.play({ assetId: 'step', priority: 100 });
    await flush();

    expect(refused.state).toBe('failed');
    expect(engine.voices).toHaveLength(2);
  });

  it('takes the oldest of two voices that matter the same', async () => {
    const { context, engine } = rig({ step: { duration: 10 } }, { maxVoices: 2 });
    const first = engine.play({ assetId: 'step', priority: 50 });
    await flush();
    context.advance(1);
    const second = engine.play({ assetId: 'step', priority: 50 });
    await flush();

    engine.play({ assetId: 'step', priority: 50 });
    await flush();

    expect(first.state).toBe('stopped');
    expect(second.state).toBe('playing');
  });

  it('costs nothing at all when it refuses', async () => {
    const { context, engine } = rig({ step: { duration: 10 } }, { maxVoices: 1 });
    engine.play({ assetId: 'step', priority: 0 });
    await flush();
    const sourcesBefore = context.sources.length;

    engine.play({ assetId: 'step', priority: 99 });
    await flush();

    expect(context.sources).toHaveLength(sourcesBefore);
  });
});
