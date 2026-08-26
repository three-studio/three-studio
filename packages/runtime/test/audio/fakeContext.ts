import type {
  AudioBufferLike,
  AudioContextStateLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  PannerNodeLike,
} from '../../src/audio/AudioContextLike';

/*
 * A Web Audio context made of numbers.
 *
 * The whole reason `AudioContextLike` exists (ADR-7): vitest runs under node,
 * where the Web Audio *types* are in `lib.dom` and the *values* are nowhere. A
 * fake of a hundred lines makes the mix, the crossfade, the voice stealing and
 * the cache observable, which is the part of an audio engine that is worth
 * asserting on — nobody can assert that something sounded right.
 *
 * `currentTime` is a field. Advancing it is how a test makes a sound end.
 */

/**
 * One call on a parameter, in order.
 *
 * Kept because *where* a value ended up is not the whole story for a fade: a two
 * second fade-in and a twenty millisecond one both end at the same number, and
 * the difference between them is the only thing you can hear. `target` alone
 * cannot tell them apart, which is how a fade-in that was being wiped every
 * frame went unnoticed.
 */
export type ScheduledValue =
  | { kind: 'set' | 'ramp'; value: number; time: number }
  | { kind: 'cancel'; time: number };

export class FakeParam implements AudioParamLike {
  /** Where the last scheduled ramp is headed. What tests read. */
  target: number;
  /** Every call, in order. For the tests that care about a fade's shape. */
  readonly schedule: ScheduledValue[] = [];
  private current: number;

  constructor(initial = 0) {
    this.current = initial;
    this.target = initial;
  }

  get value(): number {
    return this.current;
  }

  set value(value: number) {
    this.current = value;
    this.target = value;
  }

  setValueAtTime(value: number, startTime: number): AudioParamLike {
    this.schedule.push({ kind: 'set', value, time: startTime });
    this.current = value;
    this.target = value;
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike {
    // The ramp is treated as instantaneous. A test that cared about the shape of
    // a fade would be testing the browser; what a test here cares about is where
    // the value was told to go — and, through `schedule`, when it was told to
    // get there.
    this.schedule.push({ kind: 'ramp', value, time: endTime });
    this.current = value;
    this.target = value;
    return this;
  }

  cancelScheduledValues(startTime: number): AudioParamLike {
    this.schedule.push({ kind: 'cancel', time: startTime });
    return this;
  }

  /** The last ramp scheduled, which is the one that decides what is heard. */
  get lastRamp(): { value: number; time: number } | null {
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const entry = this.schedule[i];
      if (entry?.kind === 'ramp') return { value: entry.value, time: entry.time };
    }
    return null;
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs = new Set<AudioNodeLike>();
  disconnected = 0;

  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.add(destination);
    return destination;
  }

  disconnect(): void {
    this.outputs.clear();
    this.disconnected += 1;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

export class FakePanner extends FakeNode implements PannerNodeLike {
  panningModel: 'equalpower' | 'HRTF' = 'equalpower';
  distanceModel: 'linear' | 'inverse' | 'exponential' = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);
  readonly orientationX = new FakeParam(1);
  readonly orientationY = new FakeParam(0);
  readonly orientationZ = new FakeParam(0);
}

export class FakeBuffer implements AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number, duration?: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = duration ?? length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new Error(`no channel ${channel}`);
    return data;
  }
}

export class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  readonly detune = new FakeParam(0);
  started: { when: number; offset: number } | null = null;
  stopped: number | null = null;

  start(when = 0, offset = 0): void {
    this.started = { when, offset };
  }

  stop(when = 0): void {
    this.stopped = when;
  }
}

export class FakeListener implements AudioListenerLike {
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);
  readonly forwardX = new FakeParam(0);
  readonly forwardY = new FakeParam(0);
  readonly forwardZ = new FakeParam(-1);
  readonly upX = new FakeParam(0);
  readonly upY = new FakeParam(1);
  readonly upZ = new FakeParam(0);
}

/** The legacy half of the fork, for the branch three also carries. */
export class LegacyFakeListener implements AudioListenerLike {
  position: [number, number, number] = [0, 0, 0];
  orientation: number[] = [];

  setPosition(x: number, y: number, z: number): void {
    this.position = [x, y, z];
  }

  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this.orientation = [fx, fy, fz, ux, uy, uz];
  }
}

export class FakeContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextStateLike = 'running';
  readonly destination = new FakeNode();
  listener: AudioListenerLike = new FakeListener();
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly sources: FakeSource[] = [];
  resumed = 0;
  /** Set to make every decode reject, for the corrupted-file case. */
  decodeFails = false;

  createGain(): GainNodeLike {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createPanner(): PannerNodeLike {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(channels, length, sampleRate);
  }

  /**
   * Decodes the little JSON the fake loader encodes, so a test can say how long
   * a clip is and how many channels it has without shipping a `.wav`.
   */
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    if (this.decodeFails) throw new Error('Unable to decode audio data');
    const spec = JSON.parse(new TextDecoder().decode(data)) as {
      channels?: number;
      length?: number;
      sampleRate?: number;
      duration?: number;
    };
    const sampleRate = spec.sampleRate ?? this.sampleRate;
    const length = spec.length ?? 8;
    return new FakeBuffer(spec.channels ?? 1, length, sampleRate, spec.duration);
  }

  async resume(): Promise<void> {
    this.resumed += 1;
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  /** Moves the clock, which is how a sound gets to be over. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

/** Encodes a clip spec the fake context knows how to decode. */
export function clipBytes(spec: {
  channels?: number;
  length?: number;
  sampleRate?: number;
  duration?: number;
}): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(spec));
  // A fresh buffer rather than `encoded.buffer`, whose type depends on how the
  // encoder allocated it.
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return bytes.buffer;
}
