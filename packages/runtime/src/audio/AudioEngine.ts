import type { AssetResolver } from '../assets/AssetResolver';
import { AudioClipCache, type ClipLoader } from './AudioClipCache';
import { isStopped, type AudioContextLike, type AudioNodeLike } from './AudioContextLike';
import { AudioMixer } from './AudioMixer';
import { rampTo } from './param';
import { failedVoice, type PlayRequest, type Vec3Tuple, type VoiceHandle } from './playback';
import { Voice } from './Voice';
import { DEFAULT_MAX_VOICES, VoicePool } from './VoicePool';

export interface AudioEngineOptions {
  /**
   * The audio context, injected rather than created (ADR-7).
   *
   * Two engines normally share one — the editor's preview and the running game
   * — and stay independent through `destination` rather than through a context
   * each, because a browser caps how many contexts a page may have and each one
   * needs its own user gesture to start.
   */
  context: AudioContextLike;
  resolver: AssetResolver;
  /** Where this engine's root connects. Defaults to the context's destination. */
  destination?: AudioNodeLike;
  maxVoices?: number;
  budgetBytes?: number;
  load?: ClipLoader;
  /**
   * A clip cache to share rather than build.
   *
   * `SceneHost` passes the same one to every engine it makes, which is what
   * lets a decoded clip survive a scene change: the next level almost always
   * plays some of the same sounds, and decoding them again is the wrong
   * economy. An engine that was handed a cache does not clear it on dispose —
   * it does not own it.
   */
  cache?: AudioClipCache;
  onWarning?: (message: string) => void;
}

/**
 * Everything audible for one listener: the mixer, the clips, the voices.
 *
 * Owns things with a lifetime, so it is a class — the rule `ComponentSystem`
 * states and `registerBehaviour` is the exception to. One instance per root
 * (ADR-4): the editor builds one for preview, `Engine` builds one for the game,
 * and neither can hear the other.
 */
export class AudioEngine {
  readonly mixer: AudioMixer;

  private readonly context: AudioContextLike;
  private readonly resolver: AssetResolver;
  private readonly cache: AudioClipCache;
  /** Whether `dispose` may clear the cache, which turns on who made it. */
  private readonly ownsCache: boolean;
  private readonly pool: VoicePool;
  private readonly onWarning: (message: string) => void;
  private nextId = 1;
  private disposed = false;
  private suspended = false;

  constructor(options: AudioEngineOptions) {
    this.context = options.context;
    this.resolver = options.resolver;
    this.onWarning = options.onWarning ?? (() => {});
    this.mixer = new AudioMixer(this.context, options.destination ?? this.context.destination);
    this.ownsCache = options.cache === undefined;
    this.cache =
      options.cache ??
      new AudioClipCache(this.context, this.resolver, {
        load: options.load,
        budgetBytes: options.budgetBytes,
        onWarning: this.onWarning,
      });
    this.pool = new VoicePool(options.maxVoices ?? DEFAULT_MAX_VOICES);
  }

  /**
   * Starts a sound, and answers before it has loaded.
   *
   * The handle is usable immediately — `stop()` on a voice that is still
   * decoding cancels it. The alternative, a `Promise<VoiceHandle>`, would make
   * every caller await something that is synchronous from the second play
   * onwards, and would put a microtask between pulling a trigger and the sound.
   *
   * A refusal comes back as a handle in `'failed'`, never as `null`: a caller
   * that has to null-check every play writes the check once and then forgets it
   * somewhere it mattered.
   */
  play(request: PlayRequest): VoiceHandle {
    const id = this.nextId++;
    if (this.disposed) return failedVoice(id, request.assetId);

    if (request.assetId === '') {
      // Not a warning. A source with no clip yet is the normal state of one that
      // was just added, and warning per frame about an empty field is noise.
      return failedVoice(id, request.assetId);
    }

    // Asked before anything is allocated: a refused sound must cost nothing at
    // all, which is the whole reason the pool answers a question instead of
    // being handed a voice to reject.
    if (!this.pool.admit(request.priority ?? 128)) return failedVoice(id, request.assetId);

    const voice = new Voice(
      id,
      this.context,
      this.mixer,
      this.cache,
      request,
      this.assetGain(request.assetId),
    );
    this.pool.add(voice);
    return voice;
  }

