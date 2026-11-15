import { SCENE_FORMAT_VERSION } from '../constants';
import { isRecord } from '../conform';
import { formatDiagnostics, versionRefusal, type Diagnostic } from '../decoded';
import {
  idMapOf,
  isComponentId,
  isComponentTypeId,
  isEntityId,
  type EntityId,
} from '../ids';
import { stableJson } from '../json';
import type { CoreRegistries } from '../registries';
import type { ComponentHost } from './components';
import { createEnvironment } from './defaults';
import { createEntity } from './entity';
import { cycles } from './query';
import type {
  ComponentDoc,
  ComponentTable,
  ComponentTables,
  EntityDoc,
  SceneDoc,
  UnknownComponentTables,
} from './schema';

export class SceneFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneFormatError';
  }
}

/**
 * A scene as its file writes it: the entity table is an object keyed by entity
 * id, where the document holds the same entities in a Map, and each component
 * table an object by entity id holding an object by component id, where the
 * document holds Maps of Maps.
 *
 * A file has one `components` block, where the document tells the types this
 * build defines from the others (`unknownComponents`): which is which depends on
 * the build that reads the file, and is no fact about the file.
 *
 * The conversion happens here and nowhere else: `migrateScene` reads this shape,
 * and `sceneJsonOf` and `serializeScene` write it. Nothing outside this module sees it, and the cast
 * that claims it stays where it is until a decoder checks the fields.
 */
interface SceneJson extends Omit<SceneDoc, 'entities' | 'components' | 'unknownComponents'> {
  entities: Record<string, EntityDoc>;
  /** A type this build does not define has its table here too. */
  components?: TablesJson;
}

type TablesJson = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, ComponentDoc>>>>>>;

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
  return stableJson({ ...sceneJsonOf(scene), components: componentsJsonOf(scene, registries) });
}

/**
 * A scene as JSON holds it, for `jsonOf` to write into a message: to the main
 * process, to a device. What receives it decodes it, and writes any file itself.
 *
 * A document is never written as it stands. Its components of the types this
 * build does not define sit apart in memory and belong in the one `components`
 * block of the JSON; written raw, they would land under a key no reader reads,
 * and be lost by the first save that crossed a process.
 */
export function sceneJsonOf(scene: SceneDoc): Readonly<Record<string, unknown>> {
  const { unknownComponents: _apart, ...rest } = scene;
  return { ...rest, components: componentsJsonOf(scene) };
}

/**
 * The `components` block of a scene's or a prefab's JSON: the tables of the
 * types this build does not define, exactly as found, with the tables the
 * document holds. A table of such a type whose every component went with its
 * entity is left out: nothing registers the type, so nothing would ever say
 * why the file still lists it.
 *
 * Given the registries, which is how a **file** is written, a table for every
 * registered type too, `{}` for the ones the document holds nothing of: a file
 * then lists the types of the build that wrote it, and does not gain a line the
 * first time a light is added. A message needs none of them, since a missing
 * table reads as an empty one.
 *
 * Through `Object.fromEntries`, which makes an own property of any key: a file
 * may name a table `__proto__`, and an assignment would make it the prototype
 * of the block instead.
 */
export function componentsJsonOf(
  host: Required<ComponentHost>,
  registries?: CoreRegistries,
): Readonly<Record<string, unknown>> {
  const kept = [...host.unknownComponents].filter(([, table]) => table.size > 0);
  const written = new Map<string, unknown>([...kept, ...host.components]);
  for (const { id } of registries?.components.values() ?? []) {
    if (!written.has(id)) written.set(id, {});
  }
  return Object.fromEntries(written);
}

export function deserializeScene(registries: CoreRegistries, json: string): SceneDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new SceneFormatError(`Scene file is not valid JSON: ${(cause as Error).message}`);
  }
  return migrateScene(registries, parsed);
}

/**
 * A parsed scene file, as a document of this format.
 *
 * A file of any other format is refused before anything else in it is read:
 * until 1.0.0 nothing converts an older scene, and a newer one holds fields
 * whose meaning this build cannot know (`SCENE_FORMAT_VERSION`).
 *
 * A broken hierarchy is healed (`repairHierarchy`), and each component is
 * decoded by its type: one it refuses refuses the scene
 * (`fillMissingFields`).
 *
 * `registries` say which types this build knows: each registered type's
 * components are decoded by its own definition, and any other is kept as
 * found, in `unknownComponents`.
 */
export function migrateScene(registries: CoreRegistries, input: unknown): SceneDoc {
  if (typeof input !== 'object' || input === null) {
    throw new SceneFormatError('Scene file is not an object.');
  }

  const doc = input as Partial<SceneJson>;
  if (doc.version !== SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(
      formatDiagnostics('Scene file', versionRefusal(doc.version, SCENE_FORMAT_VERSION).diagnostics),
    );
  }
  // Not a Map, which an object is to `isRecord` and `Object.entries` reads as
  // empty: a document handed here by mistake would come out as a scene with no
  // entities, and nothing in the types says it was not a file.
  if (!isRecord(doc.entities) || doc.entities instanceof Map || !Array.isArray(doc.rootOrder)) {
    throw new SceneFormatError('Scene file is missing its entity table.');
  }

  const json = input as SceneJson;
  const scene: SceneDoc = {
    ...json,
    entities: idMapOf(json.entities, isEntityId),
    ...tablesFrom(registries, json.components),
  };
  repairHierarchy(scene);
  fillMissingFields(registries, scene);
  return scene;
}

