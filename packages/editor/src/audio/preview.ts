import type { AudioSourceComponent } from '@three-studio/core';
import {
  AudioEngine,
  type AssetResolver,
  type AudioContextLike,
  type PlayRequest,
  type Vec3Tuple,
  type VoiceHandle,
} from '@three-studio/runtime';
import type { Object3D } from 'three/webgpu';
import { findComponentById } from '@three-studio/core';
import { editorAssetResolver } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { editorAudioContext } from './context';

/**
 * What the audition needs from the window it is running in.
 *
 * Every one of these is a parameter for the reason ADR-7 gives about the context:
 * vitest runs under node, where `AudioContext` and `requestAnimationFrame` are
 * types with no values behind them. Without the seam this whole file is
 * unreachable from a test — and it is the file the frame loop lives in, which is
 * where two of the bugs in phase 7 were.
 */
export interface AudioPreviewOptions {
  /** `null` where the window has no Web Audio, which the audition tolerates. */
  context?: () => AudioContextLike | null;
  resolver?: AssetResolver;
  /** Asks for the next frame, and answers with something `cancel` understands. */
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}

/**
 * What the editor plays when nothing is running.
 *
 * A second `AudioEngine` on the same context as play mode, kept apart from it by
 * a root gain each (ADR-4). That separation is the whole requirement of the
 * PRD's §9: stopping the game must not stop an audition, and auditioning a clip
 * must not appear in the game's mix.
 *
 * One voice at a time, deliberately. Auditioning is a question — "what does this
 * sound like" — and two answers at once is not a better answer.
 */
export class AudioPreview {
  private readonly context: () => AudioContextLike | null;
  private readonly resolver: AssetResolver;
  private readonly schedule: (callback: () => void) => number;
  private readonly cancel: (handle: number) => void;

  private engine: AudioEngine | null = null;
  private voice: VoiceHandle | null = null;
  private frame: number | null = null;
  /** What is being auditioned, when it came from a component rather than a clip. */
  private source: { entityId: string; componentId: string; object: Object3D | null } | null = null;
  /** Where the ear last was, for an engine that does not exist yet. */
  private pose: [Vec3Tuple, Vec3Tuple, Vec3Tuple] | null = null;

  constructor(options: AudioPreviewOptions = {}) {
    this.context = options.context ?? editorAudioContext;
    this.resolver = options.resolver ?? editorAssetResolver;
    this.schedule = options.schedule ?? ((callback) => requestAnimationFrame(callback));
    this.cancel = options.cancel ?? ((handle) => cancelAnimationFrame(handle));
  }

  get playing(): boolean {
    return this.voice?.state === 'playing';
  }

  get paused(): boolean {
    return this.voice?.state === 'paused';
  }

  /** The asset currently being auditioned, so a UI can light the right row. */
  get assetId(): string | null {
    const state = this.voice?.state;
    return state === 'playing' || state === 'paused' ? (this.voice?.assetId ?? null) : null;
  }

  /** A clip on its own, flat, at full volume — the Project panel's audition. */
  playClip(assetId: string): void {
    this.source = null;
    this.play({ assetId, volume: 1 });
  }

  /**
   * A source component as it is authored, at the place its entity sits.
   *
   * Reading the world matrix rather than the document's transform, because a
   * child entity's position in the document is relative to its parent and the
   * panner wants the world. `object` is `null` for an entity nothing has bound
   * yet, and then the audition is flat — which is honest: there is no "there"
   * to place it at.
   *
   * The ids are kept, not the component: the frame loop re-reads the document,
   * so dragging Volume or 2D ↔ 3D is heard while the drag is happening. A
   * preview that only played the values as they were when Play was pressed
   * would answer a question nobody asked.
   */
  playSource(
    entityId: string,
    componentId: string,
    component: AudioSourceComponent,
    object: Object3D | null,
  ): void {
    this.source = { entityId, componentId, object };
    this.play(previewRequest(component, object));
  }

