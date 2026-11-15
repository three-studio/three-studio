import { defineComponent } from '../registry';
import { modelSchema } from './schema';

/**
 * An imported model: see `modelSchema`. Not offered by Add Component — it
 * comes from dropping a file, and an empty one would point at nothing.
 */
export const modelType = defineComponent({
  id: 'model',
  label: 'Model',
  version: 1,
  schema: modelSchema,
  runtime: true,
  addable: false,
});
