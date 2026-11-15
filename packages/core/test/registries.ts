import { activateCore } from '../src/activate';
import { createCoreRegistries, type CoreRegistries } from '../src/registries';

/**
 * Core's registries with the kernel's built-ins in them, as a root makes them.
 *
 * A test file holds one at its top and hands it to whatever it decodes, fills or
 * walks. A test that registers something of its own makes registries of its
 * own, so what it adds reaches no other test.
 */
export function builtInRegistries(): CoreRegistries {
  const registries = createCoreRegistries();
  activateCore(registries);
  return registries;
}
