import { PREFAB_ID_SEPARATOR, SCENE_FORMAT_VERSION } from '../constants';
import { fillComponent } from '../components';
import { originAboveFeet } from '../components/collider/geometry';
import { isRecord } from '../conform';
import { describeDiagnostics, type Diagnostic } from '../decoded';
import {
  idMapOf,
  isComponentId,
  isComponentTypeId,
  isEntityId,
  type ComponentId,
  type EntityId,
} from '../ids';
import { stableJson } from '../json';
import type { CoreRegistries } from '../registries';
import { componentsOfType, findComponent, putComponent, type ComponentHost } from './components';
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
  /** Absent from a file older than the tables. A type this build does not define has its table here too. */
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
 * Accepts any previously written document version and returns the current one.
 *
 * Nearly all of it is version-blind on purpose: `fillMissingFields` merges each
 * component from its own factory and `adoptComponentTables` reads the data, so
 * a field added at any point in the past arrives filled without anyone writing
 * a case for it. That is what has kept this function from becoming a ladder.
 *
 * `raiseEyeHeightToFeet` is the first pass that cannot work that way, and the
 * difference is worth naming: it changes what a number **means** rather than
 * supplying one that is absent, and no amount of looking at `1.7` says which of
 * the two meanings it was written under. So it is gated on the version, and the
 * incoming number has to be read before the stamp at the bottom overwrites it.
 *
 * The gate is also why `migratePrefab` may not pass `SCENE_FORMAT_VERSION`: see
 * the note there.
 *
 * `registries` say which types this build knows: each registered type's
 * components are filled from its own definition, and any other is kept as
 * found, in `unknownComponents`.
 */
