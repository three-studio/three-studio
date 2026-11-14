import type { AssetId, EntityId } from '../ids';
import type { CoreRegistries } from '../registries';
import type { EntityTemplate } from '../scene/entity';
import type { ComponentDoc, ComponentType } from '../scene/schema';
import { createColliderFor } from './collider/defaults';

/*
 * What a component type answers, asked of the registries a caller was handed.
 *
 * Nothing here reaches a definition through a module: the core's registries
 * hold them, made and filled by a composition root, and each function below is
 * given them. A type this build does not define — a plugin's, a newer
 * editor's — is one the registries do not hold, and each answer says what such
 * a type gets.
 */

/**
 * Types that can be authored but that nothing builds when the game runs.
 *
 * Not a list kept by hand — derived, so it cannot drift. A type that gains a
 * system leaves it by changing one flag in one file.
 */
export function typesWithoutRuntime(registries: CoreRegistries): readonly ComponentType[] {
  return registries.components
    .values()
    .filter((definition) => !definition.runtime)
    .map((definition) => definition.id);
}

/**
 * Types a user can attach by hand, in registration order.
 *
 * Derived for the same reason `typesWithoutRuntime` is: a new type answers the
 * question in its own module, where the compiler insists on an answer, rather
 * than in a list somewhere else that nothing checks.
 */
export function addableTypes(registries: CoreRegistries): readonly ComponentType[] {
  return registries.components
    .values()
    .filter((definition) => definition.addable)
    .map((definition) => definition.id);
}

/** Asset ids a component points at, whatever its type. */
export function componentAssets(
  registries: CoreRegistries,
  component: ComponentDoc,
): readonly (AssetId | '' | null)[] {
  // A type from a plugin, or from a later version of the editor. It names assets
  // this build cannot see, and guessing would be worse than saying none.
  return registries.components.get(component.type)?.assets(component) ?? [];
}

/** Entity ids a component points at, whatever its type; none for a type this build does not know. */
export function componentEntities(
  registries: CoreRegistries,
  component: ComponentDoc,
): readonly (EntityId | '' | null)[] {
  return registries.components.get(component.type)?.entities(component) ?? [];
}

/** Strings a component holds that may name an asset; see `ComponentDefinition.assetCandidates`. */
export function componentAssetCandidates(registries: CoreRegistries, component: ComponentDoc): readonly string[] {
  return registries.components.get(component.type)?.assetCandidates?.(component) ?? [];
}

/**
 * Whether a component's position in the world means anything.
 *
 * An unknown type — a plugin's, or a newer editor's — is placed. It is the
 * answer eleven of the twelve types here give, and a position that turns out
 * to mean nothing is cosmetic where dropping a new object at the world origin,
 * out of sight of the author who just added it, is not.
 */
export function componentIsPlaceable(registries: CoreRegistries, component: ComponentDoc): boolean {
  return registries.components.get(component.type)?.placeable(component) ?? true;
}

/**
 * A stored component with everything added since it was written filled in.
 *
 * An unknown type comes back **exactly as found**. Filling it against a type we
 * do not have would invent a shape, and the next save would write that invention
 * over the author's data. A field is deprecated, never lost.
 *
 * A type that declared no `fill` gets the default: its own factory underneath
 * what was stored, so nothing the author wrote is overwritten and nothing added
 * since is left `undefined`. See `ComponentDefinition.fill` for the types that
 * need more than that.
 */
export function fillComponent(registries: CoreRegistries, stored: ComponentDoc): ComponentDoc {
  const definition = registries.components.get(stored.type);
  if (!definition) return stored;
  if (definition.fill) return definition.fill(stored);
  return { ...definition.create(), ...stored };
}

/**
 * Whether a template's transform describes a place in the world.
 *
 * Here rather than in `scene/defaults.ts`, where it used to name `'light'` and
 * carry that type's table of kinds: the answer is now the types' own, and this
 * is the module that asks the registries a question on behalf of a whole thing.
 *
 * An empty carries no components and is still a place: it exists to hold
 * whatever gets dragged under it, so it belongs where the author is looking.
 * Beyond that one component that means to be somewhere is enough — a light on a
 * lamp post is on the lamp post even if the lamp is ambient.
 */
export function isPlaceable(registries: CoreRegistries, template: EntityTemplate): boolean {
  if (template.components.length === 0) return true;
  return template.components.some((component) => componentIsPlaceable(registries, component));
}

export { defineComponent, type ComponentDefinition, type ComponentIcon } from './registry';

/**
 * Blank instance of a component type, used by "Add Component" in the inspector.
 *
 * A `ComponentDoc` and not the type's own: the type is a value read from a
 * menu or a file, and a lookup by a value cannot honestly answer narrower. Code
 * that knows the type it makes calls that type's factory — `createCollider()`.
 *
 * Throws on a type it does not know rather than falling back. The chain this
 * replaced ended in `createPlayerController()`, so a component from a plugin or
 * a hand-edited file came back as a player controller with the original's fields
 * glued on — which the migration then wrote to disk.
 */
export function createComponent(registries: CoreRegistries, type: ComponentType): ComponentDoc {
  const definition = registries.components.get(type);
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
export function createComponentForEntity(
  registries: CoreRegistries,
  type: ComponentType,
  siblings: readonly ComponentDoc[],
): ComponentDoc {
  if (type !== 'collider') return createComponent(registries, type);
  return createColliderFor(siblings);
}
