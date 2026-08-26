import type { AudioBus } from '@three-studio/core';
import type { AudioClipCache } from './AudioClipCache';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  GainNodeLike,
  PannerNodeLike,
} from './AudioContextLike';
import type { AudioMixer } from './AudioMixer';
import { rampTo, setNow } from './param';
import type { PlayRequest, SpatialRequest, VoiceEvent, VoiceHandle, VoiceState } from './playback';

/**
 * One playback. Not one source component — one *playback*.
 *
 * The split is forced by the platform: `AudioBufferSourceNode` is single-use by
 * specification, so a component that plays twice is two nodes. Trying to make a
 * component *be* a node is what `THREE.Audio` does, and it is why it refuses a
 * second concurrent play (`Audio.js:318`).
 *
 * The graph, and why it has two branches:
 *
 * ```
 *   source ─▶ gain ─┬─▶ dry ────────────────▶ bus
 *                   └─▶ panner ─▶ wet ──────▶ bus
 * ```
 *
 * `spatialBlend` is a continuous dial in our document, and Web Audio has no
 * such control: a signal either goes through a `PannerNode` or it does not.
 * Two branches with complementary gains is the only way to honour the field.
 *
 * The crossfade is **linear** — `dry = 1 - blend`, `wet = blend` — and not
 * equal-power. Equal power is right for two *unrelated* signals, where the sum
 * of powers is what stays constant; here the two branches carry the *same*
 * signal, so they add coherently and a linear pair is what keeps the amplitude
 * flat. An equal-power pair would put a 3 dB bump in the middle of the slider.
 *
 * The panner is built on first use. A music track at `spatialBlend: 0` would
 * otherwise pay for a panner node, per voice, forever, to be given a gain of
 * zero.
 */
export class Voice implements VoiceHandle {
  readonly id: number;
  readonly assetId: string;

  private stateValue: VoiceState = 'pending';
  private priorityValue: number;
  private volumeValue: number;

  private readonly bus: AudioBus;
  private readonly loop: boolean;
  private readonly startOffset: number;
  private readonly delay: number;
  private readonly fadeIn: number;

  private pitch: number;
  private detune: number;
  private spatial: SpatialRequest | null;

  private gain: GainNodeLike | null = null;
  private dry: GainNodeLike | null = null;
  private wet: GainNodeLike | null = null;
  private panner: PannerNodeLike | null = null;
  private source: AudioBufferSourceNodeLike | null = null;
  private buffer: AudioBufferLike | null = null;

  /** Seconds into the buffer at the moment the current source node started. */
  private progress = 0;
  /** Context time the current source node started, or will start. */
  private startedAt = 0;
  /** Context time the buffer runs out. `Infinity` while looping. */
  private endsAt = Infinity;
  /** Context time a stop takes effect, once one has been asked for. */
  private stopAt: number | null = null;

  private releaseClip: (() => void) | null = null;
  private readonly listeners = new Map<VoiceEvent, Set<() => void>>();

  constructor(
    id: number,
    private readonly context: AudioContextLike,
    private readonly mixer: AudioMixer,
    cache: AudioClipCache,
    request: PlayRequest,
    /** The asset's imported gain, folded in here rather than baked into samples. */
    private readonly assetGain: number,
  ) {
    this.id = id;
    this.assetId = request.assetId;
    this.bus = request.bus ?? 'master';
    this.volumeValue = request.volume ?? 1;
    this.pitch = request.pitch ?? 1;
    this.detune = request.detune ?? 0;
    this.loop = request.loop ?? false;
    this.startOffset = Math.max(0, request.startOffset ?? 0);
    this.delay = Math.max(0, request.delay ?? 0);
    this.fadeIn = Math.max(0, request.fadeIn ?? 0);
    this.priorityValue = request.priority ?? 128;
    this.spatial = request.spatial ?? null;

    const held = cache.acquire(this.assetId);
    this.releaseClip = held.release;
    void held.clip.then((buffer) => this.arrive(buffer));
  }

  get state(): VoiceState {
    return this.stateValue;
  }

  get volume(): number {
    return this.volumeValue;
  }

  /**
   * The priority the pool sorts by, which is not always the one that was asked
   * for: a voice already fading out is the first thing worth taking, whatever
   * the author said about it.
   */
  get priority(): number {
    return this.stopAt === null ? this.priorityValue : Number.MAX_SAFE_INTEGER;
  }

  get elapsed(): number {
    if (this.stateValue === 'pending' || this.stateValue === 'paused') return this.progress;
    const advanced = Math.max(0, this.context.currentTime - this.startedAt) * this.rate();
    if (this.loop || this.buffer === null) return this.progress + advanced;
    return Math.min(this.buffer.duration, this.progress + advanced);
  }

