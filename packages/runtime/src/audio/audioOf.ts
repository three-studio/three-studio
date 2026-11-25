import type { Disposable } from '@three-studio/core';
import type { World } from '../world/World';
import type { AudioEngine } from './AudioEngine';

/*
 * Each world's audio engine, keyed by the world.
 *
 * A `WeakMap` rather than a field of the world: the world knows no feature, and
 * a world nobody holds takes its entry with it. A file of its own, read by the
 * audio behaviours and the scripts as well as by the subsystem that fills it,
 * so that none of them imports another.
 */
const engines = new WeakMap<World, AudioEngine>();

/**
 * The engine a world mixes into: `null` for a world handed no audio context — a
 * test, or a browser with no Web Audio.
 */
export function audioOf(world: World): AudioEngine | null {
  return engines.get(world) ?? null;
}

/** Files `engine` as `world`'s until the result is disposed: the audio subsystem's, while it lives. */
export function provideAudio(world: World, engine: AudioEngine): Disposable {
  engines.set(world, engine);
  return { dispose: () => void engines.delete(world) };
}
