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
  'light',
  'camera',
  'rigidbody',
  'collider',
  'audioSource',
  'audioListener',
  'script',
  'prefabInstance',
  'playerController',
] as const satisfies readonly ComponentType[];

export function isKnownComponentType(type: string): type is ComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(type);
}

/** Anything that holds components: a scene, a prefab, or a draft of either. */
export interface ComponentHost {
  components: ComponentTables;
}

export function emptyComponentTables(): ComponentTables {
  const tables = {} as ComponentTables;
  for (const type of COMPONENT_TYPES) tables[type] = {};
  return tables;
}

/**
 * The table for one type: every entity carrying one, and its components by id.
 *
 * `Object.keys(componentsOfType(scene, 'light'))` is "every entity with a
 * light", which is what nine full scans of the entity table used to answer.
 */
export function componentsOfType<T extends ComponentType>(
  host: ComponentHost,
  type: T,
): Readonly<Record<string, Readonly<Record<string, ComponentOfType<T>>>>> {
  return host.components[type];
}

/** Entities carrying at least one component of this type. */
export function entitiesWith(host: ComponentHost, type: ComponentType): string[] {
  return Object.keys(host.components[type]);
}

/**
 * Everything one entity carries, in registry order and then insertion order.
 *
 * The array a component type no longer keeps. It carried the order the author
 * added things in; this one is the order of `COMPONENT_TYPES`, which is stable
 * and — unlike the old one — the same for every entity holding the same types.
 *
 * A fresh array each call: nothing may compare its identity to decide whether
 * anything changed. See `SceneBinder.syncEntity`, which compares the elements.
 */
export function componentsOf(host: ComponentHost, entityId: string): ComponentDoc[] {
  const out: ComponentDoc[] = [];
  for (const type of COMPONENT_TYPES) {
    const held = host.components[type][entityId];
    if (held) out.push(...Object.values(held));
  }
  return out;
}

/** Whether the entity holds one of these at all. */
export function hasComponent(
  host: ComponentHost,
  entityId: string,
  type: ComponentType,
): boolean {
  const held = host.components[type][entityId];
  return held !== undefined && Object.keys(held).length > 0;
}

/** First component of the given type on an entity, or `undefined`. */
export function findComponent<T extends ComponentType>(
  host: ComponentHost,
  entityId: string,
  type: T,
): ComponentOfType<T> | undefined {
  const held = host.components[type][entityId];
  if (!held) return undefined;
  for (const component of Object.values(held)) return component;
  return undefined;
}

/**
 * A component by its own id.
 *
 * Searches the eleven type tables, because a component id says nothing about
 * its type — which is what makes it a stable name for an override.
 */
export function findComponentById(
  host: ComponentHost,
  entityId: string,
  componentId: string,
): ComponentDoc | undefined {
  for (const type of COMPONENT_TYPES) {
    const found = host.components[type][entityId]?.[componentId];
    if (found) return found;
  }
  return undefined;
}

/**
 * Adds or replaces a component, under its own id.
 *
 * A type this build has never heard of gets a table of its own rather than
 * throwing. It arrives from a plugin, or from a document a later version wrote,
 * and the rule for both is the same one the migration follows: keep it exactly
 * as found, so the next save does not write an invention over the author's data.
 */
export function putComponent(
  host: ComponentHost,
  entityId: string,
  component: ComponentDoc,
): void {
  const tables = host.components as unknown as Record<
    string,
    Record<string, Record<string, ComponentDoc>>
  >;
  const table = (tables[component.type] ??= {});
  const held = (table[entityId] ??= {});
  held[component.id] = component;
}

/**
 * Removes one component. Answers whether it was there.
 *
 * The entity's record goes with the last component of its type, so
 * `entitiesWith` never reports an entity whose entry is an empty object.
 */
export function deleteComponent(
  host: ComponentHost,
  entityId: string,
  componentId: string,
): boolean {
  for (const type of COMPONENT_TYPES) {
    const held = host.components[type][entityId];
    if (!held || held[componentId] === undefined) continue;
    delete held[componentId];
    if (Object.keys(held).length === 0) delete host.components[type][entityId];
    return true;
  }
  return false;
}

/** Replaces everything an entity carries. */
export function setComponentsOf(
  host: ComponentHost,
  entityId: string,
  components: readonly ComponentDoc[],
): void {
  dropComponentsOf(host, entityId);
  for (const component of components) putComponent(host, entityId, component);
}

/**
 * Drops everything an entity carries.
 *
 * Called by every path that removes an entity. A component left behind is
 * unreachable and still serialised — the same family of silent leak as B1, and
 * as invisible.
 */
export function dropComponentsOf(host: ComponentHost, entityId: string): void {
  for (const type of COMPONENT_TYPES) {
    if (host.components[type][entityId] !== undefined) delete host.components[type][entityId];
  }
}

/**
 * Copies one entity's components onto another, ids and all.
 *
 * Keeping the ids is deliberate: a component id is unique **within its entity**
 * — which is exactly what the per-entity table encodes — and a prefab override
 * names one by it, so a duplicated instance must keep pointing at the same
 * things.
 */
export function copyComponentsOf(
  host: ComponentHost,
  fromEntityId: string,
  toEntityId: string,
  clone: <T>(value: T) => T,
): void {
  for (const type of COMPONENT_TYPES) {
    const held = host.components[type][fromEntityId];
    if (held === undefined) continue;
    const table = host.components[type] as Record<string, Record<string, ComponentDoc>>;
    table[toEntityId] = clone(held) as Record<string, ComponentDoc>;
  }
}
