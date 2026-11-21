import type { ComponentId, EntityId } from '../ids';
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
