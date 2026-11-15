import { defineComponent } from '../registry';
import { jointSchema } from './schema';

/** Two bodies held together: see `jointSchema`. */
export const jointType = defineComponent({
  id: 'joint',
  label: 'Joint',
  version: 1,
  schema: jointSchema,
  runtime: true,
  addable: true,
});
