import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** Shown while a source is any part positional: 3D falloff means nothing to a fully flat one. */
const positional = { field: 'spatialBlend', notEquals: 0 } as const;

/** A sound the game plays, as its fields. The order is the pane's. */
export const audioSourceSchema = {
  /*
   * First, because everything below it is a way of shaping this one. None is
   * a source with no clip chosen.
   */
  assetId: { type: 'asset', label: 'Clip', kind: 'audio' },
  volume: { type: 'number', label: 'Volume', default: 1, min: 0, max: 2, step: 0.01, separatorBefore: true },
  /* Playback rate; it also shifts the pitch, as in every engine's simple mode. */
  pitch: { type: 'number', label: 'Pitch', default: 1, min: 0.1, max: 4, step: 0.01 },
  /*
   * Cents, composed with `pitch`: rate = pitch × 2^(detune / 1200). Both are
   * offered because Web Audio has both, and they are not the same control:
   * `pitch` is what a designer reaches for, `detune` is what a random
   * variation writes into, in a unit where ±100 is a semitone and ±1200 an
   * octave.
   */
  detune: { type: 'number', label: 'Detune', default: 0, min: -1200, max: 1200, step: 1 },
  /* Silences the source without losing the volume it was set to. */
  mute: { type: 'boolean', label: 'Mute', default: false },
  loop: { type: 'boolean', label: 'Loop', default: false },
  playOnStart: { type: 'boolean', label: 'Play on start', default: false },
  /* The second of the clip the first pass starts at. A loop restarts at zero. */
  startOffset: { type: 'number', label: 'Start offset', default: 0, min: 0, step: 0.01, separatorBefore: true },
  /* Seconds to wait before the first sample. */
  delay: { type: 'number', label: 'Delay', default: 0, min: 0, step: 0.01 },
  fadeIn: { type: 'number', label: 'Fade in', default: 0, min: 0, max: 30, step: 0.01 },
  /* Applied when the source is stopped; an unlooped one still ends on its own. */
  fadeOut: { type: 'number', label: 'Fade out', default: 0, min: 0, max: 30, step: 0.01 },
  /*
   * `0` is the highest, as in Unity. Idle until the voice ceiling is reached,
   * and then it decides everything: the largest number is taken first, and
   * among equals the oldest. Unity's default sits in the middle of its range,
   * which leaves room to say "this one matters" in both directions.
   */
  priority: { type: 'number', label: 'Priority', default: 128, min: 0, max: 256, step: 1 },
  /*
   * Mixer buses, borrowed from Unreal's sound classes: a shallow, fixed set is
   * enough to duck music under dialogue or mute effects, and it keeps every
   * source's routing to one choice rather than a graph the author must build.
   */
  bus: {
    type: 'enum',
    label: 'Bus',
    default: 'sfx',
    separatorBefore: true,
    options: [
      { value: 'master', label: 'Master' },
      { value: 'music', label: 'Music' },
      { value: 'sfx', label: 'SFX' },
      { value: 'ui', label: 'UI' },
      { value: 'ambience', label: 'Ambience' },
    ],
  },
  /*
   * `0` is fully 2D (music, UI), `1` fully positional: Unity's model, a single
   * dial far easier to reason about than two separate node paths, and one that
   * lets a sound be pulled toward the listener without losing its position.
   * Fully positional by default: a sound placed on an entity is almost always
   * meant to come from there.
   */
  spatialBlend: { type: 'number', label: '2D  ↔  3D', default: 1, min: 0, max: 1, step: 0.01, separatorBefore: true },
  /* Web Audio's own falloff curves, under the names three and the spec use. */
  distanceModel: {
    type: 'enum',
    label: 'Falloff',
    default: 'inverse',
    shownWhen: positional,
    options: [
      { value: 'inverse', label: 'Inverse' },
      { value: 'linear', label: 'Linear' },
      { value: 'exponential', label: 'Exponential' },
    ],
  },
  /* The distance within which the sound is at full volume. */
  refDistance: { type: 'number', label: 'Full volume within', default: 1, min: 0.1, max: 100, step: 0.1, shownWhen: positional },
  maxDistance: { type: 'number', label: 'Max distance', default: 50, min: 1, max: 2000, step: 1, shownWhen: positional },
  rolloffFactor: { type: 'number', label: 'Rolloff', default: 1, min: 0, max: 10, step: 0.1, shownWhen: positional },
  /* A directional cone; a 360° inner angle is omnidirectional. */
  coneInnerAngle: { type: 'number', label: 'Cone inner', default: 360, min: 0, max: 360, step: 1, shownWhen: positional },
  coneOuterAngle: { type: 'number', label: 'Cone outer', default: 360, min: 0, max: 360, step: 1, shownWhen: positional },
  coneOuterGain: { type: 'number', label: 'Outside cone', default: 0, min: 0, max: 1, step: 0.01, shownWhen: positional },
} as const satisfies Schema;

export type AudioSourceComponent = Component<'audioSource', Infer<typeof audioSourceSchema>>;
export type AudioBus = AudioSourceComponent['bus'];
export type DistanceModel = AudioSourceComponent['distanceModel'];

/**
 * The buses, as a value: the mixer builds one gain node per bus, and a type
 * cannot be iterated. Read off the field's options, so a bus added there is a
 * gain node the mixer builds.
 */
export const AUDIO_BUSES: readonly AudioBus[] = audioSourceSchema.bus.options.map((option) => option.value);
