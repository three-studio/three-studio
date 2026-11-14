import { Registry, combineDisposables, type ComponentTypeId, type Disposable } from '@three-studio/core';
import { audioListenerBehaviour, audioSourceBehaviour } from './behaviour/audio';
import type { BehaviourDefinition } from './behaviour/Behaviour';
import { cameraSystem } from './components/camera';
import { lightSystem } from './components/light';
import { meshSystem } from './components/mesh';
import { modelSystem } from './components/model';
import { particleEmitterSystem } from './components/particleEmitter';
import { waterSystem } from './components/water';
import { playerControllerBehaviour } from './controllers/PlayerController';
import { scriptBehaviour } from './scripting/ScriptHost';
import type { SystemDefinition } from './systems/ComponentSystem';

/**
 * What the runtime runs a scene with: the system that draws each type that has
 * something to show, and the behaviour of each type that acts.
 *
 * Made by a composition root and handed to the engine, which builds from it
 * whatever it runs. Nothing registers by being imported: a module the root does
 * not activate is a module the game does not have.
 */
export interface RuntimeRegistries {
  readonly systems: Registry<ComponentTypeId, SystemDefinition>;
  readonly behaviours: Registry<ComponentTypeId, BehaviourDefinition>;
}

/*
 * The kernel's own, in the order they used to register in. The systems' is the
 * order the slices were imported in. The behaviours' is the order the engine
 * imported their modules in, and it is the order each phase runs them in: a
 * script's `onLateUpdate` runs after the player controller has placed its
 * camera for the frame, and reads it there.
 */
const SYSTEMS: readonly SystemDefinition[] = [
  meshSystem,
  modelSystem,
  lightSystem,
  cameraSystem,
  waterSystem,
  particleEmitterSystem,
];

const BEHAVIOURS: readonly BehaviourDefinition[] = [
  audioSourceBehaviour,
  audioListenerBehaviour,
  playerControllerBehaviour,
  scriptBehaviour,
];

/** The runtime's registries, empty. A root fills them by activating. */
export function createRuntimeRegistries(): RuntimeRegistries {
  return {
    systems: new Registry('system'),
    behaviours: new Registry('behaviour'),
  };
}

/** Registers the kernel's systems and behaviours. Disposing takes them out again. */
export function activateRuntime(registries: RuntimeRegistries): Disposable {
  return combineDisposables([
    ...SYSTEMS.map((system) => registries.systems.register(system)),
    ...BEHAVIOURS.map((behaviour) => registries.behaviours.register(behaviour)),
  ]);
}
