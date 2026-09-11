import { defineComponent } from '../registry';
import { createParticleEmitter } from './defaults';

/**
 * A stream of billboarded particles.
 *
 * No `fill`: every field is a scalar, a string or a tuple, so the default
 * `{ ...create(), ...stored }` is already right. The three types that override
 * it own a nested object; a `Vec3` is a value, not a level to merge through —
 * the same reason `Transform` is spread whole.
 */
export const particleEmitterComponent = defineComponent({
  type: 'particleEmitter',
  create: () => createParticleEmitter(),
  // Named so the exporter ships the sprite, the loading bar counts it, and
  // deleting it does not claim nothing uses it.
  assets: (component) => [component.spriteId],
  icon: 'sparkles',
  placeable: () => true,
  runtime: true,
  addable: true,
});
