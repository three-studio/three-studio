import type { AudioBus } from '@three-studio/core';
import type { AudioEngine } from '../audio/AudioEngine';
import type { BusState } from '../audio/AudioMixer';
import type { PlayRequest, VoiceHandle } from '../audio/playback';
import { audioSourcesOn } from '../behaviour/audio';

/**
 * What a script can do to the mix.
 *
 * Two levels, and the split matters. **A source** is a thing an author placed
 * and configured; a script asking it to play is asking for *that* sound, with
 * the volume, the falloff and the bus someone chose in the Inspector — the same
 * contract as `GetComponent<AudioSource>().Play()`. **A clip** is a one-shot with
 * no component behind it: an explosion at a point, a UI click, something with no
 * author-side existence at all.
 *
 * `target` is an entity id, and leaving it out means the entity this script is
 * attached to — the common case by a wide margin, and the one that should be the
 * shortest to write.
 */
export interface AudioApi {
  /** Starts the source on an entity. Restarts it if it is already going. */
  play(target?: string): VoiceHandle | null;
  stop(target?: string, fadeOut?: number): void;
  pause(target?: string): void;
  resume(target?: string): void;
  restart(target?: string): void;
  setVolume(target: string | undefined, volume: number, ramp?: number): void;
  setPitch(target: string | undefined, pitch: number, detune?: number): void;

  /**
   * A clip with no component behind it.
   *
   * `null` when there is no audio at all — a host that handed over no context.
   * Every other refusal comes back as a handle in `'failed'`, so a caller that
   * wants to know when a sound is over can subscribe without a null check.
   */
  playClip(assetId: string, options?: Omit<PlayRequest, 'assetId'>): VoiceHandle | null;

  /** Volume, mute and solo for one bus. `undefined` for a bus that does not exist. */
  bus(name: AudioBus): Readonly<BusState> | undefined;
  setBusVolume(name: AudioBus, volume: number): void;
  setBusMute(name: AudioBus, mute: boolean): void;

  setMasterVolume(volume: number): void;
  stopAll(fadeOut?: number): void;
}

/** The api for one script, bound to the entity it is attached to. */
export function audioApiFor(audio: AudioEngine | null, ownEntityId: string): AudioApi {
  // Every source on the entity, because two are legal — a door that creaks and
  // slams carries one component each — and a script saying "play" means all of
  // them rather than whichever happened to be added first.
  const sourcesOf = (target: string | undefined) =>
    audio === null ? [] : audioSourcesOn(audio, target ?? ownEntityId);

  return {
    play: (target) => {
      let first: VoiceHandle | null = null;
      for (const source of sourcesOf(target)) {
        // Played first, kept second. `first ??= source.play()` reads the same
        // and is not: `??=` short-circuits, so every source after the first one
        // would never have been asked to play at all.
        const voice = source.play();
        first ??= voice;
      }
      return first;
    },
    stop: (target, fadeOut) => {
      for (const source of sourcesOf(target)) source.stop(fadeOut);
    },
    pause: (target) => {
      for (const source of sourcesOf(target)) source.pause();
    },
    resume: (target) => {
      for (const source of sourcesOf(target)) source.resume();
    },
    restart: (target) => {
      for (const source of sourcesOf(target)) {
        source.stop(0);
        source.play();
      }
    },
    setVolume: (target, volume, ramp) => {
      for (const source of sourcesOf(target)) source.setVolume(volume, ramp);
    },
    setPitch: (target, pitch, detune) => {
      for (const source of sourcesOf(target)) source.setPitch(pitch, detune);
    },

    playClip: (assetId, options) => audio?.play({ ...options, assetId }) ?? null,

    bus: (name) => audio?.mixer.state(name),
    setBusVolume: (name, volume) => audio?.mixer.setVolume(name, volume),
    setBusMute: (name, mute) => audio?.mixer.setMute(name, mute),

    setMasterVolume: (volume) => audio?.setMasterVolume(volume),
    stopAll: (fadeOut) => audio?.stopAll(fadeOut),
  };
}
