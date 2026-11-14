import { activateCore, createCoreRegistries, type CoreRegistries } from '@three-studio/core';

/**
 * Core's registries with the kernel's built-ins in them, as the desktop main
 * makes them: what the harness decodes, writes and exports a project through
 * when it does so itself, outside the editor it measures.
 */
export function builtInRegistries(): CoreRegistries {
  const registries = createCoreRegistries();
  activateCore(registries);
  return registries;
}
