import { Registry } from './Registry';
import type { AssetImporter } from './assets/import/AssetImporter';
import type { ComponentDefinition } from './components/registry';
import type { ImporterId } from './ids';
import type { ComponentTypeId } from './scene/schema';

/*
 * What the core's registries are, apart from what the kernel puts in them,
 * which `activate.ts` lists. Every function a registry is handed to reads this
 * file — the scene's queries among them — and a type the kernel registers may
 * call those: a Rigid Body asks which colliders ride it. Had this file listed
 * the built-ins too, that type would import itself through the scene's queries.
 */

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

/** The core's registries, empty. A root fills them by activating. */
export function createCoreRegistries(): CoreRegistries {
  return { components: new Registry('component type'), importers: new Registry('importer') };
}
