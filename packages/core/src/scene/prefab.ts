import { PREFAB_FORMAT_VERSION, PREFAB_ID_SEPARATOR, SCENE_FORMAT_VERSION } from '../constants';
import { createId } from '../ids';
import {
  COMPONENT_TYPES,
  componentsOf,
  emptyComponentTables,
  entitiesWith,
  findComponent,
  type ComponentHost,
} from './components';
import { createEmptyScene, createEntity, createPrefabInstance } from './defaults';
import { collectDescendants } from './query';
import { migrateScene } from './serialization';
import type {
  ComponentDoc,
  ComponentTables,
  EntityDoc,
  PrefabInstanceComponent,
  PrefabOverride,
  SceneDoc,
  Transform,
} from './schema';

/**
 * A prefab asset: a sub-tree of entities, stored once and instanced many times.
 *
 * It reuses `EntityDoc` rather than inventing a shape of its own, which is the
 * whole reason this is cheap — one schema, one binder, one serialiser, one
 * migration. Godot goes further and makes a prefab just another scene; we stop
 * short of that only because our scenes carry an environment block a prefab has
 * no use for.
 */
export interface PrefabDoc {
  version: number;
  id: string;
  name: string;
  /** Ids are local to the prefab, and stay stable so overrides keep pointing. */
  entities: Record<string, EntityDoc>;
  /** The same block a scene carries — see `ComponentTables`. */
  components: ComponentTables;
  root: string;
}

export function createPrefabDoc(
  name: string,
  entities: EntityDoc[],
  components: ComponentTables,
  root: string,
): PrefabDoc {
  return {
    version: PREFAB_FORMAT_VERSION,
    id: createId(),
    name,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    components,
    root,
  };
}

/**
 * The components of a chosen set of entities, and nothing else.
 *
 * Lifting a sub-tree out of a scene — or writing one back — has to carry the
 * components of exactly those entities. Taking the whole block would put every
 * other entity's components in the prefab; taking none loses them.
 */
function componentsFor(host: ComponentHost, ids: readonly string[]): ComponentTables {
  const tables = emptyComponentTables();
  const wanted = new Set(ids);
  for (const type of COMPONENT_TYPES) {
    const table = tables[type] as Record<string, Record<string, ComponentDoc>>;
    for (const [entityId, held] of Object.entries(host.components[type])) {
      if (wanted.has(entityId)) table[entityId] = structuredClone(held) as Record<string, ComponentDoc>;
    }
  }
  return tables;
}

/**
 * Lifts entities out of a scene into a prefab.
 *
 * The root's own transform is reset: a prefab describes a shape, not a place.
 * Where an instance sits is the instance's business, and a prefab that
 * remembered where it was first made would drop every copy in the same spot.
 */
export function prefabFromEntities(name: string, scene: SceneDoc, rootId: string): PrefabDoc {
  const ids = [rootId, ...collectDescendants(scene, rootId)];
  const entities = ids
    .map((id) => scene.entities[id])
    .filter((entity): entity is EntityDoc => entity !== undefined)
    .map((entity) => structuredClone(entity));

  const root = entities.find((entity) => entity.id === rootId);
  if (!root) throw new Error(`Entity ${rootId} is not in the scene.`);
  root.parent = null;
  root.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

  return createPrefabDoc(name, entities, componentsFor(scene, ids), rootId);
}

/**
 * A prefab as a scene, so it can be edited with the tools a scene has.
 *
 * Prefab Mode is not a second editor: the hierarchy, the inspector, the gizmo
 * and the binder all take a `SceneDoc`, and handing them one is what makes
 * editing a prefab cost nothing to build. Unity's Prefab Mode is the same
 * trick — an isolated stage holding one object.
 */
export function prefabToScene(prefab: PrefabDoc): SceneDoc {
  return {
    ...createEmptyScene(),
    id: prefab.id,
    name: prefab.name,
    entities: structuredClone(prefab.entities),
    components: structuredClone(prefab.components),
    rootOrder: [prefab.root],
  };
}

