import { Registry } from './Registry';
import { audioListenerComponent } from './components/audioListener';
import { audioSourceComponent } from './components/audioSource';
import { cameraComponent } from './components/camera';
import { colliderComponent } from './components/collider';
import { jointComponent } from './components/joint';
import { lightComponent } from './components/light';
import { meshComponent } from './components/mesh';
import { modelComponent } from './components/model';
import { particleEmitterComponent } from './components/particleEmitter';
import { playerControllerComponent } from './components/playerController';
import { prefabInstanceComponent } from './components/prefabInstance';
import type { ComponentDefinition } from './components/registry';
import { rigidbodyComponent } from './components/rigidbody';
import { scriptComponent } from './components/script';
import { waterComponent } from './components/water';
import { combineDisposables, type Disposable } from './disposable';
import type { ComponentTypeId } from './scene/schema';

/**
 * What the core knows by registration: the component types.
 *
 * Made by a composition root, filled by activating, and handed to every
 * function that reads one — decoding a scene, expanding prefabs, walking
 * references. Nothing registers by being imported: a type the root does not
 * activate is a type this window, page or process does not know.
 */
export interface CoreRegistries {
  readonly components: Registry<ComponentTypeId, ComponentDefinition>;
}

/**
 * The kernel's component types, in the order the Add Component menu offers
 * them: the order their modules used to be imported in to register.
 */
const COMPONENTS: readonly ComponentDefinition[] = [
  meshComponent,
  modelComponent,
  lightComponent,
  cameraComponent,
  rigidbodyComponent,
  colliderComponent,
  jointComponent,
  audioSourceComponent,
  audioListenerComponent,
  scriptComponent,
  prefabInstanceComponent,
  playerControllerComponent,
  waterComponent,
  particleEmitterComponent,
];

/** The core's registries, empty. A root fills them by activating. */
export function createCoreRegistries(): CoreRegistries {
  return { components: new Registry('component type') };
}

/** Registers the kernel's component types. Disposing takes them out again. */
export function activateCore(registries: CoreRegistries): Disposable {
  return combineDisposables(COMPONENTS.map((definition) => registries.components.register(definition)));
}
