import { defineComponent } from '../registry';
import { rigidbodySchema } from './schema';

/** A body physics moves: see `rigidbodySchema`. */
export const rigidbodyType = defineComponent({
  id: 'rigidbody',
  label: 'Rigid Body',
  version: 1,
  schema: rigidbodySchema,
  runtime: true,
  addable: true,
});
