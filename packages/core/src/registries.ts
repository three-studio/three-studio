import { Registry } from './Registry';
import type { AssetImporter } from './assets/import/AssetImporter';
import { AudioImporter } from './assets/import/importers/AudioImporter';
import {
  MaterialImporter,
  PhysicsMaterialImporter,
  PrefabImporter,
  ScriptImporter,
  ShaderImporter,
} from './assets/import/importers/dataImporters';
import { FbxImporter } from './assets/import/importers/FbxImporter';
import { GltfImporter } from './assets/import/importers/GltfImporter';
import { ObjImporter } from './assets/import/importers/ObjImporter';
import { TextureImporter } from './assets/import/importers/TextureImporter';
import { audioListenerComponent } from './components/audioListener';
import { audioSourceComponent } from './components/audioSource';
import { cameraComponent } from './components/camera';
import { colliderComponent } from './components/collider';
import { jointComponent } from './components/joint';
import { lightComponent } from './components/light';
import { meshComponent } from './components/mesh';
import { modelComponent } from './components/model';
import { playerControllerComponent } from './components/playerController';
import { prefabInstanceComponent } from './components/prefabInstance';
import type { ComponentDefinition } from './components/registry';
import { rigidbodyComponent } from './components/rigidbody';
import { scriptComponent } from './components/script';
import { waterComponent } from './components/water';
import { combineDisposables, type Disposable } from './disposable';
import type { ImporterId } from './ids';
import type { ComponentTypeId } from './scene/schema';

/**
 * What the core knows by registration: the component types, and the formats a
 * file is imported from.
 *
 * Made by a composition root, filled by activating, and handed to every
 * function that reads one — decoding a scene, expanding prefabs, walking
 * references, telling what a file is. Nothing registers by being imported: a
 * type or a format the root does not activate is one this window, page or
 * process does not know.
 */
export interface CoreRegistries {
  readonly components: Registry<ComponentTypeId, ComponentDefinition>;
  readonly importers: Registry<ImporterId, AssetImporter>;
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
];

/**
 * The kernel's importers, in the order ties are resolved: the first that claims
 * a file takes it.
 *
 * Ambiguity lives entirely at the top of this list, so it is worth reading as
 * an ordering rather than as a set:
 *
 *   * `.prefab.json` before `.material.*`, or a prefab would be a material.
 *   * `.physics-material.json` before `.material.*` too, for the same reason.
 *   * `.material.ts` before `.ts`, or a TSL material would be a script.
 *   * a bare `.json` falls through to the material importer, which is where it
 *     landed before this list existed and where it must keep landing.
 */
const IMPORTERS: readonly AssetImporter[] = [
  new PrefabImporter(),
  new PhysicsMaterialImporter(),
  new MaterialImporter(),
  new ScriptImporter(),
  new GltfImporter(),
  new FbxImporter(),
  new ObjImporter(),
  new TextureImporter(),
  new AudioImporter(),
  new ShaderImporter(),
];

/** The core's registries, empty. A root fills them by activating. */
export function createCoreRegistries(): CoreRegistries {
  return { components: new Registry('component type'), importers: new Registry('importer') };
}

/** Registers the kernel's component types and importers. Disposing takes them out again. */
export function activateCore(registries: CoreRegistries): Disposable {
  return combineDisposables([
    ...COMPONENTS.map((definition) => registries.components.register(definition)),
    ...IMPORTERS.map((importer) => registries.importers.register(importer)),
  ]);
}