  /** Decodes a clip ahead of the first play, and keeps it. */
  async preload(assetId: string): Promise<void> {
    if (this.disposed || assetId === '') return;
    const held = this.cache.acquire(assetId);
    await held.clip;
    // The reference is given straight back: preloading means "have it ready",
    // not "hold it forever". The buffer stays until the budget wants the room.
    held.release();
  }

  /** Forgets a decoded clip, for a file replaced under an id that did not change. */
  invalidate(assetId: string): void {
    this.cache.invalidate(assetId);
  }

  stopAll(fadeOut = 0): void {
    this.pool.stopAll(fadeOut);
  }

  /**
   * Places the ear.
   *
   * Two generations of the same API, as in three: the parameter form when the
   * browser has it, the deprecated setters otherwise. The ramp is what keeps a
   * moving listener from stepping its own interpolation once a frame.
   */
  setListener(position: Vec3Tuple, forward: Vec3Tuple, up: Vec3Tuple): void {
    if (this.disposed) return;
    const listener = this.context.listener;
    const now = this.context.currentTime;
    const [px, py, pz] = position;
    const [fx, fy, fz] = forward;
    const [ux, uy, uz] = up;

    if (listener.positionX && listener.forwardX && listener.upX) {
      rampTo(listener.positionX, px, now);
      if (listener.positionY) rampTo(listener.positionY, py, now);
      if (listener.positionZ) rampTo(listener.positionZ, pz, now);
      rampTo(listener.forwardX, fx, now);
      if (listener.forwardY) rampTo(listener.forwardY, fy, now);
      if (listener.forwardZ) rampTo(listener.forwardZ, fz, now);
      rampTo(listener.upX, ux, now);
      if (listener.upY) rampTo(listener.upY, uy, now);
      if (listener.upZ) rampTo(listener.upZ, uz, now);
      return;
    }

    listener.setPosition?.(px, py, pz);
    listener.setOrientation?.(fx, fy, fz, ux, uy, uz);
  }

  setMasterVolume(volume: number): void {
    this.mixer.setMasterVolume(volume);
  }

  setMasterMute(mute: boolean): void {
    this.mixer.setMasterMute(mute);
  }

  /** Retires the voices that are over. Called once per displayed frame. */
  update(): void {
    if (this.disposed) return;
    this.pool.tick(this.context.currentTime);
  }

  /**
   * Starts the context, which browsers refuse to do without a user gesture.
   *
   * Idempotent, and safe to call from anywhere a click already happened — the
   * editor's Play button, the exported player's first pointer event. A sound
   * that "does not work" is this, first, every time.
   *
   * `isStopped` and not `state === 'suspended'`: iOS has a fourth state,
   * `'interrupted'`, and a context left in it stays silent for the rest of the
   * session.
   */
  async unlock(): Promise<void> {
    if (this.disposed || !isStopped(this.context.state)) return;
    try {
      await this.context.resume();
    } catch (error) {
      this.onWarning(`The audio context could not be started: ${describe(error)}`);
    }
  }

  /**
   * Silences this engine without touching the context.
   *
   * The root gain and not `context.suspend()`, because the context is shared:
   * suspending it for a backgrounded game would also stop the editor's preview.
   */
  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    // Its own flag on the mixer, not the master mute: a game that muted itself
    // must still be muted when the tab comes back.
    this.mixer.setSuspended(suspended);
  }

  /** Every voice the pool holds, for a debugger and for tests. */
  get voices(): readonly VoiceHandle[] {
    return this.pool.live;
  }

  get clipBytes(): number {
    return this.cache.bytes;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.stopAll(0);
    // Only a cache this engine made. A shared one belongs to the host, and
    // clearing it here would throw away every clip the next scene is about to
    // ask for — which is exactly the case sharing it was for.
    if (this.ownsCache) this.cache.clear();
    this.mixer.dispose();
  }

  private assetGain(assetId: string): number {
    const settings = this.resolver.settings?.(assetId);
    return settings?.kind === 'audio' ? settings.gain : 1;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
