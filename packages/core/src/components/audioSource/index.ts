import { defineComponent } from '../registry';
import { audioSourceSchema } from './schema';

/** A sound the game plays: see `audioSourceSchema`. */
export const audioSourceType = defineComponent({
  id: 'audioSource',
  label: 'Audio Source',
  version: 1,
  schema: audioSourceSchema,
  runtime: true,
  addable: true,
});
