import { defineComponent } from '../registry';
import { particleEmitterSchema } from './schema';

/**
 * A stream of billboarded particles.
 *
 * Written as a schema, the first type to be: its blank component, its decoder
 * and the sprite it names — so the exporter ships it, the loading bar counts
 * it, and deleting it does not claim nothing uses it — all come from
 * `particleEmitterSchema`, and nothing here repeats a field.
 */
export const particleEmitterComponent = defineComponent({
  id: 'particleEmitter',
  label: 'Particles',
  schema: particleEmitterSchema,
  icon: 'sparkles',
  runtime: true,
  addable: true,
});
