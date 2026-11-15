import { PREFAB_FORMAT_VERSION, PREFAB_ID_SEPARATOR, SCENE_FORMAT_VERSION } from '../constants';
import { isRecord } from '../conform';
import { formatDiagnostics, versionRefusal } from '../decoded';
import {
  createAssetId,
  idMapOf,
  isAssetId,
  isEntityId,
  type AssetId,
  type ComponentId,
  type EntityId,
} from '../ids';
import { stableJson } from '../json';
import type { CoreRegistries } from '../registries';
import {
  componentsOf,
  componentsOfType,
  entitiesWith,
  findComponent,
  putComponent,
  renameEntityReferences,
  setComponentsOf,
  tableIn,
  type ComponentHost,
} from './components';
import { fillComponent } from '../components';
import { createPrefabInstance } from '../components/prefabInstance/defaults';
import { createEmptyScene } from './defaults';
import { createEntity } from './entity';
import { collectDescendants } from './query';
import { componentsJsonOf, migrateScene, SceneFormatError } from './serialization';
import type {
  ComponentDoc,
  ComponentTables,
  EntityDoc,
  PrefabInstanceComponent,
  PrefabOverride,
  SceneDoc,
  Transform,
  UnknownComponentTables,
} from './schema';

/**
 * A prefab asset: a sub-tree of entities, stored once and instanced many times.
 *
 * It reuses `EntityDoc` rather than inventing a shape of its own, which is the
 * whole reason this is cheap — one schema, one binder, one serialiser, one
 * reader. Godot goes further and makes a prefab just another scene; we stop
 * short of that only because our scenes carry an environment block a prefab has
 * no use for.
 */
export interface PrefabDoc {
  version: number;
  /**
   * The prefab's asset id: what an instance's `assetId` names, and what its
   * sidecar holds. A prefab is an asset, so it has the one id and not two.
   */
  id: AssetId;
  name: string;
  /** Ids are local to the prefab, and stay stable so overrides keep pointing. */
  entities: Map<EntityId, EntityDoc>;
  /** The same block a scene carries — see `ComponentTables`. */
  components: ComponentTables;
  /** And what a scene carries beside it — see `UnknownComponentTables`. */
  unknownComponents: UnknownComponentTables;
  root: EntityId;
}

/**
 * A prefab of these entities, under a new asset id.
 *
 * `held` is what they carry, lifted from the scene they came from; left out,
 * they carry nothing yet.
 */
export function createPrefabDoc(
  name: string,
  entities: EntityDoc[],
  root: EntityId,
  held: Required<ComponentHost> = { components: new Map(), unknownComponents: new Map() },
): PrefabDoc {
  return {
    version: PREFAB_FORMAT_VERSION,
    id: createAssetId(),
    name,
    entities: new Map(entities.map((entity) => [entity.id, entity])),
    components: held.components,
    unknownComponents: held.unknownComponents,
    root,
  };
}

/**
 * The components of a chosen set of entities, and nothing else.
 *
 * Lifting a sub-tree out of a scene — or writing one back — has to carry the
 * components of exactly those entities. Taking the whole block would put every
 * other entity's components in the prefab; taking none loses them.
 *
 * Those of the types this build does not define go with them, as found: a
 * prefab made in an editor that lacks a module must still hold what the module
 * will draw.
 */
function componentsFor(host: Required<ComponentHost>, ids: readonly EntityId[]): Required<ComponentHost> {
  const wanted = new Set(ids);
  const lifted = <Held>(from: Map<EntityId, Map<ComponentId, Held>>): Map<EntityId, Map<ComponentId, Held>> => {
    const into = new Map<EntityId, Map<ComponentId, Held>>();
    for (const [entityId, held] of from) {
      if (wanted.has(entityId)) into.set(entityId, structuredClone(held));
    }
    return into;
  };

  const components: ComponentTables = new Map();
  for (const [type, table] of host.components) components.set(type, lifted(table));
  const unknownComponents: UnknownComponentTables = new Map();
  for (const [type, table] of host.unknownComponents) unknownComponents.set(type, lifted(table));
  return { components, unknownComponents };
}

/**
 * Lifts entities out of a scene into a prefab.
 *
 * The root's own transform is reset: a prefab describes a shape, not a place.
 * Where an instance sits is the instance's business, and a prefab that
 * remembered where it was first made would drop every copy in the same spot.
 */
