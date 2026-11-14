import type { ComponentDefinition } from '../registry';
import { createPrefabInstance } from './defaults';
import type { PrefabInstanceComponent } from './schema';

/**
 * A placement of a prefab asset.
 *
 * `assets` names the prefab, and the expansion follows it into its contents from
 * there — an instance is one id that arrives with a model and four textures
 * behind it.
 */
export const prefabInstanceComponent: ComponentDefinition<PrefabInstanceComponent> = {
  id: 'prefabInstance',
  label: 'Prefab',
  create: () => createPrefabInstance(),
  assets: (component) => [component.assetId],
  entities: () => [],
  placeable: () => true,
  runtime: true,
  addable: false,
};
