import { defineComponent } from '../registry';
import { colliderSchema } from './schema';

/** What a collider is: see `colliderSchema`. */
export const colliderType = defineComponent({
  id: 'collider',
  label: 'Collider',
  version: 1,
  schema: colliderSchema,
  runtime: true,
  addable: true,
});