export function prefabFromEntities(name: string, scene: SceneDoc, rootId: EntityId): PrefabDoc {
  const ids = [rootId, ...collectDescendants(scene, rootId)];
  const entities = ids
    .map((id) => scene.entities.get(id))
    .filter((entity): entity is EntityDoc => entity !== undefined)
    .map((entity) => structuredClone(entity));

  const root = entities.find((entity) => entity.id === rootId);
  if (!root) throw new Error(`Entity ${rootId} is not in the scene.`);
  root.parent = null;
  root.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

  return createPrefabDoc(name, entities, rootId, componentsFor(scene, ids));
}

/**
 * A prefab as a scene, so it can be edited with the tools a scene has.
 *
 * Prefab Mode is not a second editor: the hierarchy, the inspector, the gizmo
 * and the binder all take a `SceneDoc`, and handing them one is what makes
 * editing a prefab cost nothing to build. Unity's Prefab Mode is the same
 * trick — an isolated stage holding one object.
 *
 * The scene is given an id of its own, which `createEmptyScene` makes: a
 * prefab's id is an asset's and a scene's is not the same kind of id, so the
 * one cannot stand for the other. Nothing reads it — Play and a device launch
 * name the window's scene, and `sceneToPrefab` keeps the prefab's own id.
 */
