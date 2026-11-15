import type { ComponentDefinition } from '../components/registry';
import type { EntityId } from '../ids';
import type { CoreRegistries } from '../registries';
import type { ComponentDoc, ComponentTypeId, SceneDoc } from './schema';

/*
 * What the types on one entity allow each other, as each type declares it:
 * what it requires, what it excludes, whether it stacks, and what goes with
 * the drawing when the entity's drawing passes to others.
 *
 * Read here for every caller, so that none can disagree with another: the
 * menu that offers a type greys out what the command that adds it would
 * refuse. These rules were a command's own tables once, beside the menu's own
 * "no second of a type" — and a shortcut reaching the command could add a
 * second Camera the menu would never have offered.
 */

/**
 * Whether `type` may join an entity holding `present`: neither excludes the
 * other, and it is no second of a type that does not stack. A type the
 * registries do not hold fits nowhere, since nothing could make one; one on
 * the entity that they do not hold excludes nothing anyone can read.
 */
export function componentFits(
  registries: CoreRegistries,
  type: ComponentTypeId,
  present: ReadonlySet<ComponentTypeId>,
): boolean {
  const definition = registries.components.get(type);
  if (definition === undefined) return false;
  if (!definition.multiple && present.has(type)) return false;
  for (const other of present) {
    if (definition.excludes.includes(other)) return false;
    if (registries.components.get(other)?.excludes.includes(type) === true) return false;
  }
  return true;
}

/**
 * What adding `type` to an entity puts on it: the component, then each type it
 * requires that the entity neither holds nor has elsewhere, each followed by
 * what it requires in turn, in the order they are declared. `null` when one of
 * them does not fit beside what is there, so that nothing is added by halves.
 *
 * `held` is the entity's own components in the document, and `scene` the scene
 * as it is drawn, where what a prefab placed under the entity holds counts.
 *
 * The types held grow as the walk adds, so a player's new collider is the one
 * its new body requires, and two types requiring each other each come once.
 * Each new component is made for the components beside it by then: the
 * requirement's own `create`, or the required type's `createFor`.
 *
 * Throws on a requirement no activation registered: a type that names another
 * from its declaration is defined for a build that holds that one.
 */
export function componentsToAdd(
  registries: CoreRegistries,
  request: {
    readonly scene: SceneDoc;
    readonly entityId: EntityId;
    readonly type: ComponentTypeId;
    readonly held: readonly ComponentDoc[];
  },
): readonly ComponentDoc[] | null {
  const { scene, entityId, type, held } = request;
  const siblings = [...held];
  const present = new Set(held.map((component) => component.type));
  const added: ComponentDoc[] = [];

  const put = (component: ComponentDoc): void => {
    added.push(component);
    siblings.push(component);
    present.add(component.type);
  };

  /** Puts what `definition` requires and the entity lacks, and theirs; `false` at the first that does not fit. */
  const bring = (definition: ComponentDefinition): boolean => {
    for (const requirement of definition.requires) {
      if (present.has(requirement.type) || requirement.metElsewhere?.(scene, entityId) === true) continue;
      const required = registries.components.get(requirement.type);
      if (required === undefined) {
        throw new Error(`"${definition.id}" requires "${requirement.type}", a type no activation registered.`);
      }
      if (!componentFits(registries, requirement.type, present)) return false;
      put(requirement.create?.(siblings) ?? required.createFor(siblings));
      if (!bring(required)) return false;
    }
    return true;
  };

  const definition = registries.components.get(type);
  if (definition === undefined || !componentFits(registries, type, present)) return null;
  put(definition.createFor(siblings));
  return bring(definition) ? added : null;
}

/**
 * Those of `components` that go with the drawing when their entity's drawing
 * passes to other entities, as each type declares (`followsDrawing`): what
 * Unpack Model copies to every piece that draws and takes off the host. One
 * whose type the registries do not hold stays: nothing says it moves.
 */
export function componentsFollowingDrawing(
  registries: CoreRegistries,
  components: readonly ComponentDoc[],
): readonly ComponentDoc[] {
  return components.filter((component) => registries.components.get(component.type)?.followsDrawing(component) === true);
}
