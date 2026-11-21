import { fixedId, type Disposable } from '@three-studio/core';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import { Input, type InputOptions } from './Input';
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
    return new InputSubsystem(world, element, input);
  },
};

/**
 * Listens from `start`, not from its making. A scene built behind a loading
 * scene is made while the loading scene plays on the same canvas: an `Input`
 * listening through the build added up every pixel the mouse moved across the
 * loading screen and handed them all to the level's first frame, which turned
 * the player's view by as much at once; and a click asked for the pointer
 * lock twice. The behaviours, made at `start` after this, find it there.
 */
class InputSubsystem implements Subsystem {
  private input: Input | null = null;
  private provided: Disposable | null = null;

  constructor(
    private readonly world: World,
    private readonly element: HTMLElement,
    private readonly options: InputOptions | undefined,
  ) {}

  start(): void {
    const input = new Input(this.element, this.options);
    this.input = input;
    this.provided = provideInput(this.world, input);
  }

  dispose(): void {
    this.provided?.dispose();
    this.input?.dispose();
  }
}
