import { Registry, activateCore, type SubsystemId } from '@three-studio/core';
import { physicsSubsystem } from '../src/physics/physicsSubsystem';
import { activateRuntime, createRuntimeRegistries, type RuntimeRegistries } from '../src/registries';
import type { SubsystemDefinition, WorldRegistries } from '../src/world/World';

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
  activateCore(registries);
  activateRuntime(registries);
  return registries;
}

/**
 * The same registries with physics left out: a world built from them runs no
 * physics, as a test not about it wants — Rapier is the one slow thing to load.
 */
export function withoutPhysics(registries: WorldRegistries): WorldRegistries {
  const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
  for (const subsystem of registries.subsystems.values()) {
    if (subsystem !== physicsSubsystem) subsystems.register(subsystem);
  }
  return { ...registries, subsystems };
}
