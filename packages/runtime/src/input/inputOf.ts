import type { Disposable } from '@three-studio/core';
import type { World } from '../world/World';
import type { Input } from './Input';

/*
 * Each world's `Input`, keyed by the world, as `audioOf` is and for the same
 * reasons.
 */
const inputs = new WeakMap<World, Input>();

/**
 * What a world's game hears from the keyboard, the mouse and the touch
 * controls: `null` for a world handed no element to listen on, which only a
 * test builds.
 */
export function inputOf(world: World): Input | null {
  return inputs.get(world) ?? null;
}

/** Files `input` as `world`'s until the result is disposed: the input subsystem's, while it lives. */
export function provideInput(world: World, input: Input): Disposable {
  inputs.set(world, input);
  return { dispose: () => void inputs.delete(world) };
}
