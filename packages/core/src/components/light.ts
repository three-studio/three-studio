import { createLight } from '../scene/defaults';
import { defineComponent } from './registry';

/**
 * A light of any of the seven kinds.
 *
 * `fill` bases on the *stored* kind, not on a fixed one. three's units differ by
 * an order of magnitude between kinds — a directional light's default intensity
 * is 2 and a point light's is 12 — so filling every light against the point
 * defaults handed a stored directional light six times the brightness its author
 * chose. That is rule 2 of the persisted-format rules read to the letter and
 * missed in spirit: the factory is the source of the defaults, and the factory
 * takes a kind.
 *
 * `shadow` is merged a level deeper, like `mesh`'s material and geometry, for
 * the same reason: a scene written before the settings existed carries a light
 * with no `shadow` at all, and a shallow spread would leave three reading
 * `undefined` off every field of it.
 */
export const lightComponent = defineComponent({
  type: 'light',
  create: () => createLight('point'),
  fill: (stored) => {
    const base = createLight(stored.kind ?? 'point');
    return { ...base, ...stored, shadow: { ...base.shadow, ...stored.shadow } };
  },
  assets: (component) => [component.mapId],
  icon: 'lightbulb',
  runtime: true,
});
