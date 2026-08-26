import type { AudioListenerComponent, AudioSourceComponent } from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import type { AudioEngine } from '../audio/AudioEngine';
import type { PlayRequest, Vec3Tuple, VoiceHandle } from '../audio/playback';
import {
  registerBehaviour,
  type Behaviour,
  type BehaviourContext,
  type BehaviourTarget,
} from './Behaviour';

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
 * Where an entity is and which way it faces, in the terms a panner wants.
 *
 * **Forward is −Z**, which is the convention a camera uses and therefore the one
 * the editor already means by "the way this faces". three's own `PositionalAudio`
 * points its cone down +Z, and we are not bound by that here — the gizmo drawn in
 * the editor reads the same document as this does, so the two agree by
 * construction rather than by anyone remembering.
 */
function worldAudioTransform(object: Object3D): {
  position: Vec3Tuple;
  forward: Vec3Tuple;
  up: Vec3Tuple;
} {
  // `postUpdate` runs before the render traversal, so the world matrix is one
  // frame old unless it is asked for. `PlayerController.postUpdate` gets the
  // same guarantee from `getWorldPosition`, which does this internally.
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements;
  return {
    position: [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0],
    forward: normalized(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)),
    up: normalized(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0),
  };
}

function normalized(x: number, y: number, z: number): Vec3Tuple {
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, -1] : [x / length, y / length, z / length];
}

/** The request a source component describes, at the place it currently is. */
export function playRequestFor(
  component: AudioSourceComponent,
  object: Object3D | null,
): PlayRequest {
  const spatial =
    component.spatialBlend > 0 && object !== null
      ? {
          blend: component.spatialBlend,
          distanceModel: component.distanceModel,
          refDistance: component.refDistance,
          maxDistance: component.maxDistance,
          rolloffFactor: component.rolloffFactor,
          coneInnerAngle: component.coneInnerAngle,
          coneOuterAngle: component.coneOuterAngle,
          coneOuterGain: component.coneOuterGain,
          ...pick(worldAudioTransform(object)),
        }
      : null;

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

function pick(transform: { position: Vec3Tuple; forward: Vec3Tuple }): {
  position: Vec3Tuple;
  forward: Vec3Tuple;
} {
  return { position: transform.position, forward: transform.forward };
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

  constructor(
    private readonly component: AudioSourceComponent,
    private readonly object: Object3D,
    private readonly audio: AudioEngine,
  ) {}

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
    if (this.voice === null || this.component.spatialBlend <= 0) return;
    if (this.voice.state !== 'playing') return;
    const request = playRequestFor(this.component, this.object);
    this.voice.setSpatial(request.spatial ?? null);
  }

  onSceneUnload(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
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
    this.voice = this.audio.play(playRequestFor(this.component, this.object));
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
 * lifetime is the engine's. `SceneHost` builds a new engine for every scene, and
 * a table shared between them would hand a script the sources of a scene that
 * has already been torn down. The same shape `internalContext` uses in
 * `ScriptApi`, and for the same reason.
 */
const sources = new WeakMap<AudioEngine, Map<string, AudioSourceBehaviour[]>>();

/** Every source on an entity. Several is legal — a door can creak and slam. */
export function audioSourcesOn(
  audio: AudioEngine,
  entityId: string,
): readonly AudioSourceBehaviour[] {
  return sources.get(audio)?.get(entityId) ?? [];
}

function remember(audio: AudioEngine, entityId: string, behaviour: AudioSourceBehaviour): void {
  const byEntity = sources.get(audio) ?? new Map<string, AudioSourceBehaviour[]>();
  sources.set(audio, byEntity);
  byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), behaviour]);
}

/**
 * The ear, when the scene names one.
 *
 * Writing it here rather than in the engine is what lets the listener sit on the
 * player while the camera orbits behind it — the case that makes the component
 * worth having at all. The engine only steps in when there is no such component
 * (ADR-9), because a scene with no ear that plays nothing is the worst possible
 * first contact with the system.
 */
class AudioListenerBehaviour implements Behaviour {
  constructor(
    private readonly component: AudioListenerComponent,
    private readonly object: Object3D,
    private readonly audio: AudioEngine,
  ) {}

  start(): void {
    this.audio.setMasterVolume(this.component.masterVolume);
    this.write();
  }

  postUpdate(): void {
    this.write();
  }

  private write(): void {
    const { position, forward, up } = worldAudioTransform(this.object);
    this.audio.setListener(position, forward, up);
  }
}

registerBehaviour('audioSource', (target: BehaviourTarget, ctx: BehaviourContext) => {
  if (target.component.type !== 'audioSource') return null;
  // No audio engine at all — a host that never handed one over, or a browser
  // with no Web Audio. The component is inert rather than broken, and the engine
  // has already said so once.
  if (ctx.audio === null) return null;
  const behaviour = new AudioSourceBehaviour(target.component, target.object, ctx.audio);
  remember(ctx.audio, target.entity.id, behaviour);
  return behaviour;
});

registerBehaviour('audioListener', (target: BehaviourTarget, ctx: BehaviourContext) => {
  if (target.component.type !== 'audioListener') return null;
  if (ctx.audio === null) return null;
  return new AudioListenerBehaviour(target.component, target.object, ctx.audio);
});
