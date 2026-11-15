import { activateCore, createCoreRegistries, type CoreRegistries } from '@three-studio/core';

/**
 * The desktop main's registries with the kernel's built-ins in them, as its
 * composition root makes them: core alone.
 *
 * A test file holds one at its top and hands it to whatever it decodes, exports
 * or writes. A test that registers something of its own makes registries of its
 * own, so what it adds reaches no other test.
 */
export function builtInRegistries(): CoreRegistries {
  const registries = createCoreRegistries();
  activateCore(registries);
  return registries;
}
