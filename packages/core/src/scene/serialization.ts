import type { ComponentDefinition } from '../components/registry';
import { SCENE_FORMAT_VERSION } from '../constants';
import { isRecord } from '../conform';
import {
  checks,
  decodeJson,
  listOf,
  nullable,
  RecordReader,
  shown,
  versionRefusal,
  type DecodePath,
  type Decoded,
  type Diagnostic,
} from '../decoded';
import { isComponentId, isComponentTypeId, isEntityId, type ComponentId, type EntityId } from '../ids';
import { stableJson } from '../json';
import type { CoreRegistries } from '../registries';
import type { ComponentHost } from './components';
import { createEnvironment, decodeEnvironment } from './environment';
import { cycles } from './query';
import type { ComponentDoc, ComponentTables, EntityDoc, SceneDoc, UnknownComponentTables } from './schema';

/*
 * A scene as its file holds it, and back.
 *
 * The file writes each table the document holds in a Map as an object keyed by
 * id: the entities by entity id, each component table by entity id, then by
 * component id. It has one `components` block, where the document tells the
 * types this build defines from the others (`unknownComponents`) — which is
 * which depends on the build that reads the file, and is no fact about it.
 * Beside it, `componentVersions` records the version of each type the file
 * holds a component of, once per type: a ten-thousand-entity scene would
 * otherwise write the mesh's number ten thousand times.
 *
 * A message carries the same JSON, unsorted (`sceneJsonOf`): what receives it
 * decodes it as a file is decoded.
 */

/**
 * Indented so a scene file is reviewable in a diff, and key-sorted so there is
 * a diff worth reviewing. See `stableJson` for why the keys move and the arrays
 * do not.
 *
 * One consequence is worth knowing, because it is the only place an object's
 * key order in this format was ever readable: an entity carrying **two
 * components of one type** — two colliders, say — held them in the order they
 * were added, and now holds them by id once the document has been through a
 * file. Nothing reads that order for meaning; what it buys is that two machines
 * agree on which of the two `findComponent` calls the first.
 */
export function serializeScene(registries: CoreRegistries, scene: SceneDoc): string {
  return stableJson(sceneJsonOf(registries, scene));
}

/**
 * A scene as JSON holds it, for `jsonOf` to write into a message: to the main
 * process, to a device. What receives it decodes it, and writes any file itself.
 *
 * A document is never written as it stands: its components of the types this
 * build does not define sit apart in memory and belong in the one `components`
 * block, with the version of every type beside it.
 */
export function sceneJsonOf(registries: CoreRegistries, scene: SceneDoc): Readonly<Record<string, unknown>> {
  const { components: _components, unknownComponents: _apart, ...rest } = scene;
  return { ...rest, ...componentsJsonOf(registries, scene) };
}

/**
 * The `componentVersions` and `components` blocks of a scene's or a prefab's
 * JSON: the tables that hold a component, of the types this build defines and
 * of those it keeps as found, and the version of each — the registered
 * type's, or the one its file recorded.
 *
 * A table that holds nothing is left out with its version: a document keeps a
 * table once made, even emptied, and a file would otherwise gain a line the
 * first time a light is added and keep it after the last one went.
 *
 * Through `Object.fromEntries`, which makes an own property of any key: a file
 * may name a table `__proto__`, and an assignment would make it the prototype
 * of the block instead.
 */
export function componentsJsonOf(
  registries: CoreRegistries,
  host: Required<ComponentHost>,
): { readonly componentVersions: Readonly<Record<string, unknown>>; readonly components: Readonly<Record<string, unknown>> } {
  const versions = new Map<string, unknown>();
  const tables = new Map<string, unknown>();
  for (const [type, table] of host.components) {
    if (!holdsAny(table)) continue;
    const definition = registries.components.get(type);
    if (definition === undefined) throw new Error(`A table of the type ${type}, which these registries do not define`);
    versions.set(type, definition.version);
    tables.set(type, table);
  }
  for (const [type, { version, components }] of host.unknownComponents) {
    if (!holdsAny(components)) continue;
    versions.set(type, version);
    tables.set(type, components);
  }
  return { componentVersions: Object.fromEntries(versions), components: Object.fromEntries(tables) };
}

/** Whether a table holds at least one component. */
function holdsAny(table: ReadonlyMap<EntityId, ReadonlyMap<ComponentId, unknown>>): boolean {
  for (const held of table.values()) if (held.size > 0) return true;
  return false;
}

