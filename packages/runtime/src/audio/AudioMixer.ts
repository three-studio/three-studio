import { AUDIO_BUSES, type AudioBus } from '@three-studio/core';
import type { AudioContextLike, AudioNodeLike, GainNodeLike } from './AudioContextLike';
import { rampTo } from './param';

/** What an author can do to a bus. */
export interface BusState {
  volume: number;
  mute: boolean;
  solo: boolean;
}

/**
 * One gain node per bus, all under a root, and the root under the destination.
 *
 * Flat on purpose (ADR-3): `AudioBus` is a fixed enum today, and a graph the
 * author has to build buys nothing until there are effects to route through.
 * `'master'` is a bus like the others — the default for a source with no
 * opinion — and **not** the output node. The output node is `root`, which is
 * what `masterVolume` and the mute act on, and what a second mixer on the same
 * context uses to stay independent of this one (ADR-4).
 *
 * The final volume of a sound is a **product**: its own volume, the asset's
 * imported gain, its bus, and the root. Nothing here adds.
 */
export class AudioMixer {
  private readonly root: GainNodeLike;
  private readonly buses = new Map<AudioBus, { input: GainNodeLike; state: BusState }>();
  private masterVolume = 1;
  private masterMuted = false;
  private suspended = false;

  constructor(
    private readonly context: AudioContextLike,
    destination: AudioNodeLike = context.destination,
  ) {
    this.root = context.createGain();
    this.root.connect(destination);

    for (const bus of AUDIO_BUSES) {
      const input = context.createGain();
      input.connect(this.root);
      this.buses.set(bus, { input, state: { volume: 1, mute: false, solo: false } });
    }
  }

  /** Where a voice on this bus connects. Falls back to `master` for an id we do not know. */
  input(bus: AudioBus): GainNodeLike {
    return (this.buses.get(bus) ?? this.buses.get('master'))?.input ?? this.root;
  }

  state(bus: AudioBus): Readonly<BusState> | undefined {
    return this.buses.get(bus)?.state;
  }

  setVolume(bus: AudioBus, volume: number): void {
    const entry = this.buses.get(bus);
    if (!entry) return;
    entry.state.volume = Math.max(0, volume);
    this.applyBuses();
  }

  setMute(bus: AudioBus, mute: boolean): void {
    const entry = this.buses.get(bus);
    if (!entry) return;
    entry.state.mute = mute;
    this.applyBuses();
  }

  /**
   * Solo is a property of the *set*, not of one bus: the moment anything is
   * soloed every bus that is not goes silent. Applied over all of them rather
   * than on the one that changed, because that is the only way the other four
   * find out.
   */
  setSolo(bus: AudioBus, solo: boolean): void {
    const entry = this.buses.get(bus);
    if (!entry) return;
    entry.state.solo = solo;
    this.applyBuses();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, volume);
    this.applyRoot();
  }

  setMasterMute(mute: boolean): void {
    this.masterMuted = mute;
    this.applyRoot();
  }

  /**
   * Silences everything for a reason that is not the author's.
   *
   * A separate flag from `setMasterMute`, and the separation is the whole point:
   * a paused game and a backgrounded tab both go quiet through here, and if they
   * shared the mute a game that had deliberately muted itself would come back
   * unmuted the moment the tab was focused again.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.applyRoot();
  }

  /**
   * What every gain is worth right now, for the debugger and for tests.
   *
   * `root` and the `master` bus are two different numbers and the naming has to
   * keep them apart: the first is the output of the whole mixer, the second is
   * one of the five buses a source can be routed to.
   */
  gains(): { root: number; buses: Record<AudioBus, number> } {
    const soloed = this.anySolo();
    const buses = {} as Record<AudioBus, number>;
    for (const [bus, entry] of this.buses) buses[bus] = this.busGain(entry.state, soloed);
    return { root: this.rootGain(), buses };
  }

  dispose(): void {
    for (const entry of this.buses.values()) entry.input.disconnect();
    this.buses.clear();
    this.root.disconnect();
  }

  private anySolo(): boolean {
    for (const entry of this.buses.values()) if (entry.state.solo) return true;
    return false;
  }

  private busGain(state: BusState | undefined, soloed: boolean): number {
    if (!state) return 0;
    if (state.mute) return 0;
    if (soloed && !state.solo) return 0;
    return state.volume;
  }

  private rootGain(): number {
    return this.masterMuted || this.suspended ? 0 : this.masterVolume;
  }

  private applyBuses(): void {
    const now = this.context.currentTime;
    const soloed = this.anySolo();
    for (const entry of this.buses.values()) {
      rampTo(entry.input.gain, this.busGain(entry.state, soloed), now);
    }
  }

  private applyRoot(): void {
    rampTo(this.root.gain, this.rootGain(), this.context.currentTime);
  }
}