/**
 * The prefab a Prefab Mode session produced.
 *
 * Keeps the asset's id and name: the file is being rewritten, not replaced, and
 * a new id would orphan every instance in every scene that names this one.
 */
export function sceneToPrefab(scene: SceneDoc, original: PrefabDoc): PrefabDoc {
  const root = scene.rootOrder[0] ?? original.root;
  const entities = structuredClone(scene.entities);

  // A prefab has one root; a scene does not. Adding a cube while editing one
  // puts it beside the root rather than under it, and keeping the scene's shape
  // would write an entity into the asset that nothing parents and nothing ever
  // draws. Adopted instead, which is what the hierarchy showed anyway.
  const adopted = scene.rootOrder.slice(1).filter((id) => entities[id] !== undefined);
  if (adopted.length > 0 && entities[root]) {
    for (const id of adopted) entities[id]!.parent = root;
    entities[root]!.children = [...entities[root]!.children, ...adopted];
  }

  return {
    ...original,
    version: PREFAB_FORMAT_VERSION,
    entities,
    components: componentsFor(scene, Object.keys(entities)),
    root,
  };
}

/**
 * A prefab that is a variant of another: one entity, holding an instance of the
 * base, with its own overrides.
 *
 * Unity's Prefab Variant, and it needs nothing the expansion did not already
 * do — a prefab that places another prefab is exactly what a variant is. What
 * makes it a variant rather than an ordinary nesting is that the instance *is*
 * the root: edit the base and every variant follows, override on the variant
 * and only it differs.
 */
export function prefabVariantOf(name: string, base: PrefabDoc, baseAssetId: string): PrefabDoc {
  const root = createEntity(name, [createPrefabInstance(baseAssetId)]);
  const components = emptyComponentTables();
  components.prefabInstance[root.entity.id] = Object.fromEntries(
    root.components.map((component) => [component.id, component as PrefabInstanceComponent]),
  );
  return createPrefabDoc(name, [root.entity], components, root.entity.id);
}

/** The prefab a variant is based on, or `null` for an ordinary prefab. */
export function variantBaseOf(prefab: PrefabDoc): string | null {
  const root = prefab.entities[prefab.root];
  if (!root) return null;

  // A variant is a single root that is an instance. A prefab that merely
  // *contains* an instance somewhere is a composition, not a variant, and
  // treating the two alike would let "revert to base" wipe a hand-built scene.
  const only = Object.keys(prefab.entities).length === 1;
  const instance = prefabInstanceOf(prefab, root.id);
  return only && instance ? instance.assetId : null;
}

/** The id an instance's copy of a prefab entity gets in the expanded scene. */
export function instancedId(instanceId: string, localId: string): string {
  return `${instanceId}${PREFAB_ID_SEPARATOR}${localId}`;
}

/** The instance an expanded id belongs to, or `null` for a scene's own entity. */
export function instanceOwnerOf(id: string): string | null {
  const index = id.indexOf(PREFAB_ID_SEPARATOR);
  return index === -1 ? null : id.slice(0, index);
}

/**
 * Splits an expanded id into the instance that placed it and the id it has
 * inside that prefab. `null` for an entity the document holds itself.
 *
 * `local` is the whole path from the instance to the entity — `lampRoot` for
 * something the prefab holds directly, `inner/lampRoot` for something a prefab
 * it places holds — and that is exactly the key an override is stored under.
 * `depth` counts the prefabs crossed, for anything that wants to say so.
 */
export function splitInstancedId(
  id: string,
): { owner: string; local: string; depth: number } | null {
  const index = id.indexOf(PREFAB_ID_SEPARATOR);
  if (index === -1) return null;

  const rest = id.slice(index + 1);
  return {
    owner: id.slice(0, index),
    local: rest,
    depth: rest.split(PREFAB_ID_SEPARATOR).length,
  };
}