  /** Context time the voice began, for the pool's oldest-first tie-break. */
  get since(): number {
    return this.startedAt;
  }

  stop(fadeOut = 0): void {
    if (this.stateValue === 'failed') return;

    // Already stopping. A second stop with no fade is not a repeat, it is
    // "now": the engine being disposed, or the pool taking the slot. It has to
    // cut the fade short and release the clip, or a voice that was two seconds
    // into a five second fade-out when the scene changed keeps its reference on
    // a cache that outlives the scene — where nothing will ever collect it.
    if (this.stateValue === 'stopped') {
      if (fadeOut <= 0) this.finish();
      return;
    }

    // Nothing has been built yet: the clip is still decoding. Say so now, and
    // `arrive` will drop the buffer when it turns up. `stopAt` stays null and
    // `tick` reads that as "over", which is what lets the pool have the slot
    // back — a cancelled sound must cost nothing, including a slot.
    if (this.stateValue === 'pending') {
      this.stateValue = 'stopped';
      this.finish();
      return;
    }

    const now = this.context.currentTime;
    const at = now + Math.max(0, fadeOut);
    if (this.gain) rampTo(this.gain.gain, 0, now, fadeOut);
    this.source?.stop(at);
    this.stopAt = at;
    this.stateValue = 'stopped';
    if (fadeOut <= 0) this.finish();
  }

  /**
   * Web Audio cannot pause a source, so pausing is stopping and remembering how
   * far in we were. `resume` builds a new node from there — which is what three
   * does too, with its `_progress`.
   */
  pause(): void {
    if (this.stateValue !== 'playing') return;
    this.progress = this.elapsed;
    this.teardownSource();
    this.stateValue = 'paused';
  }

  resume(): void {
    if (this.stateValue !== 'paused' || this.buffer === null) return;
    this.stateValue = 'playing';
    this.launch(this.buffer, this.context.currentTime, this.progress, 0);
  }

  /**
   * @param ramp Seconds to get there. Left out means the default 20 ms, which
   *   is short enough to read as immediate and long enough not to click.
   *
   * A value that is already set writes nothing at all, and that is not an
   * optimisation. `rampTo` cancels whatever was scheduled, so the editor's
   * preview — which hands the component's volume back once a frame so a slider
   * is audible while it is dragged — turned every fade-in into a 20 ms one on
   * the frame after it started. Someone who *asks* for a different volume still
   * gets it, fade or no fade: an explicit change wins, a restatement is free.
   */
  setVolume(volume: number, ramp?: number): void {
    const next = Math.max(0, volume);
    if (next === this.volumeValue) return;
    this.volumeValue = next;
    if (this.gain && this.stopAt === null) {
      rampTo(this.gain.gain, this.targetGain(), this.context.currentTime, ramp);
    }
  }

  /** Free when nothing moved, for the reason `setVolume` gives. */
  setPitch(pitch: number, detune?: number): void {
    const nextPitch = Math.max(0.01, pitch);
    const nextDetune = detune ?? this.detune;
    if (nextPitch === this.pitch && nextDetune === this.detune) return;

    const now = this.context.currentTime;
    // The baseline has to move with the rate, or every later `elapsed` would
    // read the new rate back over time already spent at the old one.
    //
    // Not while the sound is still waiting out its `delay`, though: the state is
    // already `'playing'` there but `startedAt` is in the future, and moving it
    // to `now` throws the delay away — the voice was then reaped that much
    // early, with the tail still to play.
    if (this.stateValue === 'playing' && now >= this.startedAt) {
      this.progress = this.elapsed;
      this.startedAt = now;
    }
    this.pitch = nextPitch;
    this.detune = nextDetune;
    if (this.source) {
      setNow(this.source.playbackRate, this.pitch, now);
      setNow(this.source.detune, this.detune, now);
    }
    this.refreshEnd();
  }

  setSpatial(spatial: SpatialRequest | null): void {
    this.spatial = spatial;
    if (this.gain === null) return;
    this.applySpatial();
  }

