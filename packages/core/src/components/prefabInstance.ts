import { blankComponent as blank } from '../scene/defaults';
import { defineComponent } from './registry';

/**
 * A placement of a prefab asset.
 *
 * `assets` names the prefab, and the expansion follows it into its contents from
 * there — an instance is one id that arrives with a model and four textures
 * behind it.
 */
export const prefabInstanceComponent = defineComponent({
  type: 'prefabInstance',
  create: () => blank('prefabInstance'),
  fill: (stored) => ({ ...blank('prefabInstance'), ...stored }),
  assets: (component) => [component.assetId],
  icon: 'boxes',
  runtime: true,
});