export function prefabToScene(prefab: PrefabDoc): SceneDoc {
  return {
    ...createEmptyScene(),
    name: prefab.name,
    entities: structuredClone(prefab.entities),
    components: structuredClone(prefab.components),
    unknownComponents: structuredClone(prefab.unknownComponents),
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
  const adopted = scene.rootOrder.slice(1).filter((id) => entities.has(id));
  const rootEntity = entities.get(root);
  if (adopted.length > 0 && rootEntity) {
    for (const id of adopted) {
      const entity = entities.get(id);
      if (entity) entity.parent = root;
    }
    rootEntity.children = [...rootEntity.children, ...adopted];
  }

  return {
    ...original,
    version: PREFAB_FORMAT_VERSION,
    entities,
    ...componentsFor(scene, [...entities.keys()]),
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
export function prefabVariantOf(name: string, baseAssetId: AssetId): PrefabDoc {
  const root = createEntity(name, [createPrefabInstance(baseAssetId)]);
  const prefab = createPrefabDoc(name, [root.entity], root.entity.id);
  setComponentsOf(prefab, root.entity.id, root.components);
  return prefab;
}

/** The prefab a variant is based on, or `null` for an ordinary prefab. */
export function variantBaseOf(prefab: PrefabDoc): AssetId | null {
  const root = prefab.entities.get(prefab.root);
  if (!root) return null;

  // A variant is a single root that is an instance. A prefab that merely
  // *contains* an instance somewhere is a composition, not a variant, and
  // treating the two alike would let "revert to base" wipe a hand-built scene.
  // An instance that names no prefab (`''`) has no base either.
  const only = prefab.entities.size === 1;
  const instance = prefabInstanceOf(prefab, root.id);
  return only && instance && instance.assetId !== '' ? instance.assetId : null;
}

/**
 * The id an instance's copy of a prefab entity gets in the expanded scene: an
 * entity id of its own, `owner/local`, composed of two that are not empty.
 */
export function instancedId(instanceId: EntityId, localId: EntityId): EntityId {
  const id = `${instanceId}${PREFAB_ID_SEPARATOR}${localId}`;
  // It holds the separator, so it is never empty and the check cannot fail: it
  // is what narrows the text to an id, where a cast would claim that it is one.
  if (!isEntityId(id)) throw new Error(`No entity id can be made of "${id}".`);
  return id;
}

/** The instance an expanded id belongs to, or `null` for a scene's own entity. */
export function instanceOwnerOf(id: EntityId): EntityId | null {
  const index = id.indexOf(PREFAB_ID_SEPARATOR);
  if (index === -1) return null;
  const owner = id.slice(0, index);
  return isEntityId(owner) ? owner : null;
}

/**
 * Splits an expanded id into the instance that placed it and the id it has
 * inside that prefab. `null` for an entity the document holds itself, and for
 * an id with an empty half: the owner and every id on the path after it name an
 * entity, and an id is never empty.
 *
 * `local` is the whole path from the instance to the entity — `lampRoot` for
 * something the prefab holds directly, `inner/lampRoot` for something a prefab
 * it places holds — and that is exactly the key an override is stored under.
 * `depth` counts the prefabs crossed, for anything that wants to say so.
 */
export function splitInstancedId(
  id: EntityId,
): { owner: EntityId; local: EntityId; depth: number } | null {
  const index = id.indexOf(PREFAB_ID_SEPARATOR);
  if (index === -1) return null;

  const owner = id.slice(0, index);
  const local = id.slice(index + 1);
  const path = local.split(PREFAB_ID_SEPARATOR);
  if (!isEntityId(owner) || !isEntityId(local) || !path.every((segment) => isEntityId(segment))) {
    return null;
  }
  return { owner, local, depth: path.length };
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
  entityId: EntityId,
): PrefabInstanceComponent | undefined {
  return findComponent(host, entityId, 'prefabInstance');
}

export interface PrefabLibrary {
  get(assetId: AssetId): PrefabDoc | undefined;
}

/**
 * The prefab an instance names, or `undefined` for one that names none (`''`) or
 * one the library does not have: both leave the instance an empty entity.
 */
function prefabNamed(prefabs: PrefabLibrary, assetId: AssetId | ''): PrefabDoc | undefined {
  return assetId === '' ? undefined : prefabs.get(assetId);
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
 *
 * `registries` fill each overridden component through its own type.
 */
export function expandPrefabs(
  registries: CoreRegistries,
  scene: SceneDoc,
  prefabs: PrefabLibrary,
  previous?: ExpandedScene,
): ExpandedScene {
  const instances = findInstances(scene);
  if (instances.length === 0) return { scene, sources: new Map() };

  const entities = new Map(scene.entities);
  // One level deep: what the instances produce is added to the copies, and the
  // scene's tables are left alone. The Maps and the components under each
  // entity stay the very objects the scene holds, because the binder tells what
  // changed by comparing them.
  const components: ComponentTables = new Map();
  for (const [type, table] of scene.components) components.set(type, new Map(table));
  const sources = new Map<EntityId, InstanceSource>();

  const adopt = (produced: Produced): void => {
    for (const entity of produced.entities) entities.set(entity.id, entity);
    mergeTables(components, produced.components);
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
        produced: { entities: [], components: new Map() },
      });
      continue;
    }

    const produced = instantiate(registries, entityId, prefab, component, prefabs, [component.assetId]);
    adopt(produced);
    sources.set(entityId, { component, chain, produced });
  }

  return { scene: { ...scene, entities, components }, sources };
}

export interface ExpandedScene {
  scene: SceneDoc;
  /** What each instance produced, so the next expansion can reuse it. */
  sources: Map<EntityId, InstanceSource>;
}

/** One instance's contents: the entities, and the components they carry. */
interface Produced {
  entities: EntityDoc[];
  components: ComponentTables;
}

/**
 * What `from` holds, filed into `into`: an entity's entry replaces the one `into`
 * has under the same id, as assigning the keys of an object did.
 */
function mergeTables(into: ComponentTables, from: ComponentTables): void {
  for (const [type, table] of from) {
    const target = tableIn(into, type);
    for (const [entityId, held] of table) target.set(entityId, held);
  }
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
  assetId: AssetId | '',
  prefabs: PrefabLibrary,
  seen = new Set<string>(),
): (PrefabDoc | undefined)[] {
  if (seen.has(assetId)) return [];
  seen.add(assetId);

  const prefab = prefabNamed(prefabs, assetId);
  const chain: (PrefabDoc | undefined)[] = [prefab];
  if (!prefab) return chain;

  for (const held of componentsOfType(prefab, 'prefabInstance').values()) {
    for (const component of held.values()) {
      if (component.type === 'prefabInstance') chain.push(...chainOf(component.assetId, prefabs, seen));
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
): { entityId: EntityId; component: PrefabInstanceComponent }[] {
  const found: { entityId: EntityId; component: PrefabInstanceComponent }[] = [];
  for (const entityId of entitiesWith(scene, 'prefabInstance')) {
    // One per entity: a second would produce the same ids as the first and
    // silently overwrite half of it.
    const component = findComponent(scene, entityId, 'prefabInstance');
    if (component && scene.entities.has(entityId)) found.push({ entityId, component });
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
  overrides: Record<EntityId, PrefabOverride>;
  /**
   * Where the layer was written, as the entity it reaches through: `null` for
   * the instance's own, `inner` one prefab in, `a/b` two. An id, which is what
   * an override is keyed by.
   */
  prefix: EntityId | null;
}

/** The key a layer holds an override for `local` under, from where the layer was written. */
function overrideKey(prefix: EntityId | null, local: EntityId): EntityId {
  return prefix === null ? local : instancedId(prefix, local);
}

function instantiate(
  registries: CoreRegistries,
  hostId: EntityId,
  prefab: PrefabDoc,
  component: PrefabInstanceComponent,
  prefabs: PrefabLibrary,
  ancestry: readonly string[],
  inherited: readonly OverrideLayer[] = [],
): Produced {
  const produced: Produced = { entities: [], components: new Map() };

  // Nearest first, so the ones further out are applied last and win: what the
  // scene says about an object beats what the variant that placed it says,
  // which in turn beats the base. Same order of authority as Unity's.
  const layers: OverrideLayer[] = [{ overrides: component.overrides, prefix: null }, ...inherited];

  for (const local of prefab.entities.values()) {
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
    let held = componentsOf(registries, prefab, local.id).map((held) => structuredClone(held));

    for (const layer of layers) {
      const override = layer.overrides[overrideKey(layer.prefix, local.id)];
      if (override) held = applyPrefabOverride(registries, copy, held, override);
    }
    // A component that points at another entity — a script property declared
    // `type: 'entity'` — holds an id local to the prefab, which nothing in the
    // expanded scene answers to. Without this a prefab whose script targets its
    // own turret looked up an id that does not exist, once per instance.
    held = renameEntityReferences(held, (id) =>
      prefab.entities.has(id) ? instancedId(hostId, id) : undefined,
    );

    produced.entities.push(copy);
    for (const item of held) putComponent(produced, copy.id, item);

    // A prefab may place other prefabs. Expanding them here rather than in a
    // second pass keeps one instance's whole production in one block, which is
    // what the reuse check hands back untouched.
    const inner = held.find(
      (item): item is PrefabInstanceComponent => item.type === 'prefabInstance',
    );
    if (!inner) continue;

    const innerPrefab = prefabNamed(prefabs, inner.assetId);
    // A prefab that contains itself, however deep, has no finite expansion.
    if (!innerPrefab || ancestry.includes(inner.assetId)) continue;

    // Every layer gains one path segment rather than being re-keyed, which is
    // what makes this work at any depth without the expansion counting levels.
    const nested = instantiate(
      registries,
      copy.id,
      innerPrefab,
      inner,
      prefabs,
      [...ancestry, inner.assetId],
      layers.map((layer) => ({
        overrides: layer.overrides,
        prefix: overrideKey(layer.prefix, local.id),
      })),
    );
    produced.entities.push(...nested.entities);
    mergeTables(produced.components, nested.components);
  }

  return produced;
}

/**
 * Folds one override into an entity, in place.
 *
 * Exported because "apply overrides to the prefab" has to fold exactly the same
 * way the expansion does — a second implementation would drift, and the two
 * disagreeing is the shape of bug nobody finds until a scene is already wrong.
 */
export function applyPrefabOverride(
  registries: CoreRegistries,
  entity: EntityDoc,
  components: readonly ComponentDoc[],
  override: PrefabOverride,
): ComponentDoc[] {
  if (override.name !== undefined) entity.name = override.name;
  if (override.visible !== undefined) entity.visible = override.visible;
  if (override.transform) {
    entity.transform = { ...entity.transform, ...override.transform } as Transform;
  }

  const named = override.components ?? {};
  // Walked by the components the prefab has, each carrying its id, and the
  // override looked up by that id: an override is never read back for the id it
  // is keyed by. One naming a component the prefab no longer has is not reached,
  // which drops it rather than fails, as Unity does. By id this also covers the
  // case that used to be silent — an index still in range but pointing at a
  // different component, which is what the old scheme wrote onto the wrong one.
  return components.map((component): ComponentDoc => {
    // Own keys only: an id is what a file wrote, and `named['constructor']`
    // would answer with `Object`.
    const properties = Object.hasOwn(named, component.id) ? named[component.id] : undefined;
    if (properties === undefined) return component;
    // An override is stored data too, written against the type as it was, so
    // a type written as a schema decodes what it makes. One that no longer
    // fits — a name where a collider's shape lives, a field the type has lost
    // — is not applied, and stays in the document as written, where an author
    // can see it and fix it; applied, the runtime would build nothing from it.
    // The id is never overridable: it is what this very lookup keys on.
    const decode = registries.components.get(component.type)?.decode;
    if (decode !== undefined) {
      const decoded = decode({ ...component, ...properties, id: component.id }, []);
      return decoded.ok ? decoded.value : component;
    }
    // A type still written by hand is filled again once the override is spread.
    return {
      ...fillComponent(registries, { ...component, ...properties } as ComponentDoc),
      id: component.id,
    };
  });
}

/**
 * A parsed prefab file, as a document of this format: its entity table an
 * object keyed by id, which the document keeps in a Map.
 *
 * A file of any other format is refused before anything else in it is read,
 * as a scene is: nothing converts an older prefab (`PREFAB_FORMAT_VERSION`).
 *
 * It holds `EntityDoc`s, so it is mended as a scene is, by the same walk.
 *
 * @param assetId The id the place that read it knows: its sidecar's, or its key
 *   in a library. A file's own `id` field is what an older build wrote and what
 *   a hand edit may have changed, and the asset's is the one every instance
 *   names, so it wins; the file takes it on its next save. Without one, the
 *   file's own is read, which is the document a window sends before there is a
 *   sidecar to ask.
 */
export function migratePrefab(registries: CoreRegistries, input: unknown, assetId?: AssetId): PrefabDoc {
  if (!isRecord(input)) throw new SceneFormatError('Prefab file is not an object.');
  const version = input['version'];
  if (version !== PREFAB_FORMAT_VERSION) {
    throw new SceneFormatError(formatDiagnostics('Prefab file', versionRefusal(version, PREFAB_FORMAT_VERSION).diagnostics));
  }
  const id = assetId ?? input['id'];
  if (!isAssetId(id)) throw new SceneFormatError('Prefab file has no id of its own.');
  // The entity every other one hangs under. Without an id for it there is no
  // instance to make: each copy would be parented to an entity named "".
  const root = input['root'];
  if (!isEntityId(root)) throw new SceneFormatError('Prefab file has no root entity.');

  // Borrowed wholesale: a prefab is a scene without an environment, and
  // duplicating the walk is how the two would drift apart.
  const asScene = migrateScene(registries, {
    version: SCENE_FORMAT_VERSION,
    id,
    name: input['name'],
    entities: input['entities'],
    components: input['components'],
    rootOrder: [root],
    environment: createEmptyScene().environment,
  });

  return {
    version: PREFAB_FORMAT_VERSION,
    id,
    name: asScene.name,
    entities: asScene.entities,
    components: asScene.components,
    unknownComponents: asScene.unknownComponents,
    root,
  };
}

/**
 * A prefab file's text: key-sorted and indented as a scene's is, so that it
 * reads in a diff.
 */
export function serializePrefab(registries: CoreRegistries, prefab: PrefabDoc): string {
  return stableJson({ ...prefabJsonOf(prefab), components: componentsJsonOf(prefab, registries) });
}

/**
 * A prefab as JSON holds it, for `jsonOf` to write: the bridge in and out, a
 * build's manifest. One `components` block, as a scene's has, and for the
 * reason `sceneJsonOf` gives. The keys are written out in the order a prefab
 * has always had them, which a manifest keeps.
 */
export function prefabJsonOf(prefab: PrefabDoc): Readonly<Record<string, unknown>> {
  return {
    version: prefab.version,
    id: prefab.id,
    name: prefab.name,
    entities: prefab.entities,
    components: componentsJsonOf(prefab),
    root: prefab.root,
  };
}

/** A prefab file's text, read as a document of the current format. See `migratePrefab` for the id. */
export function deserializePrefab(registries: CoreRegistries, json: string, assetId?: AssetId): PrefabDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new SceneFormatError(
      `Prefab file is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return migratePrefab(registries, parsed, assetId);
}

/**
 * The prefabs a build manifest holds, read as documents.
 *
 * The manifest keeps each as the JSON a file holds, keyed by asset id, and a
 * document keeps its entities in a Map, which JSON cannot say: the player reads
 * every one as the editor reads a file, under the id the manifest names it by.
 * A key that is not an id names no prefab.
 */
export function prefabsFromJson(
  registries: CoreRegistries,
  prefabs: Readonly<Record<string, unknown>>,
): Map<AssetId, PrefabDoc> {
  const read = new Map<AssetId, PrefabDoc>();
  for (const [id, prefab] of idMapOf(prefabs, isAssetId)) read.set(id, migratePrefab(registries, prefab, id));
  return read;
}
