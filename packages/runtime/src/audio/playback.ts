import type { AudioBus } from '@three-studio/core';

/**
 * A position or a direction, as three plain numbers.
 *
 * Not `Vector3`, and that is the point: nothing under `src/audio` imports three.
 * The behaviour reads `object.matrixWorld` and hands the numbers over, so the
 * engine can be loaded and tested without instantiating a renderer, and the day
 * the view layer changes the mixer does not move.
 */
export type Vec3Tuple = readonly [number, number, number];

/** Where a sound is, and how it fades with distance. */
export interface SpatialRequest {
  /** `0` is fully flat, `1` fully positional. Unity's dial. */
  blend: number;
  distanceModel: 'linear' | 'inverse' | 'exponential';
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  position: Vec3Tuple;
  /** Which way the cone points. Ignored when the cone is omnidirectional. */
  forward: Vec3Tuple;
}

export interface PlayRequest {
  assetId: string;
  bus?: AudioBus;
  /** Multiplied by the asset's own imported gain, and by the bus chain. */
  volume?: number;
  /** Playback rate. Shifts pitch with it, as in every engine's simple mode. */
  pitch?: number;
  /** Cents, composed with `pitch`: rate = pitch × 2^(detune / 1200). */
  detune?: number;
  loop?: boolean;
  /** Second of the buffer the first pass starts at. Loops restart at zero. */
  startOffset?: number;
  /** Seconds to wait before the first sample. */
  delay?: number;
  fadeIn?: number;
  /** `0` is the highest, as in Unity. Decides who gets stolen at the ceiling. */
  priority?: number;
  /** Absent or `null` means a flat sound with no panner at all. */
  spatial?: SpatialRequest | null;
}

/**
 * Where a voice is.
 *
 * `'pending'` is the interesting one: `play()` answers before the file is
 * decoded, so a caller always has something to hold and to stop. A voice that
 * is stopped while pending never starts.
 */
export type VoiceState = 'pending' | 'playing' | 'paused' | 'stopped' | 'failed';

export interface VoiceHandle {
  readonly id: number;
  readonly assetId: string;
  readonly state: VoiceState;
  /** Seconds advanced through the buffer, loops included. */
  readonly elapsed: number;
  /** Volume before the bus chain, as asked for — not what comes out. */
  readonly volume: number;
  readonly priority: number;
  stop(fadeOut?: number): void;
  pause(): void;
  resume(): void;
  setVolume(volume: number, ramp?: number): void;
  setPitch(pitch: number, detune?: number): void;
  setSpatial(spatial: SpatialRequest | null): void;
  /**
   * `'ended'` covers every way a voice can finish — the buffer ran out, someone
   * stopped it, or the pool stole it. A listener that has to tell them apart is
   * asking the wrong object; the caller knows whether it called `stop`.
   *
   * @returns A function that unsubscribes.
   */
  on(event: VoiceEvent, listener: () => void): () => void;
}

export type VoiceEvent = 'started' | 'ended' | 'failed';

/** A handle for a sound that was never going to play. */
export function failedVoice(id: number, assetId: string): VoiceHandle {
  const noop = (): void => {};
  return {
    id,
    assetId,
    state: 'failed',
    elapsed: 0,
    volume: 0,
    priority: Number.MAX_SAFE_INTEGER,
    stop: noop,
    pause: noop,
    resume: noop,
    setVolume: noop,
    setPitch: noop,
    setSpatial: noop,
    // Called synchronously rather than dropped: a caller that only wants to
    // know when the sound is over should hear back even when it never began.
    on: (event, listener) => {
      if (event === 'failed' || event === 'ended') listener();
      return noop;
    },
  };
}
