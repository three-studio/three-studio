import { PREFAB_ID_SEPARATOR, SCENE_FORMAT_VERSION } from '../constants';
import { fillComponent } from '../components';
import {
  COMPONENT_TYPES,
  emptyComponentTables,
  isKnownComponentType,
  putComponent,
} from './components';
import { createEntity, createEnvironment } from './defaults';
import { cycles } from './query';
import type { ComponentDoc, ComponentTables, EntityDoc, SceneDoc } from './schema';

export class SceneFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneFormatError';
  }
}

/** Indented so scene files stay reviewable in a diff. */
export function serializeScene(scene: SceneDoc): string {
  return JSON.stringify(scene, null, 2);
}

export function deserializeScene(json: string): SceneDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new SceneFormatError(`Scene file is not valid JSON: ${(cause as Error).message}`);
  }
  return migrateScene(parsed);
}

/**
 * Accepts any previously written document version and returns the current one.
 *
 * There is only one version so far, so this is a validation gate — but the
 * branch point exists from day one so a future format change is a case
 * statement rather than a compatibility break for existing projects.
 */
export function migrateScene(input: unknown): SceneDoc {
  if (typeof input !== 'object' || input === null) {
    throw new SceneFormatError('Scene file is not an object.');
  }

  const doc = input as Partial<SceneDoc>;
  if (typeof doc.version !== 'number') {
    throw new SceneFormatError('Scene file has no format version.');
  }
  if (doc.version > SCENE_FORMAT_VERSION) {
    throw new SceneFormatError(
      `Scene was written by a newer version of the editor (format ${doc.version}, this build reads up to ${SCENE_FORMAT_VERSION}).`,
    );
  }
  if (typeof doc.entities !== 'object' || doc.entities === null || !Array.isArray(doc.rootOrder)) {
    throw new SceneFormatError('Scene file is missing its entity table.');
  }

  const scene = input as SceneDoc;
  repairHierarchy(scene);
  adoptComponentTables(scene);
  fillMissingFields(scene);
  // Stamped, so the document says which format it now conforms to. Without
  // this a migrated scene was saved back under its original number and the
  // "written by a newer editor" guard could never fire, however many formats
  // came later.
  scene.version = SCENE_FORMAT_VERSION;
  return scene;
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
 */
function fillMissingFields(scene: SceneDoc): void {
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

  for (const entity of Object.values(scene.entities)) {
    const blank = createEntity(entity.name ?? 'Entity').entity;
    entity.transform = {
      ...blank.transform,
      ...entity.transform,
    };
    entity.visible ??= blank.visible;
    entity.locked ??= blank.locked;
    entity.children ??= [];
  }

  for (const type of COMPONENT_TYPES) {
    // Indexed by a variable the mapped type is a union of eleven records, which
    // `Object.values` widens to `unknown`. The table's construction is what says
    // these are components.
    const table = scene.components[type] as Record<string, Record<string, ComponentDoc>>;
    for (const held of Object.values(table)) {
      for (const [componentId, component] of Object.entries(held)) {
        // Each type fills itself. Shallow is right for the flat ones; `mesh` owns
        // a material and a geometry that have to be merged a level deeper, and
        // that knowledge lives with `mesh` rather than as a special case here.
        const filled = fillComponent(component) as ComponentDoc;
        // The key is the identity; a `fill` that handed back a fresh id would
        // orphan every override naming it.
        filled.id = componentId;
        held[componentId] = filled as never;
      }
    }
  }

  rekeyOverrides(scene);
}

/**
 * Moves components out of the entities and into the tables — format 3 → 4.
 *
 * Reads the array's **order** while it still means something: a document
 * written before phase 3 has no component ids, and the only way to give it the
 * same ones the prefab it points at will get is to derive them from where the
 * components already are. See `componentIdAt`.
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
function adoptComponentTables(scene: SceneDoc): void {
  const tables = (scene.components ?? emptyComponentTables()) as ComponentTables;
  // A file could carry some tables and not others — a type added since it was
  // written, or one hand-edited out.
  for (const type of COMPONENT_TYPES) tables[type] ??= {};
  scene.components = tables;

  for (const entity of Object.values(scene.entities)) {
    const legacy = (entity as EntityDoc & { components?: ComponentDoc[] }).components;
    delete (entity as EntityDoc & { components?: ComponentDoc[] }).components;
    if (!Array.isArray(legacy)) continue;

    for (const [index, component] of legacy.entries()) {
      const id = component.id ?? componentIdAt(entity.id, index);
      if (isKnownComponentType(component.type)) {
        putComponent(scene, entity.id, { ...component, id });
        continue;
      }
      // A type this build has never heard of is filed under a table of its own,
      // keyed by the id its position gives it — and its **body is not touched**,
      // not even to add that id. Filling it against a type we do not have would
      // invent a shape, and the next save would write that invention over the
      // author's data. A field is deprecated, never lost.
      const unknown = scene.components as unknown as Record<
        string,
        Record<string, Record<string, ComponentDoc>>
      >;
      const table = (unknown[component.type] ??= {});
      (table[entity.id] ??= {})[id] = component;
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
function componentIdAt(entityId: string, index: number): string {
  return `${entityId}:${index}`;
}

/**
 * Moves prefab overrides from naming a component by position to naming it by id.
 *
 * B10: `components` was `Record<number, …>`, so inserting a component into a
 * prefab slid every override of every instance one place along — mass landed on
 * the collider, and the override that had been last landed on nothing.
 *
 * Runs once, at the boundary, and only on keys that are still integers, so a
 * document that has already been through here is left alone. That matters more
 * than it looks: re-running it against indices that no longer mean anything is
 * exactly how the data would be lost.
 */
function rekeyOverrides(scene: SceneDoc): void {
  for (const held of Object.values(scene.components.prefabInstance)) {
    for (const component of Object.values(held)) {
      for (const [path, override] of Object.entries(component.overrides)) {
        if (!override.components) continue;

        // The override key is a path through nested prefabs — `lampRoot`, or
        // `inner/lampRoot`. Its last segment is the entity id inside the prefab
        // that actually holds the component, which is what that prefab used to
        // build its own ids.
        const localEntityId = path.split(PREFAB_ID_SEPARATOR).at(-1) ?? path;

        const rekeyed: Record<string, Record<string, unknown>> = {};
        for (const [key, properties] of Object.entries(override.components)) {
          const index = Number(key);
          rekeyed[Number.isInteger(index) && key === String(index) ? componentIdAt(localEntityId, index) : key] =
            properties;
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
  const exists = (id: string) => Object.hasOwn(scene.entities, id);

  scene.rootOrder = scene.rootOrder.filter(exists);

  for (const entity of Object.values(scene.entities)) {
    entity.children = entity.children.filter(exists);
    if (entity.parent !== null && !exists(entity.parent)) entity.parent = null;
  }

  // Cut each cycle by rooting the entity that closes it. The filtering above
  // cannot see one: every edge of a cycle points at an entity that exists. The
  // re-homing pass below then puts it in `rootOrder`.
  for (const chain of cycles(scene)) {
    const entity = scene.entities[chain[0] ?? ''];
    if (!entity) continue;
    const parent = scene.entities[entity.parent ?? ''];
    if (parent) parent.children = parent.children.filter((child) => child !== entity.id);
    entity.parent = null;
  }

  // Re-home anything that lost its parent and is not already a root.
  const referenced = new Set<string>(scene.rootOrder);
  for (const entity of Object.values(scene.entities)) {
    for (const child of entity.children) referenced.add(child);
  }
  for (const id of Object.keys(scene.entities)) {
    if (!referenced.has(id)) {
      const entity = scene.entities[id];
      if (entity) entity.parent = null;
      scene.rootOrder.push(id);
    }
  }
}