/**
 * A scene file's text, as a document of this build: the value, or every fault
 * found in it, each where it sits.
 *
 * A file of any other format is refused before anything else in it is read:
 * until 1.0.0 nothing converts an older scene, and a newer one holds fields
 * whose meaning this build cannot know (`SCENE_FORMAT_VERSION`). Then the whole
 * of it is read, strictly — the shell, each entity, each component by its
 * type, the environment by its schema: a field missing, of the wrong kind or
 * that no reader names refuses the scene, and nothing is filled in.
 *
 * A broken hierarchy that reads is healed (`repairHierarchy`).
 */
export function decodeScene(registries: CoreRegistries, text: string): Decoded<SceneDoc> {
  const parsed = decodeJson(text);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (isRecord(value) && value['version'] !== SCENE_FORMAT_VERSION) {
    return versionRefusal(value['version'], SCENE_FORMAT_VERSION);
  }

  const file = new RecordReader(value);
  file.read('version', checks.number);
  const decoded = file.done<SceneDoc>({
    version: SCENE_FORMAT_VERSION,
    id: file.read('id', checks.sceneId),
    name: file.read('name', checks.string),
    ...readHeld(registries, file),
    rootOrder: file.read('rootOrder', ENTITY_LIST),
    environment: file.decode('environment', decodeEnvironment) ?? createEnvironment(),
  });
  if (decoded.ok) repairHierarchy(decoded.value);
  return decoded;
}

const ENTITY_LIST = listOf(checks.entityId);
const ENTITY_OR_NONE = nullable(checks.entityId);

/** A value kept as it was found: what a type this build does not define holds, and its version. */
const asFound = (value: unknown): Decoded<unknown> => ({ ok: true, value });

/** The fault of an id that is not the key it is filed under. */
function mismatch(path: DecodePath, found: unknown, key: string): Diagnostic {
  return { code: 'key.mismatch', message: `is ${shown(found)}, where its key is ${shown(key)}`, path };
}

/**
 * What a scene's file and a prefab's both hold: the entities, the component
 * tables, and the version of each type they hold a component of.
 *
 * A table of a type the registries define is read by its type, at its
 * version: one recorded at another refuses the file in one line, naming the
 * type and both versions, and its components are not read — a component of
 * another version is no component of this one. A table of any other type is
 * kept **exactly as found**, with its version: nothing here knows what it
 * holds, and the next save has to write the author's data and not an invention
 * over it. Both are read the same two levels down, by entity id then by
 * component id, which is what lets a component of an unknown type follow its
 * entity when it is deleted or copied.
 *
 * A table with no version, or a version with no table, refuses the file: the
 * one is a type nothing can judge, the other a file that lost what it names.
 */
export function readHeld(
  registries: CoreRegistries,
  file: RecordReader,
): Pick<SceneDoc, 'entities' | 'components' | 'unknownComponents'> {
  const entities = new Map<EntityId, EntityDoc>();
  const entityTable = file.record('entities');
  for (const key of entityTable.keys()) {
    if (isEntityId(key)) entities.set(key, readEntity(entityTable.record(key), key));
    else entityTable.refuse(key, 'field.invalid', 'is no entity id');
  }

  const versions = file.record('componentVersions');
  const recorded = new Map<string, unknown>();
  for (const type of versions.keys()) {
    const version = versions.decode(type, asFound);
    recorded.set(type, version);
    const definition = isComponentTypeId(type) ? registries.components.get(type) : undefined;
    if (definition !== undefined && version !== definition.version) {
      versions.refuse(
        type,
        'type.version',
        `${type} written at version ${shown(version)}; this build reads version ${definition.version} and does not convert it`,
      );
    }
  }

  const components: ComponentTables = new Map();
  const unknownComponents: UnknownComponentTables = new Map();
  const tables = file.record('components');
  const tabled = new Set<string>();
  for (const type of tables.keys()) {
    tabled.add(type);
    if (!isComponentTypeId(type)) {
      tables.refuse(type, 'field.invalid', 'is no component type');
    } else if (!recorded.has(type)) {
      tables.refuse(type, 'table.unversioned', 'has no version in componentVersions');
    } else {
      const definition = registries.components.get(type);
      if (definition === undefined) {
        const held = readTable(tables.record(type), asFound);
        if (held.size > 0) unknownComponents.set(type, { version: recorded.get(type), components: held });
      } else if (recorded.get(type) === definition.version) {
        const held = readTable(tables.record(type), componentOf(definition));
        if (held.size > 0) components.set(definition.id, held);
      }
    }
  }
  for (const type of recorded.keys()) {
    if (!tabled.has(type)) versions.refuse(type, 'table.unversioned', 'names no table in components');
  }

  return { entities, components, unknownComponents };
}

