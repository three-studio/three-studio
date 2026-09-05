import { defineComponent } from '../registry';
import { createLight } from './defaults';

/*
 * Everything that makes a light a light: the type it is stored as, the
 * factories that produce one, and the definition that registers it.
 *
 * The first slice, and the pattern the others follow. What it buys is visible
 * in the imports above: the definition no longer reaches into
 * `scene/defaults.ts` for its factory, because the factory is next door. That
 * one edge is what `components/index.ts` had to route around to look a blank
 * component up, and three cycles were paid for on this refactor before it went.
 *
 * `light` went first because it is the hard case rather than the easy one — see
 * `fill` below. A pattern proved on a type whose `fill` is a one-line spread
 * would have proved nothing about the ones that are not.
 *
 * Not a barrel, and it must not become one: importing this module *registers*
 * the type, and registration order is the order the Add Component menu is
 * built in. `scene/defaults.ts` and `core/src/index.ts` therefore reach past it
 * to `./schema` and `./defaults`, which have no side effect, and the only thing
 * that imports this file is the one place that means to register everything.
 */

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
  addable: true,
});