/**
 * The component tables of a document, from the one block a file writes.
 *
 * A table whose type the registries hold is this build's, and goes with the
 * others; any other is kept **exactly as found**, in `unknownComponents`: nothing
 * here knows what is in it, and the next save has to write the author's data and
 * not an invention over it. Both are read the same two levels down, through the
 * checks of the ids they are keyed by — an entity's, then a component's — which
 * is what lets a component of an unknown type follow its entity when it is
 * deleted or copied. A key that fails its check is dropped, and so is a level
 * that is no object.
 *
 * A file can carry some types and not others — written by a build without
 * one of this build's modules, or edited by hand — and a type it holds nothing
 * of gets no table: a missing one reads as empty.
 */
function tablesFrom(registries: CoreRegistries, json: TablesJson | undefined): Required<ComponentHost> {
  const components: ComponentTables = new Map();
  const unknownComponents: UnknownComponentTables = new Map();
  for (const [type, table] of idMapOf(json ?? {}, isComponentTypeId)) {
    const read: ComponentTable = new Map();
    for (const [entityId, held] of idMapOf(isRecord(table) ? table : {}, isEntityId)) {
      if (isRecord(held)) read.set(entityId, idMapOf(held, isComponentId));
    }
    if (read.size === 0) continue;
    const definition = registries.components.get(type);
    if (definition === undefined) unknownComponents.set(type, read);
    else components.set(definition.id, read);
  }
  return { components, unknownComponents };
}

/**
 * Fills what an entity and the environment lack from their factories, and
 * decodes each component by its type.
 *
 * Over the document's tables, which are those of the registered types: a table
 * of any other is in `unknownComponents`, where `tablesFrom` kept it as found.
 */
function fillMissingFields(registries: CoreRegistries, scene: SceneDoc): void {
  const blank = createEnvironment();
  // Merged a level deeper for `sky`, because the spread above it is shallow and
  // a scene written before the analytic sky existed carries no `sky` at all —
  // or, worse, a `sky` from a build that had only half its fields. It is the
  // reason `createEnvironment` exists rather than a literal: one factory, one
  // merge per level, and a property added later is migrated by existing.
  scene.environment = {
    ...blank,
    ...scene.environment,
    sky: { ...blank.sky, ...scene.environment?.sky },
  };

  for (const entity of scene.entities.values()) {
    const blank = createEntity(entity.name ?? 'Entity').entity;
    entity.transform = {
      ...blank.transform,
      ...entity.transform,
    };
    entity.visible ??= blank.visible;
    entity.locked ??= blank.locked;
    entity.children ??= [];
  }

  const refused: Diagnostic[] = [];
  for (const [type, table] of scene.components) {
    const definition = registries.components.get(type);
    for (const [entityId, held] of table) {
      for (const [componentId, component] of held) {
        // Checked against its type, field by field: a field of the wrong kind,
        // one missing or one the type does not have refuses the scene. Nothing
        // is filled in — a field added since the file was written is a format
        // that moved, and the format's version moved with it.
        const decoded = definition?.decode(component, ['components', type, entityId, componentId]);
        if (decoded === undefined) continue;
        // The key is the identity: an override names the component by it.
        if (decoded.ok) held.set(componentId, { ...decoded.value, id: componentId });
        else refused.push(...decoded.diagnostics);
      }
    }
  }
  if (refused.length > 0) {
    throw new SceneFormatError(formatDiagnostics('Scene file holds components this build cannot read.', refused));
  }
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
 */
function repairHierarchy(scene: SceneDoc): void {
  const exists = (id: EntityId) => scene.entities.has(id);

  scene.rootOrder = scene.rootOrder.filter(exists);

  for (const entity of scene.entities.values()) {
    entity.children = entity.children.filter(exists);
    if (entity.parent !== null && !exists(entity.parent)) entity.parent = null;
  }

  // Cut each cycle by rooting the entity that closes it. The filtering above
  // cannot see one: every edge of a cycle points at an entity that exists. The
  // re-homing pass below then puts it in `rootOrder`.
  for (const chain of cycles(scene)) {
    const first = chain[0];
    const entity = first === undefined ? undefined : scene.entities.get(first);
    if (!entity) continue;
    const parent = entity.parent === null ? undefined : scene.entities.get(entity.parent);
    if (parent) parent.children = parent.children.filter((child) => child !== entity.id);
    entity.parent = null;
  }

  // Re-home anything that lost its parent and is not already a root.
  const referenced = new Set<EntityId>(scene.rootOrder);
  for (const entity of scene.entities.values()) {
    for (const child of entity.children) referenced.add(child);
  }
  for (const [id, entity] of scene.entities) {
    if (!referenced.has(id)) {
      entity.parent = null;
      scene.rootOrder.push(id);
    }
  }
}
