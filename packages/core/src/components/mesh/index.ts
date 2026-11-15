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
  // A mesh and a model both draw, from the same container, and both get
  // drawn: Add Component ▸ Mesh on an imported model put a grey 1×1×1 box
  // through it, which reads as the model duplicated rather than as a second
  // component added. Read both ways, so the model need not say it too.
  excludes: ['model'],
});
