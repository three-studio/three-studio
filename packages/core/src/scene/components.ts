import { isEntityId, type ComponentId, type EntityId } from '../ids';
import type {
  ComponentDoc,
  ComponentOfType,
  ComponentTables,
  ComponentType,
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
 */

/** Every type this build knows how to build. Read at runtime, not just by TS. */
export const COMPONENT_TYPES = [
  'mesh',
  'model',
  'water',
  'particleEmitter',
  'light',
  'camera',
  'rigidbody',
  'collider',
  'joint',
  'audioSource',
  'audioListener',
  'script',
  'prefabInstance',
  'playerController',
] as const satisfies readonly ComponentType[];

export function isKnownComponentType(type: string): type is ComponentType {
  return COMPONENT_TYPES.some((known) => known === type);
}

/** Anything that holds components: a scene, a prefab, or a draft of either. */
export interface ComponentHost {
  components: ComponentTables;
}

/**
 * A table of every type, each empty.
 *
 * Written out rather than built from `COMPONENT_TYPES`, so that the compiler
 * says when a type is missing from one: a loop would fill the tables of the
 * list it was given and type the result as the complete set.
 */
export function emptyComponentTables(): ComponentTables {
  return {
    mesh: new Map(),
    model: new Map(),
    water: new Map(),
    particleEmitter: new Map(),
    light: new Map(),
    camera: new Map(),
    rigidbody: new Map(),
    collider: new Map(),
    joint: new Map(),
    audioSource: new Map(),
    audioListener: new Map(),
    script: new Map(),
    prefabInstance: new Map(),
    playerController: new Map(),
  };
}

/**
 * Tables with the same entities in them, each type's outer Map a copy of its own.
 *
 * One level deep, which is what an expansion needs: it adds the entities an
 * instance produced to its copy and leaves the scene's tables alone, and the
 * Maps and components under each entity stay the very objects the scene holds,
 * because the binder tells what changed by comparing them.
 */
export function copyComponentTables(tables: ComponentTables): ComponentTables {
  return {
    mesh: new Map(tables.mesh),
    model: new Map(tables.model),
    water: new Map(tables.water),
    particleEmitter: new Map(tables.particleEmitter),
    light: new Map(tables.light),
    camera: new Map(tables.camera),
    rigidbody: new Map(tables.rigidbody),
    collider: new Map(tables.collider),
    joint: new Map(tables.joint),
    audioSource: new Map(tables.audioSource),
    audioListener: new Map(tables.audioListener),
    script: new Map(tables.script),
    prefabInstance: new Map(tables.prefabInstance),
    playerController: new Map(tables.playerController),
  };
}

/**
 * One type's table, as a table of any component.
 *
 * Indexed by a variable, the tables are a union of fourteen Map types, and one
 * can be read through but not written to: each takes only its own components.
 * Each of them is assignable to this one all the same, which is the loose way a
 * Map's value type is checked, and it is right by construction — what files a
 * component files it under its own `type`, and what reads it reads it from there.
 */
export function tableOf(
  tables: ComponentTables,
  type: ComponentType,
): Map<EntityId, Map<ComponentId, ComponentDoc>> {
  return tables[type];
}

/**
 * The table for one type: every entity carrying one, and its components by id.
 *
 * `componentsOfType(scene, 'light').keys()` is "every entity with a light",
 * which is what nine full scans of the entity table used to answer.
 */
export function componentsOfType<T extends ComponentType>(
  host: ComponentHost,
  type: T,
): ReadonlyMap<EntityId, ReadonlyMap<ComponentId, ComponentOfType<T>>> {
  return host.components[type];
}

/** Entities carrying at least one component of this type. */
export function entitiesWith(host: ComponentHost, type: ComponentType): EntityId[] {
  return [...host.components[type].keys()];
}

/**
 * Everything one entity carries, in registry order and then table order.
 *
 * The array a component type no longer keeps. It carried the order the author
 * added things in; this one is the order of `COMPONENT_TYPES`, which is stable
 * and — unlike the old one — the same for every entity holding the same types.
 *
 * Within a single type the answer is the table's own key order: insertion order
 * during a session, and id order in any document that has been read back from a
 * file, since `serializeScene` sorts keys. It shows only on an entity carrying
 * two of one type, and neither order carries meaning.
 *
 * A fresh array each call: nothing may compare its identity to decide whether
 * anything changed. See `SceneBinder.syncEntity`, which compares the elements.
 */
export function componentsOf(host: ComponentHost, entityId: EntityId): ComponentDoc[] {
  const out: ComponentDoc[] = [];
  for (const type of COMPONENT_TYPES) {
    const held = tableOf(host.components, type).get(entityId);
    if (held) out.push(...held.values());
  }
  return out;
}

/** Whether the entity holds one of these at all. */
export function hasComponent(
  host: ComponentHost,
  entityId: EntityId,
  type: ComponentType,
): boolean {
  const held = host.components[type].get(entityId);
  return held !== undefined && held.size > 0;
}

/** First component of the given type on an entity, or `undefined`. */
export function findComponent<T extends ComponentType>(
  host: ComponentHost,
  entityId: EntityId,
  type: T,
): ComponentOfType<T> | undefined {
  const held = host.components[type].get(entityId);
  if (!held) return undefined;
  for (const component of held.values()) return component;
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
  const held = host.components[type].get(entityId);
  return held === undefined ? [] : [...held.values()];
}

/**
 * A component by its own id.
 *
 * Searches the fourteen type tables, because a component id says nothing about
 * its type — which is what makes it a stable name for an override.
 */
export function findComponentById(
  host: ComponentHost,
  entityId: EntityId,
  componentId: ComponentId,
): ComponentDoc | undefined {
  for (const type of COMPONENT_TYPES) {
    const found = tableOf(host.components, type).get(entityId)?.get(componentId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Adds or replaces a component, under its own id.
 *
 * A type this build knows. One it has never heard of — from a plugin, or from a
 * document a later version wrote — arrives through the decoder, which keeps its
 * table exactly as found, so the next save does not write an invention over the
 * author's data. Nothing here files into that table: it is the file's JSON, not
 * a Map, and what no module of this build defines cannot be told what it holds.
 */
export function putComponent(
  host: ComponentHost,
  entityId: EntityId,
  component: ComponentDoc,
): void {
  const table = tableOf(host.components, component.type);
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
 * `entitiesWith` never reports an entity whose entry is an empty Map.
 */
export function deleteComponent(
  host: ComponentHost,
  entityId: EntityId,
  componentId: ComponentId,
): boolean {
  for (const type of COMPONENT_TYPES) {
    const table = tableOf(host.components, type);
    const held = table.get(entityId);
    if (held === undefined || !held.delete(componentId)) continue;
    if (held.size === 0) table.delete(entityId);
    return true;
  }
  return false;
}

/** Replaces everything an entity carries. */
export function setComponentsOf(
  host: ComponentHost,
  entityId: EntityId,
  components: readonly ComponentDoc[],
): void {
  dropComponentsOf(host, entityId);
  for (const component of components) putComponent(host, entityId, component);
}

/**
 * Drops everything an entity carries.
 *
 * Called by every path that removes an entity. A component left behind is
 * unreachable and still serialised — the same family of silent leak, and
 * as invisible.
 */
export function dropComponentsOf(host: ComponentHost, entityId: EntityId): void {
  for (const type of COMPONENT_TYPES) tableOf(host.components, type).delete(entityId);
}

/**
 * Copies one entity's components onto another, ids and all.
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
  for (const type of COMPONENT_TYPES) {
    const table = tableOf(host.components, type);
    const held = table.get(fromEntityId);
    if (held === undefined) continue;
    const copy = new Map<ComponentId, ComponentDoc>();
    for (const [id, component] of held) copy.set(id, clone(component));
    table.set(toEntityId, copy);
  }
}

/**
 * The components with each string that `rename` answers for replaced by its
 * answer: references to entities that were copied, made to name the copies.
 *
 * Matched by value rather than by a declared list of reference fields: which
 * properties hold an entity id is decided by a user's script at runtime, and
 * core cannot see that. An id is twelve random characters, so a string that
 * equals one and means something else does not happen in practice — and the
 * alternative, leaving a reference pointing at the original, is a lookup that
 * silently answers with the wrong entity, or with none.
 *
 * Each string is checked as the id it would have to be before `rename` is asked
 * about it, so `rename` is only ever handed an id.
 */
export function renameEntityReferences(
  components: readonly ComponentDoc[],
  rename: (id: EntityId) => EntityId | undefined,
): ComponentDoc[] {
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return (isEntityId(value) ? rename(value) : undefined) ?? value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = rewrite(inner);
      return out;
    }
    return value;
  };

  return components.map((component) => {
    // `type` is never an id, and skipping it keeps the walk off the one string
    // property every component has.
    const { type, ...rest } = component as unknown as Record<string, unknown>;
    return { type, ...(rewrite(rest) as object) } as ComponentDoc;
  });
}
