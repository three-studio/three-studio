import { AUDIO_BUSES } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { AudioMixer } from '../../src/audio/AudioMixer';
import { FakeContext, type FakeGain } from './fakeContext';

/*
 * The mixer is five gain nodes and a root, and everything worth asserting about
 * it is a number: what a bus is worth once it is muted, what the other four are
 * worth once one of them is soloed, and that the root is not the `master` bus.
 *
 * That distinction is the one a reader gets wrong first. `master` is a bus a
 * source can be routed to, like `sfx`. The root is the output of the whole
 * mixer, and it is what `masterVolume` acts on.
 */

function mixer(): { context: FakeContext; mixer: AudioMixer; nodeGain: (index: number) => number } {
  const context = new FakeContext();
  const built = new AudioMixer(context);
  return {
    context,
    mixer: built,
    nodeGain: (index) => (context.gains[index] as FakeGain).gain.target,
  };
}

describe('AudioMixer', () => {
  it('builds one gain per bus, all under a root that reaches the destination', () => {
    const { context } = mixer();
    // The root, then one per bus.
    expect(context.gains).toHaveLength(1 + AUDIO_BUSES.length);
    const root = context.gains[0] as FakeGain;
    expect(root.outputs.has(context.destination)).toBe(true);
    for (const bus of context.gains.slice(1)) expect(bus.outputs.has(root)).toBe(true);
  });

  it('routes an unknown bus id to master rather than dropping the sound', () => {
    const { mixer: built } = mixer();
    expect(built.input('nowhere' as never)).toBe(built.input('master'));
  });

  it('mutes a bus without forgetting the volume it had', () => {
    const { mixer: built } = mixer();
    built.setVolume('music', 0.4);
    built.setMute('music', true);
    expect(built.gains().buses.music).toBe(0);

    built.setMute('music', false);
    expect(built.gains().buses.music).toBe(0.4);
  });

  it('silences every bus that is not soloed, and only while something is', () => {
    const { mixer: built } = mixer();
    built.setVolume('sfx', 0.5);
    built.setSolo('music', true);

    expect(built.gains().buses.music).toBe(1);
    expect(built.gains().buses.sfx).toBe(0);
    expect(built.gains().buses.ui).toBe(0);

    built.setSolo('music', false);
    expect(built.gains().buses.sfx).toBe(0.5);
  });

  it('keeps the root and the master bus apart', () => {
    const { mixer: built } = mixer();
    built.setMasterVolume(0.25);
    built.setVolume('master', 0.5);

    const gains = built.gains();
    expect(gains.root).toBe(0.25);
    expect(gains.buses.master).toBe(0.5);
  });

  it('writes the numbers onto the nodes, not just into its own bookkeeping', () => {
    const { mixer: built, nodeGain } = mixer();
    built.setMasterVolume(0.25);
    built.setVolume('music', 0.4);
    built.setMute('sfx', true);

    expect(nodeGain(0)).toBe(0.25); // root
    expect(nodeGain(2)).toBe(0.4); // music, second bus after master
    expect(nodeGain(3)).toBe(0); // sfx
  });

  it('mutes the root without touching any bus', () => {
    const { mixer: built } = mixer();
    built.setVolume('music', 0.8);
    built.setMasterMute(true);

    expect(built.gains().root).toBe(0);
    expect(built.gains().buses.music).toBe(0.8);
  });
});
