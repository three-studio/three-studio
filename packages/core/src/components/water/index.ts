import { defineComponent } from '../registry';
import { waterSchema } from './schema';

/** A water surface: see `waterSchema`. */
export const waterType = defineComponent({
  id: 'water',
  label: 'Water',
  version: 1,
  schema: waterSchema,
  runtime: true,
  addable: true,
});
