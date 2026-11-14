import { activateRuntime, createRuntimeRegistries, type RuntimeRegistries } from '../src/registries';

/**
 * The runtime's registries with the kernel's built-ins in them, as a root
 * makes them.
 *
 * A test file holds one at its top and hands it to whatever it builds. A test
 * that registers something of its own makes registries of its own, so what it
 * adds reaches no other test.
 */
export function builtInRegistries(): RuntimeRegistries {
  const registries = createRuntimeRegistries();
  activateRuntime(registries);
  return registries;
}
