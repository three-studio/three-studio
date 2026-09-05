import { defineComponent } from '../registry';
import { createPrefabInstance } from './defaults';

/**
 * A placement of a prefab asset.
 *
 * `assets` names the prefab, and the expansion follows it into its contents from
 * there — an instance is one id that arrives with a model and four textures
 * behind it.
 */
export const prefabInstanceComponent = defineComponent({
  type: 'prefabInstance',
  create: () => createPrefabInstance(),
  fill: (stored) => ({ ...createPrefabInstance(), ...stored }),
  assets: (component) => [component.assetId],
  icon: 'boxes',
  placeable: () => true,
  runtime: true,
  addable: false,
});
