/*
 * The part of the Web Audio API this engine depends on, and nothing more.
 *
 * Declared structurally rather than imported from `lib.dom` for one reason:
 * **vitest runs in `environment: 'node'`**, where the *types* exist and the
 * *values* do not. `new AudioContext()` in a constructor makes the whole module
 * unloadable in a test, and everything worth testing here — the mix, the solo,
 * the crossfade, the voice stealing — becomes unobservable.
 *
 * So the context is a parameter (ADR-7), and a fake that satisfies these
 * interfaces is a few dozen lines. The real `AudioContext` satisfies them too:
 * every member below is a subset of the real shape, and the methods are
 * declared as methods rather than as properties holding functions, which leaves
 * their parameters bivariant under `strictFunctionTypes` — the same trick
 * `ComponentHelper.mount` uses, and for the same reason.
 *
 * What is deliberately *absent* is `onended`. Voices are harvested in
 * `AudioEngine.update()` by comparing `currentTime` to a computed end, which
 * makes "the sound finished" a function of a number a test can advance rather
 * than a callback a test has to provoke.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParamLike;
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike;
  cancelScheduledValues(startTime: number): AudioParamLike;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface PannerNodeLike extends AudioNodeLike {
  panningModel: 'equalpower' | 'HRTF';
  distanceModel: 'linear' | 'inverse' | 'exponential';
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  readonly positionX: AudioParamLike;
  readonly positionY: AudioParamLike;
  readonly positionZ: AudioParamLike;
  readonly orientationX: AudioParamLike;
  readonly orientationY: AudioParamLike;
  readonly orientationZ: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

/**
 * The ear, in Web Audio's own terms.
 *
 * Every member is optional because there are two generations of this API and
 * browsers do not agree on which they have: the `AudioParam` form
 * (`positionX`…) and the deprecated setter form. three carries the same fork —
 * `AudioListener.js:191` tests `listener.positionX` and falls back — and we
 * carry it for the same reason.
 */
export interface AudioListenerLike {
  positionX?: AudioParamLike;
  positionY?: AudioParamLike;
  positionZ?: AudioParamLike;
  forwardX?: AudioParamLike;
  forwardY?: AudioParamLike;
  forwardZ?: AudioParamLike;
  upX?: AudioParamLike;
  upY?: AudioParamLike;
  upZ?: AudioParamLike;
  setPosition?(x: number, y: number, z: number): void;
  setOrientation?(
    forwardX: number,
    forwardY: number,
    forwardZ: number,
    upX: number,
    upY: number,
    upZ: number,
  ): void;
}

/**
 * The states a context can be in, and there are four of them, not three.
 *
 * `'interrupted'` is the one that is easy to miss and expensive to miss: iOS
 * puts a context there for an incoming call, for Siri, for the ringer switch.
 * It is not `'suspended'`, so any code that tests for `'suspended'` alone leaves
 * an iPhone silent for the rest of the session — and nothing in the log says so.
 * `isStopped` below is the test to use.
 */
export type AudioContextStateLike = 'suspended' | 'running' | 'closed' | 'interrupted';

/** Whether a context needs `resume()` before anything can be heard. */
export function isStopped(state: AudioContextStateLike): boolean {
  return state === 'suspended' || state === 'interrupted';
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextStateLike;
  readonly destination: AudioNodeLike;
  readonly listener: AudioListenerLike;
  createGain(): GainNodeLike;
  createPanner(): PannerNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}