  on(event: VoiceEvent, listener: () => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  /**
   * Advances the voice, and says whether it is over.
   *
   * Polling rather than `onended`, and that is a deliberate part of the contract
   * (see `AudioContextLike`): "the sound finished" becomes a comparison of two
   * numbers, which a test drives by advancing a clock instead of by provoking a
   * callback it does not control.
   */
  tick(now: number): boolean {
    if (this.stateValue === 'failed') return true;
    if (this.stopAt !== null) {
      if (now < this.stopAt) return false;
      this.finish();
      return true;
    }
    // Stopped with no fade left to run — cancelled before it ever started, most
    // often. There is nothing to wait for, and leaving it in the pool would hold
    // a slot at the priority it was asked for: enough of those at a high
    // priority and nothing new is ever admitted again.
    if (this.stateValue === 'stopped') return true;
    if (this.stateValue !== 'playing') return false;
    if (now < this.endsAt) return false;
    this.stateValue = 'stopped';
    this.finish();
    return true;
  }

  private arrive(buffer: AudioBufferLike | null): void {
    // Stopped, or the engine was disposed, while the file was decoding.
    if (this.stateValue === 'stopped' || this.stateValue === 'failed') return;

    if (buffer === null) {
      this.stateValue = 'failed';
      this.emit('failed');
      this.emit('ended');
      this.finish();
      return;
    }

    this.buffer = buffer;
    this.stateValue = 'playing';
    this.build();
    this.launch(buffer, this.context.currentTime + this.delay, this.startOffset, this.fadeIn);
    this.emit('started');
  }

  private build(): void {
    const gain = this.context.createGain();
    const dry = this.context.createGain();
    gain.connect(dry);
    dry.connect(this.mixer.input(this.bus));
    this.gain = gain;
    this.dry = dry;
    this.applySpatial();
  }

  private launch(
    buffer: AudioBufferLike,
    when: number,
    offset: number,
    fadeIn: number,
  ): void {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.pitch;
    source.detune.value = this.detune;
    if (this.gain) source.connect(this.gain);
    // An offset past the end would start a node that ends immediately; the
    // author asking for one probably changed the clip under the setting.
    const from = this.loop ? offset % Math.max(buffer.duration, 0.0001) : Math.min(offset, buffer.duration);
    source.start(when, from);
    this.source = source;
    this.progress = from;
    this.startedAt = when;

    if (this.gain) {
      const target = this.targetGain();
      if (fadeIn > 0) {
        this.gain.gain.cancelScheduledValues(when);
        this.gain.gain.setValueAtTime(0, when);
        this.gain.gain.linearRampToValueAtTime(target, when + fadeIn);
      } else {
        setNow(this.gain.gain, target, when);
      }
    }
    this.refreshEnd();
  }

  private applySpatial(): void {
    const gain = this.gain;
    const dry = this.dry;
    if (gain === null || dry === null) return;

    const now = this.context.currentTime;
    const blend = this.spatial === null ? 0 : clamp01(this.spatial.blend);

    if (blend > 0 && this.panner === null) {
      const panner = this.context.createPanner();
      const wet = this.context.createGain();
      panner.panningModel = 'equalpower';
      gain.connect(panner);
      panner.connect(wet);
      wet.connect(this.mixer.input(this.bus));
      this.panner = panner;
      this.wet = wet;
      setNow(wet.gain, 0, now);
    }

    rampTo(dry.gain, 1 - blend, now);
    if (this.wet) rampTo(this.wet.gain, blend, now);

    const spatial = this.spatial;
    const panner = this.panner;
    if (spatial === null || panner === null) return;

    panner.distanceModel = spatial.distanceModel;
    panner.refDistance = Math.max(0.0001, spatial.refDistance);
    panner.maxDistance = Math.max(panner.refDistance, spatial.maxDistance);
    panner.rolloffFactor = Math.max(0, spatial.rolloffFactor);
    panner.coneInnerAngle = spatial.coneInnerAngle;
    panner.coneOuterAngle = spatial.coneOuterAngle;
    panner.coneOuterGain = spatial.coneOuterGain;

    const [px, py, pz] = spatial.position;
    const [fx, fy, fz] = spatial.forward;
    // A ramp rather than an assignment: a position written straight onto the
    // parameter every frame steps the panner's own interpolation and is heard
    // as a click on anything moving quickly.
    rampTo(panner.positionX, px, now);
    rampTo(panner.positionY, py, now);
    rampTo(panner.positionZ, pz, now);
    rampTo(panner.orientationX, fx, now);
    rampTo(panner.orientationY, fy, now);
    rampTo(panner.orientationZ, fz, now);
  }

  private targetGain(): number {
    return this.volumeValue * this.assetGain;
  }

  private rate(): number {
    return this.pitch * Math.pow(2, this.detune / 1200);
  }

  private refreshEnd(): void {
    if (this.loop || this.buffer === null) {
      this.endsAt = Infinity;
      return;
    }
    this.endsAt = this.startedAt + (this.buffer.duration - this.progress) / this.rate();
  }

  private teardownSource(): void {
    if (this.source === null) return;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  private finish(): void {
    this.teardownSource();
    this.wet?.disconnect();
    this.panner?.disconnect();
    this.dry?.disconnect();
    this.gain?.disconnect();
    this.wet = null;
    this.panner = null;
    this.dry = null;
    this.gain = null;
    this.buffer = null;
    this.releaseClip?.();
    this.releaseClip = null;
    if (this.stateValue !== 'failed') this.emit('ended');
    this.listeners.clear();
  }

  private emit(event: VoiceEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
