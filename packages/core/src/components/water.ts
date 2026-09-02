import { createWater } from '../scene/defaults';
import { defineComponent } from './registry';

/**
 * A flat reflective water surface.
 *
 * `fill` merges the geometry a level deeper for the reason `mesh` does: it owns
 * a nested object, and a shallow spread would hand a scene saved before
 * `heightSegments` existed a plane with `undefined` in it.
 */
export const waterComponent = defineComponent({
  type: 'water',
  create: () => createWater(),
  fill: (stored) => {
    const base = createWater();
    const filled = { ...base, ...stored };
    filled.geometry = { ...base.geometry, ...filled.geometry };
    return filled;
  },
  // Named so the exporter ships the normal map, the loading bar counts it, and
  // deleting it does not claim nothing uses it.
  assets: (component) => [component.normalMapId],
  icon: 'waves',
  runtime: true,
});