/**
 * The instance component an entity carries, if it is a prefab placement.
 *
 * Nine call sites had written this `find` out by hand, each with its own type
 * predicate. Not a factoring nicety: an entity holding *two* instance components
 * expands to the same ids twice and keeps half of each, so "the instance
 * component" being a single well-known lookup is what makes that a bug with one
 * place to fix rather than nine places to remember.
 */
export function prefabInstanceOf(
  host: ComponentHost,
  entityId: string,
): PrefabInstanceComponent | undefined {
  return findComponent(host, entityId, 'prefabInstance');
}

export interface PrefabLibrary {
  get(assetId: string): PrefabDoc | undefined;
}

/**
 * Produces the scene the runtime actually draws, with every instance replaced
 * by its contents.
 *
 * One expansion point, so the binder, the physics world and the behaviour
 * registry all keep working on a plain `SceneDoc` and know nothing about
 * prefabs. Doing it the other way — teaching each of them to walk into an
 * instance — is three places to forget instead of one.
 *
 * `previous` lets an unchanged instance hand back the entities it produced last
 * time. The binder decides what to rebuild by comparing object identity, so a
 * fresh copy on every keystroke would throw away every geometry and material in
 * the scene.
 */
export function expandPrefabs(
  scene: SceneDoc,
  prefabs: PrefabLibrary,
  previous?: ExpandedScene,
): ExpandedScene {
  const instances = findInstances(scene);
  if (instances.length === 0) return { scene, sources: new Map() };

  const entities: Record<string, EntityDoc> = { ...scene.entities };
  const components = {} as ComponentTables;
  for (const type of COMPONENT_TYPES) components[type] = { ...scene.components[type] } as never;
  const sources = new Map<string, InstanceSource>();

  const adopt = (produced: Produced): void => {
    for (const entity of produced.entities) entities[entity.id] = entity;
    for (const type of COMPONENT_TYPES) {
      Object.assign(components[type], produced.components[type]);
    }
  };

  for (const { entityId, component } of instances) {
    // Every prefab the expansion will read, not just the one named here: a
    // prefab that places other prefabs changes when any of them does.
    const chain = chainOf(component.assetId, prefabs);
    const reused = previous?.sources.get(entityId);

    // Identity, not equality: immer preserves it for anything untouched, so
    // this is an exact "nothing about this instance changed". The *components*
    // handed back are the same objects too, which is what stops the binder
    // rebuilding everything an instance holds on every keystroke.
    if (reused && reused.component === component && sameChain(reused.chain, chain)) {
      adopt(reused.produced);
      sources.set(entityId, reused);
      continue;
    }

    const prefab = chain[0];
    if (!prefab) {
      // A missing prefab leaves the instance as an empty entity rather than
      // removing it: the reference is still in the document, and deleting what
      // an author placed because an asset is momentarily unreadable is worse
      // than showing nothing there.
      sources.set(entityId, {
        component,
        chain,
        produced: { entities: [], components: emptyComponentTables() },
      });
      continue;
    }

    const produced = instantiate(entityId, prefab, component, prefabs, [component.assetId]);
    adopt(produced);
    sources.set(entityId, { component, chain, produced });
  }

  return { scene: { ...scene, entities, components }, sources };
}

export interface ExpandedScene {
  scene: SceneDoc;
  /** What each instance produced, so the next expansion can reuse it. */
  sources: Map<string, InstanceSource>;
}

/** One instance's contents: the entities, and the components they carry. */
interface Produced {
  entities: EntityDoc[];
  components: ComponentTables;
}

interface InstanceSource {
  component: PrefabInstanceComponent;
  /** Every prefab doc the expansion read, so a change to a nested one is seen. */
  chain: readonly (PrefabDoc | undefined)[];
  produced: Produced;
}

/**
 * The prefabs an instance of `assetId` reads, itself first.
 *
 * Cheap — it looks documents up and never copies anything — which is what lets
 * the reuse check run on every sync.
 */
