import type { AudioListenerComponent, AudioSourceComponent, EntityId } from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import type { AudioEngine } from '../audio/AudioEngine';
import { audioOf } from '../audio/audioOf';
import type { PlayRequest, SpatialRequest, VoiceHandle } from '../audio/playback';
import type { Behaviour, BehaviourDefinition, BehaviourTarget } from './Behaviour';

/*
 * The glue between a component and a voice, and the only place three and the
 * audio engine meet.
 *
 * `src/audio/` deliberately imports nothing from three — it speaks in triples of
 * numbers — so the matrix reading lives here instead, on the behaviour side of
 * the seam `Behaviour.ts:105-111` describes. It names an audio source as one of
 * the three things that are "a component type plus a factory", and this is that
 * factory.
 */

/**
 * Where an entity is and which way it faces, in the terms a panner wants,
 * written into the triples handed over: a listener and a moving source are
 * placed every frame, and a placement makes nothing.
 *
 * **Forward is −Z**, which is the convention a camera uses and therefore the one
 * the editor already means by "the way this faces". three's own `PositionalAudio`
 * points its cone down +Z, and we are not bound by that here — the gizmo drawn in
 * the editor reads the same document as this does, so the two agree by
 * construction rather than by anyone remembering.
 */
function writeAudioPose(
  object: Object3D,
  position: [number, number, number],
  forward: [number, number, number],
  up: [number, number, number] | null,
): void {
  // A late hook runs before the render traversal, so the world matrix is one
  // frame old unless it is asked for. `PlayerController.postUpdate` gets the
  // same guarantee from `getWorldPosition`, which does this internally.
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements;
  position[0] = e[12] ?? 0;
  position[1] = e[13] ?? 0;
  position[2] = e[14] ?? 0;
  writeColumn(forward, e, 8, -1);
  if (up !== null) writeColumn(up, e, 4, 1);
}

/** Its place in the mix, the triples written where `object` is and kept by the request. */
function spatialRequestFor(
  component: AudioSourceComponent,
  object: Object3D,
  position: [number, number, number],
  forward: [number, number, number],
): SpatialRequest {
  writeAudioPose(object, position, forward, null);
  return {
    blend: component.spatialBlend,
    distanceModel: component.distanceModel,
    refDistance: component.refDistance,
    maxDistance: component.maxDistance,
    rolloffFactor: component.rolloffFactor,
    coneInnerAngle: component.coneInnerAngle,
    coneOuterAngle: component.coneOuterAngle,
    coneOuterGain: component.coneOuterGain,
    position,
    forward,
  };
}

/**
 * The request a source component describes, at the place it currently is: in
 * `spatial`, a source's own request, kept and moved each frame, or a new one.
 */
export function playRequestFor(
  component: AudioSourceComponent,
  object: Object3D | null,
  spatial: SpatialRequest | null = component.spatialBlend > 0 && object !== null
    ? spatialRequestFor(component, object, [0, 0, 0], [0, 0, -1])
    : null,
): PlayRequest {
  return {
    assetId: component.assetId,
    bus: component.bus,
    volume: component.mute ? 0 : component.volume,
    pitch: component.pitch,
    detune: component.detune,
    loop: component.loop,
    startOffset: component.startOffset,
    delay: component.delay,
    fadeIn: component.fadeIn,
    priority: component.priority,
    spatial,
  };
}

/**
 * A sound placed on an entity.
 *
 * Holds at most one voice, which is what a component means: a source that is
 * already playing and is asked to play again restarts, as `AudioSource.Play`
 * does in Unity. Firing several overlapping copies of one clip is what
 * `audio.playClip(...)` from a script is for, and what a Sound Event will be for.
 */
export class AudioSourceBehaviour implements Behaviour {
  private voice: VoiceHandle | null = null;
  /** Where it is and which way it faces, rewritten where they stand each frame. */
  private readonly position: [number, number, number] = [0, 0, 0];
  private readonly forward: [number, number, number] = [0, 0, -1];
  /** Its place in the mix, kept for its life, `null` for a flat source: one request, moved. */
  private readonly spatial: SpatialRequest | null;

  constructor(
    private readonly component: AudioSourceComponent,
    private readonly object: Object3D,
    private readonly audio: AudioEngine,
    private readonly entityId: EntityId,
  ) {
    this.spatial =
      component.spatialBlend > 0 ? spatialRequestFor(component, object, this.position, this.forward) : null;
  }

  /** What is playing right now, or `null`. For a script that wants to listen. */
  get current(): VoiceHandle | null {
    return this.voice;
  }

  start(): void {
    if (this.component.playOnStart) this.play();
  }

  /**
   * After physics, not before.
   *
   * A sound on a moving body placed in `update` is mixed at the position that
   * body had last frame — inaudible on a drifting cloud, very audible on a
   * projectile. It is the reason a camera is placed here too
   * (`Behaviour.ts:69-71`).
   */
  postUpdate(): void {
    if (this.voice === null || this.spatial === null) return;
    if (this.voice.state !== 'playing') return;
    writeAudioPose(this.object, this.position, this.forward, null);
    this.voice.setSpatial(this.spatial);
  }

  onSceneUnload(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
    forget(this.audio, this.entityId, this);
  }

  /**
   * Starts, or starts again.
   *
   * One voice per source, as `AudioSource.Play` behaves in Unity: asking a
   * source that is already playing to play restarts it rather than layering a
   * second copy over the first. Overlapping copies of one clip are what
   * `audio.playClip(...)` is for, and what a Sound Event will be for.
   */
  play(): VoiceHandle | null {
    this.voice?.stop(0);
    if (this.spatial !== null) writeAudioPose(this.object, this.position, this.forward, null);
    this.voice = this.audio.play(playRequestFor(this.component, this.object, this.spatial));
    return this.voice;
  }

