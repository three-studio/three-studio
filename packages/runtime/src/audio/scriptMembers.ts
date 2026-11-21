import { fixedId, isAssetId, isEntityId, type AudioBus, type EntityId } from '@three-studio/core';
import { audioSourcesOn } from '../behaviour/audio';
import type { ScriptMembersDefinition } from '../scripting/members';
import type { AudioEngine } from './AudioEngine';
import type { BusState } from './AudioMixer';
import { audioOf } from './audioOf';
import type { PlayRequest, VoiceHandle } from './playback';

/*
 * What audio gives every script: `this.audio`. A contribution, installed by
 * the script host, which names no audio: the member is typed on every
 * `Behaviour` by the augmentation below, and published by the line beside it.
 */

/** Audio's member of a script. */
export interface AudioScriptMembers {
  /**
   * The mix: this entity's own sounds, one-shot clips, and the buses.
   *
   * Present even when the host handed over no audio context — every method is
   * then a no-op — so a script never has to ask whether sound exists before
   * asking for it.
   */
  readonly audio: AudioApi;
}

declare module '../scripting/ScriptApi' {
  interface ScriptMembers extends AudioScriptMembers {}
}

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
   * `null` when there is no audio at all — a host that handed over no context —
   * and for an `assetId` that is not one. Every other refusal comes back as a
   * handle in `'failed'`, so a caller that wants to know when a sound is over
   * can subscribe without a null check.
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
export function audioApiFor(audio: AudioEngine | null, ownEntityId: EntityId): AudioApi {
  // Every source on the entity, because two are legal — a door that creaks and
  // slams carries one component each — and a script saying "play" means all of
  // them rather than whichever happened to be added first. A target is text a
  // script passes, read as an id: one that is none names no entity, and has no
  // sources.
  const sourcesOf = (target: string | undefined) => {
    const entityId = target ?? ownEntityId;
    return audio === null || !isEntityId(entityId) ? [] : audioSourcesOn(audio, entityId);
  };

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

    playClip: (assetId, options) => {
      // A script is not typechecked: what it passes is whatever it made of a
      // value, and it is the engine's id check that says whether it is a clip.
      if (audio === null || !isAssetId(assetId)) return null;
      return audio.play({ ...options, assetId });
    },

    bus: (name) => audio?.mixer.state(name),
    setBusVolume: (name, volume) => audio?.mixer.setVolume(name, volume),
    setBusMute: (name, mute) => audio?.mixer.setMute(name, mute),

    setMasterVolume: (volume) => audio?.setMasterVolume(volume),
    stopAll: (fadeOut) => audio?.stopAll(fadeOut),
  };
}

/** Audio's line of the published `Behaviour`: a member added above and not published here does not compile. */
const MEMBERS: Record<keyof AudioScriptMembers, string> = {
  audio: `
    /** This entity's sounds, one-shot clips, and the buses. */
    readonly audio: StudioAudio;`,
};

/** The types audio's line names, as a script sees them. */
const TYPES = `  export type AudioBus = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

  /** A playing sound. Every method is safe to call after it has finished. */
  export interface AudioVoice {
    readonly state: 'pending' | 'playing' | 'paused' | 'stopped' | 'failed';
    /** Seconds advanced through the clip, loops included. */
    readonly elapsed: number;
    stop(fadeOut?: number): void;
    pause(): void;
    resume(): void;
    setVolume(volume: number, ramp?: number): void;
    setPitch(pitch: number, detune?: number): void;
    /** \`'ended'\` covers every way a sound can finish. Returns an unsubscribe. */
    on(event: 'started' | 'ended' | 'failed', listener: () => void): () => void;
  }

  export interface AudioClipOptions {
    bus?: AudioBus;
    volume?: number;
    pitch?: number;
    detune?: number;
    loop?: boolean;
    startOffset?: number;
    delay?: number;
    fadeIn?: number;
    /** 0 is the highest. Decides who is dropped when too many sounds play. */
    priority?: number;
  }

  export interface StudioAudio {
    /**
     * Plays the Audio Source on an entity, with everything the Inspector says
     * about it. Leaving \`target\` out means this script's own entity.
     *
     * A source that is already playing restarts rather than doubling up.
     */
    play(target?: string): AudioVoice | null;
    stop(target?: string, fadeOut?: number): void;
    pause(target?: string): void;
    resume(target?: string): void;
    restart(target?: string): void;
    setVolume(target: string | undefined, volume: number, ramp?: number): void;
    setPitch(target: string | undefined, pitch: number, detune?: number): void;

    /** A one-shot with no component behind it — an explosion, a UI click. */
    playClip(assetId: string, options?: AudioClipOptions): AudioVoice | null;

    bus(name: AudioBus): { volume: number; mute: boolean; solo: boolean } | undefined;
    setBusVolume(name: AudioBus, volume: number): void;
    setBusMute(name: AudioBus, mute: boolean): void;
    setMasterVolume(volume: number): void;
    stopAll(fadeOut?: number): void;
  }`;

/**
 * Audio's contribution to every script: its mix, bound to the script's entity
 * so that `this.audio.play()` with no argument means "my own sound" — the case
 * a script wants ninety per cent of the time and the one that should be
 * shortest to write.
 */
export const audioScriptMembers: ScriptMembersDefinition = {
  id: fixedId('scriptMembers', 'audio'),
  members: MEMBERS,
  types: TYPES,
  install({ script, entity, world }) {
    const given: AudioScriptMembers = { audio: audioApiFor(audioOf(world), entity.id) };
    Object.assign(script, given);
    return { dispose() {} };
  },
};