export function migrateScene(registries: CoreRegistries, input: unknown): SceneDoc {
  if (typeof input !== 'object' || input === null) {
    throw new SceneFormatError('Scene file is not an object.');
  }

  const doc = input as Partial<SceneJson>;
  if (typeof doc.version !== 'number') {
    throw new SceneFormatError('Scene file has no format version.');
  }
  if (doc.version > SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(
      `Scene was written by a newer version of the editor (format ${doc.version}, this build reads up to ${SCENE_FORMAT_VERSION}).`,
    );
  }
  // Not a Map, which an object is to `isRecord` and `Object.entries` reads as
  // empty: a document handed here by mistake would come out as a scene with no
  // entities, and nothing in the types says it was not a file.
  if (!isRecord(doc.entities) || doc.entities instanceof Map || !Array.isArray(doc.rootOrder)) {
    throw new SceneFormatError('Scene file is missing its entity table.');
  }

  const writtenAs = doc.version;
  const json = input as SceneJson;
  const scene: SceneDoc = {
    ...json,
    entities: idMapOf(json.entities, isEntityId),
    ...tablesFrom(registries, json.components),
  };
  repairHierarchy(scene);
  adoptComponentTables(registries, scene);
  fillMissingFields(registries, scene);
  // After the fill, not before: a collider written before one of its fields
  // existed carries `undefined` there until the fill has run, and the offset
  // would come out `NaN` — which would travel into the camera silently.
  if (writtenAs < EYE_HEIGHT_FROM_FEET) raiseEyeHeightToFeet(scene);
  // Stamped, so the document says which format it now conforms to. Without
  // this a migrated scene was saved back under its original number and the
  // "written by a newer editor" guard could never fire, however many formats
  // came later.
  scene.version = SCENE_FORMAT_VERSION;
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
 * A file can carry some types and not others — one added since it was written,
 * or one hand-edited out, or none at all for a document older than the tables —
 * and a type it holds nothing of gets no table: a missing one reads as empty.
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
 * The format in which `eyeHeight` changed meaning.
 *
 * A literal rather than `SCENE_FORMAT_VERSION`, and that is the whole point: it
 * names the document that *already* holds feet-relative values, so it must stay
 * at 10 while the current version goes on moving. Writing the current version
 * here would make the pass run again on every later format and raise a camera
 * by another collider each time.
 */
const EYE_HEIGHT_FROM_FEET = 10;

/**
 * Format 9 → 10: `eyeHeight` stops being measured from the entity's origin and
 * starts being measured from the character's feet.
 *
 * Raising each stored value by how far its collider reaches below the origin
 * is what makes the change invisible: the camera comes out at the height its
 * author put it, and the number now means what it says. An entity with no collider is left alone,
 * because with nothing centred on the origin the origin already *was* the
 * reference — which is also exactly what fly mode does.
 *
 * **One case this cannot reach**, and it is better said than discovered: a
 * prefab instance that overrides `eyeHeight`. The override lives in the scene,
 * but the collider it would have to be measured against lives inside the prefab
 * document, which this function does not have and must not go looking for —
 * a scene migration that read other files would be a scene that fails to open
 * because an asset is missing. Such an instance moves by its collider's half
 * height, which is visible, is one number, and is fixable in the Inspector.
 * Dropping the override instead would silently discard what its author wrote,
 * which is the worse of the two.
 */
function raiseEyeHeightToFeet(scene: SceneDoc): void {
  for (const [entityId, held] of componentsOfType(scene, 'playerController')) {
    const collider = findComponent(scene, entityId, 'collider');
    if (collider === undefined) continue;

    // The same collider the physics builds and the same one the controller
    // measures from: all three go through `findComponent`, so an entity
    // carrying two cannot have them disagree about which one is the body.
    //
    // Already filled, so always a shape this build reads. Every collider that
    // reaches here was written before scene 11 and reads as the factory's 1 m
    // box, its old shape not converted: the eye moves by that box's half, 0.5,
    // rather than by the capsule it may have been — a finite number, where the
    // shape read as written would have made it `NaN`.
    const below = originAboveFeet(collider.shape);
    for (const controller of held.values()) {
      if (controller.type === 'playerController') controller.eyeHeight += below;
    }
  }
}

/**
 * Fills in everything added since a scene was written.
 *
 * Against each type's own factory rather than a list kept by hand, so a
 * property added to a component is migrated by existing: keeping a second
 * list in step with the first is a promise nobody keeps, and this exact
 * omission has already shipped twice — texture slots and then geometry
 * segments both reached three as `undefined` on scenes a fortnight old.
 *
 * The alternative is defending at every read site. The binder proved why that
 * is worse: it threw once per frame, and a slider bound to `undefined` took
 * the whole Inspector down. Defaults are cheap; a scene that cannot open is
 * not.
 *
 * Over the document's tables, which are those of the registered types: a table
 * of any other is in `unknownComponents`, where `tablesFrom` kept it as found.
 */
function fillMissingFields(registries: CoreRegistries, scene: SceneDoc): void {
  const blank = createEnvironment();
  // Merged a level deeper for `sky`, because the spread above it is shallow and
  // a scene written before the analytic sky existed carries no `sky` at all —
  // or, worse, a `sky` from a build that had only half its fields. This is the
  // same second level `lightComponent.fill` merges for `shadow`, and it is the
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
        // Each type fills itself. Shallow is right for the flat ones; `mesh` owns
        // a material and a geometry that have to be merged a level deeper, and
        // that knowledge lives with `mesh` rather than as a special case here.
        const filled = fillComponent(registries, component);
        // The key is the identity; a `fill` that handed back a fresh id would
        // orphan every override naming it.
        filled.id = componentId;
        // A type written as a schema is then checked against it, field by
        // field. After the fill, so that a file written before one of its
        // fields existed still opens, as it does for every other type: what is
        // refused is a field of the wrong kind, or one the type does not have.
        const decoded = definition?.decode?.(filled, ['components', type, entityId, componentId]);
        if (decoded === undefined) held.set(componentId, filled);
        else if (decoded.ok) held.set(componentId, decoded.value);
        else refused.push(...decoded.diagnostics);
      }
    }
  }
  if (refused.length > 0) {
    throw new SceneFormatError(`Scene file holds components this build cannot read.\n${describeDiagnostics(refused)}`);
  }

  rekeyOverrides(scene);
}

/**
 * Moves components out of the entities and into the tables — format 3 → 4.
 *
 * Reads the array's **order** while it still means something: a document
 * written before components carried ids of their own has none, and the only way
 * to give it the same ones the prefab it points at will get is to derive them
 * from where the components already are. See `componentIdAt`.
 *
 * The legacy array is **deleted**, not left in place. Keeping it would be the
 * "add fields, never remove them" rule applied where it does the opposite of
 * what it is for: two copies of the same components, the stale one re-imported
 * on the next load and quietly overwriting every edit made since. And it would
 * help nobody — an editor that only reads format 3 refuses a format 4 document
 * on the version guard, whatever else is in the file.
 *
 * Gated on the **data** rather than on the version number, like `rekeyOverrides`
 * above: an entity that still holds an array is one that has not been through
 * here, and a document that has been through here has none. That also lets a
 * prefab borrow this pass without the two format numbers having to be mapped
 * onto each other.
 */
