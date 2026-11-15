import type { ComponentId, EntityId } from '../ids';
import type { CoreRegistries } from '../registries';
import type {
  ComponentDoc,
  ComponentOfType,
  ComponentTable,
  ComponentTables,
  ComponentType,
  ComponentTypeId,
  UnknownComponentTables,
} from './schema';

/*
 * Reading and writing the component tables.
 *
 * Everything that used to be `entity.components.find(…)` goes through here, and
 * the rule that shapes the module is that **none of these functions walks the
 * entity table**. That is the whole point of the storage change: a question
 * about a type is a lookup, not a scan.
 *
 * They take a `{ components }` rather than a `SceneDoc`, so a `PrefabDoc` and an
 * immer draft of either are the same argument.
 *
 * No list of types lives here. The tables are open: a function that walks every
 * type walks the tables the document holds, and the one that needs an order —
 * `componentsOf` — takes it from the registry it is handed.
 */

/**
 * Anything that holds components: a scene, a prefab, a draft of either, or the
 * tables an expansion fills.
 *
 * `unknownComponents` is a document's. What an expansion produces carries none,
 * so it is optional here, and the functions that move a whole entity — drop,
 * copy — take what the host has.
 */
export interface ComponentHost {
  components: ComponentTables;
  unknownComponents?: UnknownComponentTables;
}

/** What a type the document holds no table of answers with. Never written to: the type refuses it. */
const NO_TABLE: ReadonlyMap<EntityId, ReadonlyMap<ComponentId, ComponentDoc>> = new Map();

/**
 * Whether a component is of the type named, which is then its TypeScript type.
 *
 * How a component read from a table gets its own type back with no claim: the
 * tables hold any component, each filed under its `type`, and this reads that
 * same tag. Code that names the type as a literal can test `component.type`
 * itself; this is for code that has the type in a variable.
 */
export function isComponentOfType<T extends ComponentType>(
  component: ComponentDoc,
  type: T,
): component is ComponentOfType<T> {
  return component.type === type;
}

/** A type's table in `tables`, made first when they hold none: where a component is about to be filed. */
export function tableIn(tables: ComponentTables, type: ComponentTypeId): ComponentTable {
  let table = tables.get(type);
  if (table === undefined) {
    table = new Map();
    tables.set(type, table);
  }
  return table;
}

/**
 * The table for one type: every entity carrying one, and its components by id.
 *
 * `componentsOfType(scene, 'light').keys()` is "every entity with a light",
 * which is what nine full scans of the entity table used to answer.
 *
 * The values are any component, as the tables hold them: a caller that reads
 * their fields narrows each by its `type` first.
 */
export function componentsOfType(
  host: ComponentHost,
  type: ComponentTypeId,
): ReadonlyMap<EntityId, ReadonlyMap<ComponentId, ComponentDoc>> {
  return host.components.get(type) ?? NO_TABLE;
}

/** Entities carrying at least one component of this type. */
export function entitiesWith(host: ComponentHost, type: ComponentTypeId): EntityId[] {
  return [...componentsOfType(host, type).keys()];
}

/**
 * Everything one entity carries, in registry order and then table order.
 *
 * The array a component type no longer keeps. It carried the order the author
 * added things in; this one is the order the types were registered in — the
 * kernel's, then each module's — which is stable and, unlike the old one, the
 * same for every entity holding the same types. The document cannot give it:
 * its tables stand in the order each was first filled, or the order a file
 * sorted them in.
 *
 * Within a single type the answer is the table's own key order: insertion order
 * during a session, and id order in any document that has been read back from a
 * file, since `serializeScene` sorts keys. It shows only on an entity carrying
 * two of one type, and neither order carries meaning.
 *
 * A fresh array each call: nothing may compare its identity to decide whether
 * anything changed. See `SceneBinder.syncEntity`, which compares the elements.
 */
export function componentsOf(
  registries: CoreRegistries,
  host: ComponentHost,
  entityId: EntityId,
): ComponentDoc[] {
  const out: ComponentDoc[] = [];
  for (const { id } of registries.components.values()) {
    const held = host.components.get(id)?.get(entityId);
    if (held) out.push(...held.values());
  }
  return out;
}

/** Whether the entity holds one of these at all. */
export function hasComponent(
  host: ComponentHost,
  entityId: EntityId,
  type: ComponentTypeId,
): boolean {
  const held = host.components.get(type)?.get(entityId);
  return held !== undefined && held.size > 0;
}

/** First component of the given type on an entity, or `undefined`. */
export function findComponent<T extends ComponentType>(
  host: ComponentHost,
  entityId: EntityId,
  type: T,
): ComponentOfType<T> | undefined {
  const held = host.components.get(type)?.get(entityId);
  if (held === undefined) return undefined;
  for (const component of held.values()) {
    if (isComponentOfType(component, type)) return component;
  }
  return undefined;
}

/**
 * Every component of the given type on an entity, in the order they were added.
 *
 * A fresh array each call, so a caller may delete what it walks: `deleteComponent`
 * takes the entity's entry out of the table along with its last component, and
 * the walk is of a copy, as it was when this was `Object.values`.
 */
