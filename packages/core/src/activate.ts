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
import { audioListenerType } from './components/audioListener';
import { audioSourceType } from './components/audioSource';
import { cameraType } from './components/camera';
import { colliderType } from './components/collider';
import { jointType } from './components/joint';
import { lightType } from './components/light';
import { meshType } from './components/mesh';
import { modelType } from './components/model';
import { playerControllerType } from './components/playerController';
import { prefabInstanceType } from './components/prefabInstance';
import type { ComponentDefinition } from './components/registry';
import { rigidbodyType } from './components/rigidbody';
import { scriptType } from './components/script';
import { waterType } from './components/water';
import { combineDisposables, type Disposable } from './disposable';
import type { CoreRegistries } from './registries';

/**
 * The kernel's component types, in the order the Add Component menu offers
 * them: the order their modules used to be imported in to register.
 */
const COMPONENTS: readonly ComponentDefinition[] = [
  meshType,
  modelType,
  lightType,
  cameraType,
  rigidbodyType,
  colliderType,
  jointType,
  audioSourceType,
  audioListenerType,
  scriptType,
  prefabInstanceType,
  playerControllerType,
  waterType,
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

/** Registers the kernel's component types and importers. Disposing takes them out again. */
export function activateCore(registries: CoreRegistries): Disposable {
  return combineDisposables([
    ...COMPONENTS.map((definition) => registries.components.register(definition)),
    ...IMPORTERS.map((importer) => registries.importers.register(importer)),
  ]);
}
