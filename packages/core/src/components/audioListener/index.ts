import { defineComponent } from '../registry';
import { audioListenerSchema } from './schema';

/** What the game hears through: see `audioListenerSchema`. */
export const audioListenerType = defineComponent({
  id: 'audioListener',
  label: 'Audio Listener',
  version: 1,
  schema: audioListenerSchema,
  runtime: true,
  addable: true,
});
