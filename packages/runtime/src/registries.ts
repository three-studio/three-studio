import {
  Registry,
  combineDisposables,
  createCoreRegistries,
  type ComponentTypeId,
  type CoreRegistries,
  type Disposable,
  type SubsystemId,
} from '@three-studio/core';
import { audioSubsystem } from './audio/audioSubsystem';
import { audioListenerBehaviour, audioSourceBehaviour } from './behaviour/audio';
import type { BehaviourDefinition } from './behaviour/Behaviour';
import { cameraSystem } from './components/camera';
import { lightSystem } from './components/light';
import { meshSystem } from './components/mesh';
import { modelSystem } from './components/model';
import { waterSystem } from './components/water';
import { playerControllerBehaviour } from './controllers/PlayerController';
import { scriptBehaviour } from './scripting/ScriptHost';
import type { SystemDefinition } from './systems/ComponentSystem';
import type { SubsystemDefinition } from './world/World';

/**
 * What the runtime runs a scene with: the core's component types, the system
 * that draws each type that has something to show, the behaviour of each type
 * that acts, and the subsystems that simulate in Play.
 *
 * Made by a composition root and handed to the world, which builds from it
 * whatever it runs. Nothing registers by being imported: a module the root does
 * not activate is a module the game does not have.
 */
export interface RuntimeRegistries extends CoreRegistries {
  readonly systems: Registry<ComponentTypeId, SystemDefinition>;
  readonly behaviours: Registry<ComponentTypeId, BehaviourDefinition>;
  readonly subsystems: Registry<SubsystemId, SubsystemDefinition>;
}

/*
 * The kernel's own, in the order they used to register in. The systems' is the
 * order the slices were imported in. The behaviours' is the order the runtime
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
];

const BEHAVIOURS: readonly BehaviourDefinition[] = [
  audioSourceBehaviour,
  audioListenerBehaviour,
  playerControllerBehaviour,
  scriptBehaviour,
];

/*
 * Built in this order, which is also the order of two at one place in a phase.
 */
const SUBSYSTEMS: readonly SubsystemDefinition[] = [audioSubsystem];

/**
 * The runtime's registries, the core's among them, all empty. A root fills them
 * by activating each layer: `activateCore`, then `activateRuntime`.
 */
export function createRuntimeRegistries(): RuntimeRegistries {
  return {
    ...createCoreRegistries(),
    systems: new Registry('system'),
    behaviours: new Registry('behaviour'),
    subsystems: new Registry('subsystem'),
  };
}

/** Registers the kernel's systems, behaviours and subsystems. Disposing takes them out again. */
export function activateRuntime(registries: RuntimeRegistries): Disposable {
  return combineDisposables([
    ...SYSTEMS.map((system) => registries.systems.register(system)),
    ...BEHAVIOURS.map((behaviour) => registries.behaviours.register(behaviour)),
    ...SUBSYSTEMS.map((subsystem) => registries.subsystems.register(subsystem)),
  ]);
}
