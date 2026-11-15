import { defineComponent } from '../registry';
import { cameraSchema } from './schema';

/** A camera the game can look through: see `cameraSchema`. */
export const cameraType = defineComponent({
  id: 'camera',
  label: 'Camera',
  version: 1,
  schema: cameraSchema,
  runtime: true,
  addable: true,
});