  stop(fadeOut = this.component.fadeOut): void {
    this.voice?.stop(fadeOut);
    this.voice = null;
  }

  pause(): void {
    this.voice?.pause();
  }

  resume(): void {
    this.voice?.resume();
  }

  setVolume(volume: number, ramp?: number): void {
    this.voice?.setVolume(volume, ramp);
  }

  setPitch(pitch: number, detune?: number): void {
    this.voice?.setPitch(pitch, detune);
  }
}

/*
 * Which sources exist, per engine.
 *
 * A `WeakMap` keyed by the engine and not a module-level table, for the reason
 * `ComponentSystem` states about registries: this has a lifetime, and the
 * lifetime is the engine's, one per world. Each source leaves it as it is
 * disposed: a world outlives its scenes, and a table that kept them would hand
 * a script the sources of a scene already unloaded, and hold them until the
 * game ended. The same shape each world's accessors use, and for the same
 * reason.
 */
const sources = new WeakMap<AudioEngine, Map<EntityId, AudioSourceBehaviour[]>>();

/** Every source on an entity. Several is legal — a door can creak and slam. */
export function audioSourcesOn(
  audio: AudioEngine,
  entityId: EntityId,
): readonly AudioSourceBehaviour[] {
  return sources.get(audio)?.get(entityId) ?? [];
}

function remember(audio: AudioEngine, entityId: EntityId, behaviour: AudioSourceBehaviour): void {
  const byEntity = sources.get(audio) ?? new Map<EntityId, AudioSourceBehaviour[]>();
  sources.set(audio, byEntity);
  byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), behaviour]);
}

function forget(audio: AudioEngine, entityId: EntityId, behaviour: AudioSourceBehaviour): void {
  const byEntity = sources.get(audio);
  const left = byEntity?.get(entityId)?.filter((source) => source !== behaviour) ?? [];
  if (left.length > 0) byEntity?.set(entityId, left);
  else byEntity?.delete(entityId);
}

/**
 * Where an ear is and which way it faces, written in place: the triples
 * `setListener` reads, kept by whatever places an ear every frame, so that
 * placing it makes nothing.
 */
export class EarPose {
  private readonly position: [number, number, number] = [0, 0, 0];
  private readonly forward: [number, number, number] = [0, 0, -1];
  private readonly up: [number, number, number] = [0, 1, 0];

  /** Places `audio`'s ear where `object` is, facing down its −Z as a camera does. */
  place(audio: AudioEngine, object: Object3D): void {
    writeAudioPose(object, this.position, this.forward, this.up);
    audio.setListener(this.position, this.forward, this.up);
  }
}

/**
 * A column of a world matrix — its basis vector from `first` — scaled by
 * `sign` and made unit length, into `target`; `(0, 0, -1)` for none at all.
 *
 * Handed the matrix and an index rather than three numbers: a fractional
 * number passed to a call V8 does not inline is boxed, and this runs for every
 * ear and every moving source, every frame. Not `Math.hypot` either, whose
 * builtin gathers its arguments into an array on every call.
 */
function writeColumn(target: [number, number, number], e: readonly number[], first: number, sign: 1 | -1): void {
  const x = sign * (e[first] ?? 0);
  const y = sign * (e[first + 1] ?? 0);
  const z = sign * (e[first + 2] ?? 0);
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length === 0) {
    target[0] = 0;
    target[1] = 0;
    target[2] = -1;
    return;
  }
  target[0] = x / length;
  target[1] = y / length;
  target[2] = z / length;
}

/**
 * The ear, when the scene names one.
 *
 * Writing it here rather than in the world is what lets the listener sit on the
 * player while the camera orbits behind it — the case that makes the component
 * worth having at all. The audio subsystem only steps in when there is no such
 * component, because a scene with no ear that plays nothing is the worst
 * possible first contact with the system.
 */
class AudioListenerBehaviour implements Behaviour {
  private readonly ear = new EarPose();

  constructor(
    private readonly component: AudioListenerComponent,
    private readonly object: Object3D,
    private readonly audio: AudioEngine,
  ) {}

  start(): void {
    this.audio.setMasterVolume(this.component.masterVolume);
    this.ear.place(this.audio, this.object);
  }

  postUpdate(): void {
    this.ear.place(this.audio, this.object);
  }
}

/**
 * An audio source playing through `audio`, filed where a script's `this.audio`
 * finds it; `null` for a component of another type. The definition's, on its
 * world's engine, and a test's, on one of its own.
 */
export function audioSourceOn(audio: AudioEngine, target: BehaviourTarget): Behaviour | null {
  if (target.component.type !== 'audioSource') return null;
  const behaviour = new AudioSourceBehaviour(target.component, target.object, audio, target.entity.id);
  remember(audio, target.entity.id, behaviour);
  return behaviour;
}

/** The ear placed by an Audio Listener on `audio`, as `audioSourceOn` makes a source. */
export function audioListenerOn(audio: AudioEngine, target: BehaviourTarget): Behaviour | null {
  if (target.component.type !== 'audioListener') return null;
  return new AudioListenerBehaviour(target.component, target.object, audio);
}

export const audioSourceBehaviour: BehaviourDefinition = {
  id: 'audioSource',
  create(target, world) {
    // No audio engine at all — a host that never handed one over, or a browser
    // with no Web Audio. The component is inert rather than broken.
    const audio = audioOf(world);
    return audio === null ? null : audioSourceOn(audio, target);
  },
};

export const audioListenerBehaviour: BehaviourDefinition = {
  id: 'audioListener',
  create(target, world) {
    const audio = audioOf(world);
    return audio === null ? null : audioListenerOn(audio, target);
  },
};