function chainOf(
  assetId: string,
  prefabs: PrefabLibrary,
  seen = new Set<string>(),
): (PrefabDoc | undefined)[] {
  if (seen.has(assetId)) return [];
  seen.add(assetId);

  const prefab = prefabs.get(assetId);
  const chain: (PrefabDoc | undefined)[] = [prefab];
  if (!prefab) return chain;

  for (const held of Object.values(prefab.components.prefabInstance)) {
    for (const component of Object.values(held)) {
      chain.push(...chainOf(component.assetId, prefabs, seen));
    }
  }
  return chain;
}

function sameChain(
  a: readonly (PrefabDoc | undefined)[],
  b: readonly (PrefabDoc | undefined)[],
): boolean {
  return a.length === b.length && a.every((prefab, index) => prefab === b[index]);
}

/**
 * Every placement in the scene.
 *
 * A table lookup rather than a walk of the entity table, which is what this
 * used to be — and the walk ran on every expansion, so on every keystroke.
 */
function findInstances(
  scene: SceneDoc,
): { entityId: string; component: PrefabInstanceComponent }[] {
  const found: { entityId: string; component: PrefabInstanceComponent }[] = [];
  for (const entityId of entitiesWith(scene, 'prefabInstance')) {
    // One per entity: a second would produce the same ids as the first and
    // silently overwrite half of it.
    const component = findComponent(scene, entityId, 'prefabInstance');
    if (component && scene.entities[entityId]) found.push({ entityId, component });
  }
  return found;
}

/**
 * One instance's overrides, and the path they are keyed by from where they were
 * written down to the entity being built.
 *
 * A scene places a room; the room places a lamp. Nudging that lamp is an
 * override on the *scene's* instance, keyed `inner/lampRoot` — there is no
 * component in the scene belonging to the room's own placement of the lamp,
 * because that placement lives in the room asset. Unity's `m_Modifications`
 * reach through nesting the same way, and for the same reason.
 */
interface OverrideLayer {
  overrides: Record<string, PrefabOverride>;
  /** Empty where the layer was written; `inner/` one prefab in; `a/b/` two. */
  prefix: string;
}

function instantiate(
  hostId: string,
  prefab: PrefabDoc,
  component: PrefabInstanceComponent,
  prefabs: PrefabLibrary,
  ancestry: readonly string[],
  inherited: readonly OverrideLayer[] = [],
): Produced {
  const produced: Produced = { entities: [], components: emptyComponentTables() };

  // Nearest first, so the ones further out are applied last and win: what the
  // scene says about an object beats what the variant that placed it says,
  // which in turn beats the base. Same order of authority as Unity's.
  const layers: OverrideLayer[] = [{ overrides: component.overrides, prefix: '' }, ...inherited];

  for (const local of Object.values(prefab.entities)) {
    const copy: EntityDoc = {
      ...structuredClone(local),
      id: instancedId(hostId, local.id),
      // The prefab's root hangs under the entity that placed it, so the
      // instance's own transform is where the copy sits in the world.
      parent: local.id === prefab.root ? hostId : instancedId(hostId, local.parent ?? prefab.root),
      children: local.children.map((child) => instancedId(hostId, child)),
    };

    // The prefab's own components, copied — the instance may override them, and
    // an override that reached back into the asset would change every other
    // placement of it.
    let held = componentsOf(prefab, local.id).map((held) => structuredClone(held));

    for (const layer of layers) {
      const override = layer.overrides[`${layer.prefix}${local.id}`];
      if (override) held = applyPrefabOverride(copy, held, override);
    }
    // A component that points at another entity — a script property declared
    // `type: 'entity'` — holds an id local to the prefab, which nothing in the
    // expanded scene answers to. Without this a prefab whose script targets its
    // own turret looked up an id that does not exist, once per instance.
    held = remapEntityReferences(held, prefab.entities, hostId);

    produced.entities.push(copy);
    for (const item of held) {
      const table = produced.components[item.type] as Record<string, Record<string, ComponentDoc>>;
      (table[copy.id] ??= {})[item.id] = item;
    }

    // A prefab may place other prefabs. Expanding them here rather than in a
    // second pass keeps one instance's whole production in one block, which is
    // what the reuse check hands back untouched.
    const inner = held.find(
      (item): item is PrefabInstanceComponent => item.type === 'prefabInstance',
    );
    if (!inner) continue;

    const innerPrefab = prefabs.get(inner.assetId);
    // A prefab that contains itself, however deep, has no finite expansion.
    if (!innerPrefab || ancestry.includes(inner.assetId)) continue;

    // Every layer gains one path segment rather than being re-keyed, which is
    // what makes this work at any depth without the expansion counting levels.
    const nested = instantiate(
      copy.id,
      innerPrefab,
      inner,
      prefabs,
      [...ancestry, inner.assetId],
      layers.map((layer) => ({
        overrides: layer.overrides,
        prefix: `${layer.prefix}${local.id}${PREFAB_ID_SEPARATOR}`,
      })),
    );
    produced.entities.push(...nested.entities);
    for (const type of COMPONENT_TYPES) {
      Object.assign(produced.components[type], nested.components[type]);
    }
  }

  return produced;
}

