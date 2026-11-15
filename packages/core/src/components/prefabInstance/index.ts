import { defineComponent } from '../registry';
import { prefabInstanceSchema } from './schema';

/**
 * A prefab, placed: see `prefabInstanceSchema`. Not offered by Add Component —
 * it comes from placing a prefab, and an empty one would point at nothing.
 */
export const prefabInstanceType = defineComponent({
  id: 'prefabInstance',
  label: 'Prefab',
  version: 1,
  schema: prefabInstanceSchema,
  runtime: true,
  addable: false,
});
