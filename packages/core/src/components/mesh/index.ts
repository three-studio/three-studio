import { defineComponent } from '../registry';
import { meshSchema } from './schema';

/** A primitive three draws: see `meshSchema`. */
export const meshType = defineComponent({
  id: 'mesh',
  label: 'Mesh',
  version: 1,
  schema: meshSchema,
  runtime: true,
  addable: true,
});