/**
 * Rewrites references to the prefab's own entities so they name the copies.
 *
 * Matched by value rather than by a declared list of reference fields: which
 * properties hold an entity id is decided by a user's script at runtime, and
 * core cannot see that. An id is twelve random characters, so a string that
 * equals one and means something else does not happen in practice — and the
 * alternative, leaving the reference pointing into the asset, is a lookup that
 * silently returns nothing.
 */
function remapEntityReferences(
  components: readonly ComponentDoc[],
  local: Record<string, EntityDoc>,
  hostId: string,
): ComponentDoc[] {
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return local[value] === undefined ? value : instancedId(hostId, value);
    }
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

/**
 * Folds one override into an entity, in place.
 *
 * Exported because "apply overrides to the prefab" has to fold exactly the same
 * way the expansion does — a second implementation would drift, and the two
 * disagreeing is the shape of bug nobody finds until a scene is already wrong.
 */
export function applyPrefabOverride(
  entity: EntityDoc,
  components: readonly ComponentDoc[],
  override: PrefabOverride,
): ComponentDoc[] {
  if (override.name !== undefined) entity.name = override.name;
  if (override.visible !== undefined) entity.visible = override.visible;
  if (override.transform) {
    entity.transform = { ...entity.transform, ...override.transform } as Transform;
  }

  const out = [...components];
  for (const [componentId, properties] of Object.entries(override.components ?? {})) {
    const index = out.findIndex((candidate) => candidate.id === componentId);
    // The prefab no longer has that component: drop the stale override rather
    // than fail. Unity does the same, and by id this now covers the case that
    // used to be silent — an index still in range but pointing at a different
    // component, which is what B10 wrote onto the wrong one.
    if (index === -1) continue;
    out[index] = {
      ...out[index],
      ...properties,
      // Never overridable: it is what this very lookup keys on.
      id: componentId,
    } as ComponentDoc;
  }
  return out;
}

/**
 * Fills in what a prefab written by an older editor lacks.
 *
 * It holds `EntityDoc`s, so it inherits every problem a scene has and the same
 * answer: one pass at the boundary, filling from each type's own factory. See
 * the format rules in the README.
 */
export function migratePrefab(prefab: PrefabDoc): PrefabDoc {
  // Borrowed wholesale: a prefab is a scene without an environment, and
  // duplicating the walk is how the two would drift apart.
  const asScene = migrateScene({
    version: SCENE_FORMAT_VERSION,
    id: prefab.id,
    name: prefab.name,
    entities: prefab.entities,
    components: prefab.components,
    rootOrder: [prefab.root],
    environment: createEmptyScene().environment,
  });

  return {
    ...prefab,
    version: PREFAB_FORMAT_VERSION,
    entities: asScene.entities,
    components: asScene.components,
  };
}
