/*
 * Every component type, imported so that it registers.
 *
 * Registration is a side effect of the import, and a module nobody imports
 * registers nothing — the type then goes missing with no error at all. This file
 * is the single place that has to be complete, and `registry.test.ts` counts what
 * arrives against `COMPONENT_TYPES`.
 *
 * **That check starts from the list and looks for the code.** The throw below and
 * that test both do, and neither can see the other direction: a folder on disk
 * that nobody listed registers nothing, throws nothing, and fails nothing — the
 * type simply does not exist, and the author who wrote nine files finds out by
 * noticing their component is missing from a menu. `test/componentRegistration.test.ts`
 * starts from the folders instead, and is the only thing that catches it.
 */
import { COMPONENT_TYPES } from '../scene/components';
import { createColliderFor } from './collider/defaults';
import type { EntityTemplate } from '../scene/entity';
import type { ComponentDoc, ComponentOfType, ComponentType } from '../scene/schema';
import { componentDefinition, componentIsPlaceable } from './registry';

import './mesh';
import './model';
import './light';
import './camera';
import './rigidbody';
import './collider';
import './audioSource';
import './audioListener';
import './script';
import './prefabInstance';
import './playerController';
import './water';
import './particleEmitter';

/*
 * Checked here, once, rather than trusted.
 *
 * A missing import above does not fail — it makes the type *quietly* absent, and
 * the failure surfaces far away: `fillComponent` hands a stored component back
 * unfilled, and the `undefined` reaches three several layers later. That exact
 * shape of bug has shipped twice on this project, both times as a field the
 * migration did not fill.
 *
 * Throwing at import turns it into the first thing anyone sees, in production as
 * well as in the test that counts the same list.
 */
const unregistered = COMPONENT_TYPES.filter((type) => componentDefinition(type) === undefined);
if (unregistered.length > 0) {
  throw new Error(`Component types declared but never registered: ${unregistered.join(', ')}.`);
}

/**
 * Whether a template's transform describes a place in the world.
 *
 * Here rather than in `scene/defaults.ts`, where it used to name `'light'` and
 * carry that type's table of kinds: the answer is now the types' own, and this
 * is the module that asks the registry a question on behalf of a whole thing.
 *
 * An empty carries no components and is still a place: it exists to hold
 * whatever gets dragged under it, so it belongs where the author is looking.
 * Beyond that one component that means to be somewhere is enough — a light on a
 * lamp post is on the lamp post even if the lamp is ambient.
 */
export function isPlaceable(template: EntityTemplate): boolean {
  if (template.components.length === 0) return true;
  return template.components.some(componentIsPlaceable);
}

export {
  addableTypes,
  componentAssets,
  componentDefinition,
  componentDefinitions,
  componentIsPlaceable,
  defineComponent,
  fillComponent,
  typesWithoutRuntime,
  type ComponentDefinition,
  type ComponentIcon,
} from './registry';

/**
 * Blank instance of a component type, used by "Add Component" in the inspector.
 *
 * Lives here rather than in `defaults.ts` for two reasons. The modules above
 * import their factories from `defaults.ts`, so a lookup there would close a
 * cycle — three of those have already been paid for on this refactor. And the
 * table is only complete once those eleven imports have run: being in the same
 * module as them is what makes "the type is registered" true by construction
 * rather than by hope.
 *
 * Throws on a type it does not know rather than falling back. The chain this
 * replaced ended in `createPlayerController()`, so a component from a plugin or
 * a hand-edited file came back as a player controller with the original's fields
 * glued on — which the migration then wrote to disk.
 */
export function createComponent<T extends ComponentType>(type: T): ComponentOfType<T> {
  const definition = componentDefinition(type);
  if (!definition) throw new Error(`Unknown component type "${type}".`);
  return definition.create();
}

/**
 * Like `createComponent`, but shapes the defaults from what the entity already
 * has — a collider added to a capsule mesh comes out as a matching capsule.
 *
 * Not a facet of the registry: it reads a *sibling* component, which is a fact
 * about the entity rather than about the type. Only `collider` has ever wanted
 * it, and a `createFor(entity)` on all twelve definitions would be eleven
 * copies of `create()` to serve one. So one type asks for it and one type
 * carries it: the guess itself lives in `collider/defaults.ts`, with the rest
 * of what a collider knows about itself.
 *
 * Takes the siblings rather than the entity: an entity no longer holds them,
 * and handing over the document would put a scene-wide argument on a function
 * that reads exactly two components.
 */
export function createComponentForEntity<T extends ComponentType>(
  type: T,
  siblings: readonly ComponentDoc[],
): ComponentOfType<T> {
  if (type !== 'collider') return createComponent(type);
  return createColliderFor(siblings) as ComponentOfType<T>;
}
