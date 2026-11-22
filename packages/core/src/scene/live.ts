import type { ComponentId, EntityId } from '../ids';
import { tableIn } from './components';
import { listContents } from './prefab';
import type { ComponentTables, EntityDoc, SceneDoc, UnknownComponentTables } from './schema';

/**
 * A running world's scene: a copy the world edits with the graph's functions
 * and `putComponent` as its game spawns, destroys and instantiates, which the
 * scene it was made from never sees.
 *
 * Its own entity records, root order, component tables and each entity's Map:
 * everything an edit writes. The editor hands Play a document immer has frozen,
 * and the graph's functions write records in place — `linkEntity` splices a
 * parent's `children` —, so a game spawning under a record of that document
 * would throw, or write into the scene being edited, which Stop goes back to.
 * The components are shared: an edit replaces a component and never writes
 * into one, and a copy of each would cost what the scene's own cost again. No
 * immer here: a game edits every frame, and would pay a copy per edit, and the
 * player a dependency, for a history nothing undoes.
 *
 * The environment is shared too: no edit of a running game reaches it.
 *
 * Every entity is listed in its parent's `children`, an instance's contents
 * under their placement (see `listContents`): a game destroys a placement with
 * everything it placed, and parents under what a prefab made.
 */
export function liveScene(scene: SceneDoc): SceneDoc {
  const entities = new Map<EntityId, EntityDoc>();
  for (const [id, entity] of scene.entities) entities.set(id, { ...entity, children: [...entity.children] });
  listContents(entities, [...entities.values()]);

  const components: ComponentTables = new Map();
  for (const [type, table] of scene.components) components.set(type, ownTable(table));
  const unknownComponents: UnknownComponentTables = new Map();
  for (const [type, { version, components: table }] of scene.unknownComponents) {
    unknownComponents.set(type, { version, components: ownTable(table) });
  }

  return { ...scene, entities, components, unknownComponents, rootOrder: [...scene.rootOrder] };
}

/** One type's table, its own down to each entity's Map; the components in it the same. */
function ownTable<Held>(
  table: ReadonlyMap<EntityId, ReadonlyMap<ComponentId, Held>>,
): Map<EntityId, Map<ComponentId, Held>> {
  const own = new Map<EntityId, Map<ComponentId, Held>>();
  for (const [entityId, held] of table) own.set(entityId, new Map(held));
  return own;
}

/**
 * Moves a scene into a running world's document: its records, its components
 * and its roots, after what the document holds, leaving `from` empty.
 *
 * A world builds a scene apart and merges it at its start, so that nothing of it
 * is in the document — no subsystem mounts it, no script reaches it — until then.
 * What moves is the very records and Maps `from` held: the drawing side built
 * its objects from them, and keeps each one whose record and components are the
 * same objects, so a start rebuilds nothing. `from` is a `liveScene` copy, the
 * world's own, so nothing else holds what it gives up.
 *
 * A shared entity id would leave two scenes writing one record, so it throws
 * before anything moves; the world refuses such a scene at its load, and this
 * is the guard behind it. A type this build lacks keeps the document's version
 * when both hold it: a running document is never written to a file.
 */
export function mergeScene(into: SceneDoc, from: SceneDoc): void {
  for (const id of from.entities.keys()) {
    if (into.entities.has(id)) throw new Error(`Scene "${from.name}" shares the entity ${id} with the world's document`);
  }
  for (const [id, entity] of from.entities) into.entities.set(id, entity);
  for (const [type, table] of from.components) {
    const target = tableIn(into.components, type);
    for (const [entityId, held] of table) target.set(entityId, held);
  }
  for (const [type, table] of from.unknownComponents) {
    const target = into.unknownComponents.get(type);
    if (target === undefined) into.unknownComponents.set(type, table);
    else for (const [entityId, held] of table.components) target.components.set(entityId, held);
  }
  // One push per root rather than a spread, which passes each root as an argument and overflows the stack past some hundred thousand.
  for (const id of from.rootOrder) into.rootOrder.push(id);

  from.entities.clear();
  from.components.clear();
  from.unknownComponents.clear();
  from.rootOrder.length = 0;
}
