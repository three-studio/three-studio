import { fixedId, type Disposable } from '@three-studio/core';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import { Input } from './Input';
import { provideInput } from './inputOf';

/**
 * What the game hears, on the element the host hands its world. No phase of
 * its own: `Input` is told by the browser's events, and those who read it read
 * it when they need it.
 */
export const inputSubsystem: SubsystemDefinition = {
  id: fixedId('subsystem', 'input'),
  create(world) {
    const { element, input } = world.options;
    // Nothing to listen on: a test that presses nothing. `inputOf` answers
    // `null`, and a player controller declines to be built.
    if (element === undefined) return { dispose() {} };
    return new InputSubsystem(world, new Input(element, input));
  },
};

class InputSubsystem implements Subsystem {
  private readonly provided: Disposable;

  constructor(
    world: World,
    private readonly input: Input,
  ) {
    this.provided = provideInput(world, input);
  }

  dispose(): void {
    this.provided.dispose();
    this.input.dispose();
  }
}