export function findComponents<T extends ComponentType>(
  host: ComponentHost,
  entityId: EntityId,
  type: T,
): ComponentOfType<T>[] {
  const held = host.components.get(type)?.get(entityId);
  if (held === undefined) return [];
  return [...held.values()].filter((component) => isComponentOfType(component, type));
}

/**
 * A component by its own id.
 *
 * Searches every table the document holds, because a component id says nothing
 * about its type — which is what makes it a stable name for an override.
 */
export function findComponentById(
  host: ComponentHost,
  entityId: EntityId,
  componentId: ComponentId,
): ComponentDoc | undefined {
  for (const table of host.components.values()) {
    const found = table.get(entityId)?.get(componentId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Adds or replaces a component, under its own id and in the table of its own
 * type, which is the one rule that lets a reader trust what it finds there.
 *
 * A type this build knows. One it has never heard of — from a plugin, or from a
 * document a later version wrote — arrives through the decoder, which keeps it
 * in `unknownComponents` exactly as found, so the next save does not write an
 * invention over the author's data. Nothing here files into those: what no
 * module of this build defines cannot be told what it holds.
 */
export function putComponent(
  host: ComponentHost,
  entityId: EntityId,
  component: ComponentDoc,
): void {
  const table = tableIn(host.components, component.type);
  let held = table.get(entityId);
  if (held === undefined) {
    held = new Map();
    table.set(entityId, held);
  }
  held.set(component.id, component);
}

/**
 * Removes one component. Answers whether it was there.
 *
 * The entity's entry goes with the last component of its type, so
 * `entitiesWith` never reports an entity whose entry is an empty Map. The
 * type's table stays; see `ComponentTables`.
 */
export function deleteComponent(
  host: ComponentHost,
  entityId: EntityId,
  componentId: ComponentId,
): boolean {
  for (const table of host.components.values()) {
    const held = table.get(entityId);
    if (held === undefined || !held.delete(componentId)) continue;
    if (held.size === 0) table.delete(entityId);
    return true;
  }
  return false;
}

/**
 * Replaces what an entity carries of the types this build defines.
 *
 * What it carries of any other type stays: the list handed here was read from
 * the known tables, or built from factories, so it could never have held one,
 * and replacing "everything" would drop the author's data on the way. A caller
 * that means the entity to end up with these and nothing else drops first.
 */
export function setComponentsOf(
  host: ComponentHost,
  entityId: EntityId,
  components: readonly ComponentDoc[],
): void {
  for (const table of host.components.values()) table.delete(entityId);
  for (const component of components) putComponent(host, entityId, component);
}

/**
 * Drops everything an entity carries, of the types this build does not define
 * too.
 *
 * Called by every path that removes an entity. A component left behind is
 * unreachable and still serialised — the same family of silent leak, and
 * as invisible.
 */
export function dropComponentsOf(host: ComponentHost, entityId: EntityId): void {
  for (const table of host.components.values()) table.delete(entityId);
  for (const { components } of host.unknownComponents?.values() ?? []) components.delete(entityId);
}

/**
 * Copies one entity's components onto another, ids and all, those of the types
 * this build does not define with them: a copy that lost them would lose them
 * for good the day their module is installed.
 *
 * Keeping the ids is deliberate: a component id is unique **within its entity**
 * — which is exactly what the per-entity table encodes — and a prefab override
 * names one by it, so a duplicated instance must keep pointing at the same
 * things.
 *
 * `clone` is given one component at a time, never a Map: a copy made through
 * JSON writes a Map as `{}`, and the copy would be an entity with a table and
 * nothing in it.
 */
export function copyComponentsOf(
  host: ComponentHost,
  fromEntityId: EntityId,
  toEntityId: EntityId,
  clone: <T>(value: T) => T,
): void {
  for (const table of host.components.values()) copyEntry(table, fromEntityId, toEntityId, clone);
  for (const { components } of host.unknownComponents?.values() ?? []) {
    copyEntry(components, fromEntityId, toEntityId, clone);
  }
}

function copyEntry<Held>(
  table: Map<EntityId, Map<ComponentId, Held>>,
  fromEntityId: EntityId,
  toEntityId: EntityId,
  clone: <T>(value: T) => T,
): void {
  const held = table.get(fromEntityId);
  if (held === undefined) return;
  const copy = new Map<ComponentId, Held>();
  for (const [id, component] of held) copy.set(id, clone(component));
  table.set(toEntityId, copy);
}

/**
 * The components with each entity they name replaced by `rename`'s answer,
 * where there is one: references to entities that were copied, made to name
 * the copies.
 *
 * Each type renames what its schema says names an entity — a joint's Connected
 * Body, a water surface's light — and, by value, the strings of the data only
 * its owner can read, a script's properties and a prefab's overrides, where a
 * string equal to a copied id is one. An id is twelve random characters, so a
 * string that equals one and means something else does not happen in
 * practice; leaving a reference on the original is a lookup that answers with
 * the wrong entity, or none. A component of a type this build does not know is
 * left as found, as everything about it is.
 */
export function renameEntityReferences(
  registries: CoreRegistries,
  components: readonly ComponentDoc[],
  rename: (id: EntityId) => EntityId | undefined,
): ComponentDoc[] {
  return components.map((component) => registries.components.get(component.type)?.renameEntities(component, rename) ?? component);
}
