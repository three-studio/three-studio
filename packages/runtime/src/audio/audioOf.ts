import type { Disposable } from '@three-studio/core';
import type { AudioEngine } from './AudioEngine';

/*
 * Each world's audio engine, keyed by the world.
 *
 * A `WeakMap` rather than a field of the world: the world knows no feature, and
 * a world nobody holds takes its entry with it. Keyed by any object rather than
 * by `World`, because the world still builds the behaviours' context, which
 * hands this engine to the audio behaviours and the scripts, and so imports
 * this file: naming `World` here would import the world back.
 */
const engines = new WeakMap<object, AudioEngine>();

/**
 * The engine a world mixes into: `null` for a world handed no audio context — a
 * test, or a browser with no Web Audio.
 */
export function audioOf(world: object): AudioEngine | null {
  return engines.get(world) ?? null;
}

/** Files `engine` as `world`'s until the result is disposed: the audio subsystem's, while it lives. */
export function provideAudio(world: object, engine: AudioEngine): Disposable {
  engines.set(world, engine);
  return { dispose: () => void engines.delete(world) };
}
