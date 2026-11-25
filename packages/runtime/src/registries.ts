import {
  Registry,
  combineDisposables,
  createCoreRegistries,
  type ComponentTypeId,
  type CoreRegistries,
  type Disposable,
  type ScriptMembersId,
  type SubsystemId,
} from '@three-studio/core';
import { audioScriptMembers } from './audio/scriptMembers';
import { audioSubsystem } from './audio/audioSubsystem';
import { inputSubsystem } from './input/inputSubsystem';
import { physicsScriptMembers } from './physics/scriptMembers';
import { physicsSubsystem } from './physics/physicsSubsystem';
import { audioListenerBehaviour, audioSourceBehaviour } from './behaviour/audio';
import type { BehaviourDefinition } from './behaviour/Behaviour';
import { batchingSubsystem } from './batchingSubsystem';
import { behaviourSubsystem } from './behaviour/behaviours';
import { cameraSystem } from './components/camera';
import { lightSystem } from './components/light';
import { meshSystem } from './components/mesh';
import { modelSystem } from './components/model';
import { waterSystem } from './components/water';
import { playerControllerBehaviour } from './controllers/PlayerController';
import type { ScriptMembersDefinition } from './scripting/members';
import { scriptBehaviour } from './scripting/ScriptHost';
import { scriptsSubsystem } from './scripting/ScriptWorld';
import type { SystemDefinition } from './systems/ComponentSystem';
import type { SubsystemDefinition } from './world/World';

/**
 * What the runtime runs a scene with: the core's component types, the system
 * that draws each type that has something to show, the behaviour of each type
 * that acts, the subsystems that simulate in Play, and what each feature gives
 * scripts.
 *
 * Made by a composition root and handed to the world, which builds from it
 * whatever it runs. Nothing registers by being imported: a module the root does
 * not activate is a module the game does not have.
 */
export interface RuntimeRegistries extends CoreRegistries {
  readonly systems: Registry<ComponentTypeId, SystemDefinition>;
  readonly behaviours: Registry<ComponentTypeId, BehaviourDefinition>;
  readonly subsystems: Registry<SubsystemId, SubsystemDefinition>;
  readonly scriptMembers: Registry<ScriptMembersId, ScriptMembersDefinition>;
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

/**
 * What the kernel's features give scripts, installed into each script in this
 * order: physics' body and collision hooks, then audio's mix.
 */
const SCRIPT_MEMBERS: readonly ScriptMembersDefinition[] = [physicsScriptMembers, audioScriptMembers];

/**
 * The kernel's subsystems, built in this order, which is also the order of two
 * at one place in a phase. The scripts before the behaviours, which make each
 * script and read what the scripts share as they do; the behaviours after the
 * four they reach, and made here, handed the registries' table of them, so
 * that the world never names it; the batching last, in the frame's last phase.
 */
function kernelSubsystems(registries: RuntimeRegistries): readonly SubsystemDefinition[] {
  return [
    inputSubsystem,
    physicsSubsystem,
    audioSubsystem,
    scriptsSubsystem(registries.scriptMembers),
    behaviourSubsystem(registries.behaviours),
    batchingSubsystem,
  ];
}

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
    scriptMembers: new Registry('script contribution'),
  };
}

/** Registers the kernel's systems, behaviours, subsystems and script members. Disposing takes them out again. */
export function activateRuntime(registries: RuntimeRegistries): Disposable {
  return combineDisposables([
    ...SYSTEMS.map((system) => registries.systems.register(system)),
    ...BEHAVIOURS.map((behaviour) => registries.behaviours.register(behaviour)),
    ...kernelSubsystems(registries).map((subsystem) => registries.subsystems.register(subsystem)),
    ...SCRIPT_MEMBERS.map((members) => registries.scriptMembers.register(members)),
  ]);
}