function adoptComponentTables(registries: CoreRegistries, scene: SceneDoc): void {
  for (const entity of scene.entities.values()) {
    const legacy = (entity as EntityDoc & { components?: ComponentDoc[] }).components;
    delete (entity as EntityDoc & { components?: ComponentDoc[] }).components;
    if (!Array.isArray(legacy)) continue;

    for (const [index, component] of legacy.entries()) {
      // Its own where it has one that is an id, and the one its place gives it
      // where it has none, which is every component this was written for.
      const id = isComponentId(component.id) ? component.id : componentIdAt(entity.id, index);
      // Read as the text a file holds, whatever the array claims of it.
      const type: unknown = component.type;
      if (!isComponentTypeId(type)) continue;
      if (registries.components.get(type) !== undefined) {
        putComponent(scene, entity.id, { ...component, id });
        continue;
      }
      // A type this build has never heard of is filed apart, keyed by the id its
      // position gives it — and its **body is not touched**, not even to add
      // that id. Filling it against a type we do not have would invent a shape,
      // and the next save would write that invention over the author's data.
      let table = scene.unknownComponents.get(type);
      if (table === undefined) {
        table = new Map();
        scene.unknownComponents.set(type, table);
      }
      let held = table.get(entity.id);
      if (held === undefined) {
        held = new Map();
        table.set(entity.id, held);
      }
      held.set(id, component);
    }
  }
}

/**
 * The id a component written before ids gets, from where it already is.
 *
 * The whole migration turns on this being **derivable on both sides of a file
 * boundary**. An override lives in the scene, on the instance component; the
 * component it names lives in the prefab, a different file migrated at a
 * different time by code holding only one of the two. Neither can look the other
 * up — but both know the entity id and the index, so both compute the same
 * string and meet in the middle.
 *
 * The result is opaque from the moment it is written. Nothing may parse an index
 * back out of it: an id that can be turned into a position is a position, and a
 * position is the bug this replaces.
 */
function componentIdAt(entityId: string, index: number): ComponentId {
  const id = `${entityId}:${index}`;
  // It holds a colon, so it is never empty and the check cannot fail: it is what
  // narrows the text to an id, where a cast would claim that it is one.
  if (!isComponentId(id)) throw new SceneFormatError(`No component id can be made of "${id}".`);
  return id;
}

/**
 * Moves prefab overrides from naming a component by position to naming it by id.
 *
 * `components` was `Record<number, …>`, so inserting a component into a
 * prefab slid every override of every instance one place along — mass landed on
 * the collider, and the override that had been last landed on nothing.
 *
 * Runs once, at the boundary, and only on keys that are still integers, so a
 * document that has already been through here is left alone. That matters more
 * than it looks: re-running it against indices that no longer mean anything is
 * exactly how the data would be lost.
 */
function rekeyOverrides(scene: SceneDoc): void {
  for (const held of componentsOfType(scene, 'prefabInstance').values()) {
    for (const component of held.values()) {
      if (component.type !== 'prefabInstance') continue;
      for (const [path, override] of Object.entries(component.overrides)) {
        if (!override.components) continue;

        // The override key is a path through nested prefabs — `lampRoot`, or
        // `inner/lampRoot`. Its last segment is the entity id inside the prefab
        // that actually holds the component, which is what that prefab used to
        // build its own ids.
        const localEntityId = path.split(PREFAB_ID_SEPARATOR).at(-1) ?? path;

        const rekeyed: Record<ComponentId, Record<string, unknown>> = {};
        for (const [key, properties] of Object.entries(override.components)) {
          const index = Number(key);
          const id = Number.isInteger(index) && key === String(index) ? componentIdAt(localEntityId, index) : key;
          // A key that is no id names no component, which is the empty one alone.
          if (isComponentId(id)) rekeyed[id] = properties;
        }
        override.components = rekeyed;
      }
    }
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
