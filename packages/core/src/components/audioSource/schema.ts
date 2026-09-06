import type { ComponentBase } from '../../scene/primitives';

/**
 * Mixer buses, borrowed from Unreal's sound classes: a shallow, fixed set is
 * enough to duck music under dialogue or mute effects, and it keeps every
 * source's routing to a single enum rather than a graph the author must build.
 */
export type AudioBus = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

/** One name per bus, in the order the Inspector offers them. */
export const AUDIO_BUS_LABELS: Record<AudioBus, string> = {
  master: 'Master',
  music: 'Music',
  sfx: 'SFX',
  ui: 'UI',
  ambience: 'Ambience',
};

/**
 * The same set, as a value, because the mixer has to build one gain node per bus
 * and a type cannot be iterated.
 *
 * Read off the labels rather than written again. It used to be an array of its
 * own under `satisfies readonly AudioBus[]`, with a comment claiming that made a
 * missing bus a compile error — it does not. `satisfies` checks that every
 * element *is* an `AudioBus`, never that every `AudioBus` is an element, so the
 * list could quietly lose one and the mixer would build one fewer gain node. A
 * total `Record` is the check that comment wanted; the cast is `Object.keys`
 * returning `string[]`, and nothing more.
 */
export const AUDIO_BUSES = Object.keys(AUDIO_BUS_LABELS) as readonly AudioBus[];

/** Web Audio's own falloff curves, under the names three and the spec use. */
export type DistanceModel = 'linear' | 'inverse' | 'exponential';

export const DISTANCE_MODEL_LABELS: Record<DistanceModel, string> = {
  inverse: 'Inverse',
  linear: 'Linear',
  exponential: 'Exponential',
};

export interface AudioSourceComponent extends ComponentBase {
  type: 'audioSource';
  assetId: string;
  /**
   * `0` is fully 2D (music, UI), `1` fully positional. Unity's model — a single
   * dial is far easier to reason about than two separate node paths, and it
   * lets a sound be pulled toward the listener without losing its position.
   */
  spatialBlend: number;
  volume: number;
  /** Playback rate; also shifts pitch, as in every engine's simple mode. */
  pitch: number;
  loop: boolean;
  playOnStart: boolean;
  bus: AudioBus;

  /** Web Audio `PannerNode` falloff, used when `spatialBlend > 0`. */
  distanceModel: DistanceModel;
  /** Distance at which the sound is at full volume. */
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;

  /** Directional cone; `360` inner angle means omnidirectional. */
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;

  /** Silences the source without losing the volume it was set to. */
  mute: boolean;
  /**
   * Cents, composed with `pitch`: rate = pitch × 2^(detune / 1200).
   *
   * Both are exposed because Web Audio exposes both, and they are not the same
   * control to use: `pitch` is what a designer reaches for, `detune` is what a
   * random variation writes into, in a unit where ±100 is a semitone.
   */
  detune: number;
  /** Second of the buffer the first pass starts at. A loop restarts at zero. */
  startOffset: number;
  /** Seconds to wait before the first sample. */
  delay: number;
  fadeIn: number;
  /** Applied when the source is stopped; an unlooped one still ends on its own. */
  fadeOut: number;
  /**
   * `0` is the highest, as in Unity.
   *
   * Does nothing until the voice ceiling is reached, and then decides everything:
   * the largest number is taken first, and among equals the oldest.
   */
  priority: number;
}