  play(request: PlayRequest): void {
    const engine = this.ensure();
    if (engine === null) return;
    this.voice?.stop(0);
    // The click that reached this method is the user gesture, and the only
    // moment a browser will start a suspended context.
    void engine.unlock();
    this.voice = engine.play(request);
    this.tick();
  }

  pause(): void {
    this.voice?.pause();
  }

  resume(): void {
    void this.engine?.unlock();
    this.voice?.resume();
    // And start the frame loop again, which `pause` let stop. Without this the
    // audition goes on being audible but is never advanced: it is never retired
    // when the clip ends, so its reference on the decoded buffer is held for the
    // life of the window, `playing` stays true and the Project panel's audition
    // button stays inverted for ever, and the sliders stop being followed.
    this.tick();
  }

  stop(): void {
    this.voice?.stop(0);
    this.voice = null;
    this.source = null;
    this.engine?.update();
  }

  /**
   * Re-reads the component being auditioned and pushes what changed.
   *
   * Volume, pitch and the whole spatial block; not the clip, not `loop`, not
   * the offset — those are decisions taken when a voice starts, and changing
   * them mid-audition would mean restarting it, which is a jarring answer to
   * moving a slider.
   *
   * Every value is handed over on every frame, unconditionally, and that is only
   * safe because `Voice` ignores a value that has not moved. It did not always:
   * `setVolume` cancels whatever is scheduled on the gain, so restating the same
   * number once a frame turned a two second fade-in into a twenty millisecond
   * one on the frame after it started.
   */
  private follow(): void {
    const held = this.source;
    const voice = this.voice;
    if (held === null || voice === null || voice.state !== 'playing') return;

    const found = findComponentById(
      useDocumentStore.getState().scene,
      held.entityId,
      held.componentId,
    );
    if (found?.type !== 'audioSource') return;

    voice.setVolume(found.mute ? 0 : found.volume);
    voice.setPitch(found.pitch, found.detune);
    voice.setSpatial(previewRequest(found, held.object).spatial ?? null);
  }

  /** Places the ear on the editor camera, so flying around is audible. */
  setListener(position: Vec3Tuple, forward: Vec3Tuple, up: Vec3Tuple): void {
    // Kept even with no engine yet, because that is the common case: the
    // viewport has been calling this since the window opened and the engine is
    // only built on the first audition. `ensure` replays it.
    this.pose = [position, forward, up];
    this.engine?.setListener(position, forward, up);
  }

  private ensure(): AudioEngine | null {
    if (this.engine !== null) return this.engine;
    const context = this.context();
    if (context === null) return null;
    this.engine = new AudioEngine({ context, resolver: this.resolver });
    // The ear goes where the camera already is, before the first sound rather
    // than on the frame after it. The viewport calls `setListener` every frame,
    // but the engine did not exist for any of them: a positional source twenty
    // metres away therefore started at full volume and dropped, which sounds
    // exactly like a bug in the falloff.
    if (this.pose) this.engine.setListener(...this.pose);
    return this.engine;
  }

  /**
   * Drives its own frame loop, and only while something is playing.
   *
   * Not hooked into the viewport's loop on purpose: an audition has to work
   * whether or not a viewport exists — the Project panel can be open with no
   * scene bound — and a loop that stops on its own costs nothing when idle.
   */
  private tick = (): void => {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.follow();
    this.engine?.update();
    if (this.voice === null) return;
    const state = this.voice.state;
    if (state !== 'playing' && state !== 'pending') return;
    this.frame = this.schedule(this.tick);
  };
}

function previewRequest(component: AudioSourceComponent, object: Object3D | null): PlayRequest {
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
          ...worldPose(object),
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

/** −Z is forward, the same convention the runtime behaviour and the gizmo use. */
function worldPose(object: Object3D): { position: Vec3Tuple; forward: Vec3Tuple } {
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements;
  const fx = -(e[8] ?? 0);
  const fy = -(e[9] ?? 0);
  const fz = -(e[10] ?? 1);
  const length = Math.hypot(fx, fy, fz) || 1;
  return {
    position: [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0],
    forward: [fx / length, fy / length, fz / length],
  };
}

/** One audition for the whole editor. */
export const audioPreview = new AudioPreview();
