import type { ComponentBase } from '../../scene/primitives';

/**
 * Mixer buses, borrowed from Unreal's sound classes: a shallow, fixed set is
 * enough to duck music under dialogue or mute effects, and it keeps every
 * source's routing to a single enum rather than a graph the author must build.
 */
export type AudioBus = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

/**
 * The same set, as a value, because the mixer has to build one gain node per bus
 * and a type cannot be iterated.
 *
 * `satisfies` rather than a plain annotation, so adding a bus to the union
 * without adding it here is a compile error rather than a bus nothing routes to
 * — the same guard `COMPONENT_TYPES` uses.
 */
export const AUDIO_BUSES = [
  'master',
  'music',
  'sfx',
  'ui',
  'ambience',
] as const satisfies readonly AudioBus[];

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
  distanceModel: 'linear' | 'inverse' | 'exponential';
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
