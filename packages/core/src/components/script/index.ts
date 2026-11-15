import { defineComponent } from '../registry';
import { scriptSchema } from './schema';

/** A user script and its declared properties: see `scriptSchema`. */
export const scriptType = defineComponent({
  id: 'script',
  label: 'Script',
  version: 1,
  schema: scriptSchema,
  runtime: true,
  addable: true,
});
