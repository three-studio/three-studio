import type { Disposable } from '@three-studio/core';
import type { Input } from './Input';

/*
 * Each world's `Input`, keyed by the world: as `audioOf` is, and keyed by any
 * object for the same reason — the world still builds the behaviours' context,
 * which hands this to the player controllers and the scripts, and so imports
 * this file.
 */
const inputs = new WeakMap<object, Input>();

/**
 * What a world's game hears from the keyboard, the mouse and the touch
 * controls: `null` for a world handed no element to listen on, which only a
 * test builds.
 */
export function inputOf(world: object): Input | null {
  return inputs.get(world) ?? null;
}

/** Files `input` as `world`'s until the result is disposed: the input subsystem's, while it lives. */
export function provideInput(world: object, input: Input): Disposable {
  inputs.set(world, input);
  return { dispose: () => void inputs.delete(world) };
}