/** `key` itself, if that is what was found where an id has to be the key it is filed under. */
function itsKey<K extends string>(value: unknown, path: DecodePath, key: K): Decoded<K> {
  return value === key ? { ok: true, value: key } : { ok: false, diagnostics: [mismatch(path, value, key)] };
}

/** An entity, each field checked, its `id` the key it is filed under. */
function readEntity(entity: RecordReader, key: EntityId): EntityDoc {
  return {
    id: entity.decode('id', (value, path) => itsKey(value, path, key)) ?? key,
    name: entity.read('name', checks.string),
    parent: entity.read('parent', ENTITY_OR_NONE),
    children: entity.read('children', ENTITY_LIST),
    transform: readTransform(entity.record('transform')),
    visible: entity.read('visible', checks.boolean),
    locked: entity.read('locked', checks.boolean),
  };
}

function readTransform(transform: RecordReader): EntityDoc['transform'] {
  return {
    position: transform.read('position', checks.vec3),
    rotation: transform.read('rotation', checks.vec3),
    scale: transform.read('scale', checks.vec3),
  };
}

/** One type's table, by entity then by component id, each component read by `read`. */
function readTable<T>(
  table: RecordReader,
  read: (value: unknown, path: DecodePath, key: ComponentId) => Decoded<T>,
): Map<EntityId, Map<ComponentId, T>> {
  const out = new Map<EntityId, Map<ComponentId, T>>();
  for (const entityKey of table.keys()) {
    if (!isEntityId(entityKey)) {
      table.refuse(entityKey, 'field.invalid', 'is no entity id');
      continue;
    }
    const heldTable = table.record(entityKey);
    const held = new Map<ComponentId, T>();
    for (const componentKey of heldTable.keys()) {
      if (!isComponentId(componentKey)) {
        heldTable.refuse(componentKey, 'field.invalid', 'is no component id');
        continue;
      }
      const component = heldTable.decode(componentKey, (value, path) => read(value, path, componentKey));
      if (component !== undefined) held.set(componentKey, component);
    }
    out.set(entityKey, held);
  }
  return out;
}

/** A stored component read by its type, its `id` the key it is filed under: an override names it by that key. */
function componentOf(
  definition: ComponentDefinition,
): (value: unknown, path: DecodePath, key: ComponentId) => Decoded<ComponentDoc> {
  return (value, path, key) => {
    const decoded = definition.decode(value, path);
    if (!decoded.ok || decoded.value.id === key) return decoded;
    return { ok: false, diagnostics: [mismatch([...path, 'id'], decoded.value.id, key)] };
  };
}

/**
 * Drops references to entities that are not in the table, and cuts cycles.
 *
 * A dangling child id would make the hierarchy panel render blanks and the
 * binder create orphan objects, so it is cheaper to heal the document on load
 * than to defend against it at every read site.
 *
 * Healing is right *here* and wrong everywhere else: at load the document is
 * already on disk in that shape, and the alternative is refusing to open the
 * project. During a session an edit that would break an edge is refused instead,
 * by `scene/graph.ts` — this function stopped being the only guard when that
 * landed.
 *
 * A prefab is healed by the same walk, its root its one root.
 */
export function repairHierarchy(tree: Pick<SceneDoc, 'entities' | 'rootOrder'>): void {
  const exists = (id: EntityId) => tree.entities.has(id);

  tree.rootOrder = tree.rootOrder.filter(exists);

  for (const entity of tree.entities.values()) {
    entity.children = entity.children.filter(exists);
    if (entity.parent !== null && !exists(entity.parent)) entity.parent = null;
  }

  // Cut each cycle by rooting the entity that closes it. The filtering above
  // cannot see one: every edge of a cycle points at an entity that exists. The
  // re-homing pass below then puts it in `rootOrder`.
  for (const chain of cycles(tree)) {
    const first = chain[0];
    const entity = first === undefined ? undefined : tree.entities.get(first);
    if (!entity) continue;
    const parent = entity.parent === null ? undefined : tree.entities.get(entity.parent);
    if (parent) parent.children = parent.children.filter((child) => child !== entity.id);
    entity.parent = null;
  }

  // Re-home anything that lost its parent and is not already a root.
  const referenced = new Set<EntityId>(tree.rootOrder);
  for (const entity of tree.entities.values()) {
    for (const child of entity.children) referenced.add(child);
  }
  for (const [id, entity] of tree.entities) {
    if (!referenced.has(id)) {
      entity.parent = null;
      tree.rootOrder.push(id);
    }
  }
}
