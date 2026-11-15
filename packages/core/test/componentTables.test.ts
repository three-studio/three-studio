import {
  assertDefined,
  cloneSubtree,
  componentsOf,
  componentsOfType,
  colliderType,
  createColliderShape,
  createCoreRegistries,
  createEmptyScene,
  createEntity,
  createLight,
  createMeshEntity,
  createPrefabInstance,
  rigidbodyType,
  createScript,
  deleteComponent,
  deserializePrefab,
  deserializeScene,
  entitiesWith,
  expandPrefabs,
  findComponent,
  findComponentById,
  findComponents,
  fixedId,
  hasComponent,
  insertEntity,
  instancedId,
  jsonOf,
  prefabFromEntities,
  prefabJsonOf,
  prefabToScene,
  putComponent,
  removeSubtree,
  renameEntityReferences,
  sceneJsonOf,
  sceneToPrefab,
  serializePrefab,
  serializeScene,
  setComponentsOf,
  stableJson,
  unknownComponentTypes,
  validateHierarchy,
  type ColliderComponent,
  type ComponentDoc,
  type ComponentId,
  type ComponentTypeId,
  type EntityId,
  type LightComponent,
  type MeshComponent,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * Components live in `scene.components`, by type then by entity then by their
 * own id.
 *
 * Three things are worth pinning here, and only the first is the headline. The
 * query is O(1) rather than a walk of every entity. The identity of a component
 * is its id, so two of one type on one entity survive each other. And an entity
 * that goes takes its components with it, which is the failure the storage
 * change introduces and nothing else would notice: a component keyed by an
 * entity that is not there is unreachable, still serialised, and still counted.
 */

/** A scene of `count` cubes, one of which also carries a light. */
function lit(count: number): { scene: SceneDoc; ids: EntityId[]; litId: EntityId } {
  const cubes = [...Array(count)].map(() => createMeshEntity('box'));
  const scene = sceneWith(cubes);
  const litId = cubes[0]!.entity.id;
  putComponent(scene, litId, createLight('point'));
  return { scene, ids: cubes.map((cube) => cube.entity.id), litId };
}

describe('the tables themselves', () => {
  it('are a Map by type, of Maps by entity, of Maps by component id', () => {
    // A Map is copied and frozen by immer in one step, where a record of ten
    // thousand keys is frozen key by key. The outer one is keyed by type id and
    // open: no list of types stands behind it.
    expectTypeOf<SceneDoc['components']>().toEqualTypeOf<
      Map<ComponentTypeId, Map<EntityId, Map<ComponentId, ComponentDoc>>>
    >();
  });

  it('hold a table only for a type the document has held a component of', () => {
    const scene = sceneWith([]);
    expect(scene.components.size).toBe(0);

    insertEntity(scene, createMeshEntity('box'));

    expect([...scene.components.keys()]).toEqual(['mesh']);
  });

  it('keep a table once made, emptied or not', () => {
    const { scene, litId } = lit(1);
    const light = assertDefined(findComponent(scene, litId, 'light'), 'the light');

    deleteComponent(scene, litId, light.id);

    // Taking the table out would be a change no entity names, which a reader of
    // the document could only answer by reading all of it again.
    expect(scene.components.get('light')).toBeInstanceOf(Map);
    expect(scene.components.get('light')?.size).toBe(0);
  });

  it('read a type the document holds no table of as one that holds nothing', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    expect(componentsOfType(scene, 'light').size).toBe(0);
    expect(entitiesWith(scene, 'light')).toEqual([]);
    expect(hasComponent(scene, cube.entity.id, 'light')).toBe(false);
    expect(findComponent(scene, cube.entity.id, 'light')).toBeUndefined();
    expect(findComponents(scene, cube.entity.id, 'light')).toEqual([]);
  });

  it('give a component read by its type the type that id names', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    // The tables hold any component. What is read by a type is narrowed by the
    // `type` it was filed under, so no caller has to claim what it found.
    expectTypeOf(findComponent(scene, cube.entity.id, 'mesh')).toEqualTypeOf<MeshComponent | undefined>();
    expectTypeOf(findComponent(scene, cube.entity.id, 'light')).toEqualTypeOf<LightComponent | undefined>();
    expectTypeOf(findComponents(scene, cube.entity.id, 'collider')).toEqualTypeOf<ColliderComponent[]>();
    expect(findComponent(scene, cube.entity.id, 'mesh')?.geometry.kind).toBe('box');
  });

  it('hold an entity\'s components of a type in a Map keyed by their ids', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const mesh = assertDefined(findComponent(scene, cube.entity.id, 'mesh'), 'the cube\'s mesh');

    const held = componentsOfType(scene, 'mesh').get(cube.entity.id);

    expect(held).toBeInstanceOf(Map);
    expect(held?.get(mesh.id)).toBe(mesh);
  });
});

describe('listing the components of one type on an entity', () => {
  it('answers every one of them, in the order they were added', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = colliderType.create();
    const second = colliderType.create();
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    expect(findComponents(scene, cube.entity.id, 'collider')).toEqual([first, second]);
  });

  it('answers none for a type the entity does not carry, and for an entity that is not there', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);

    expect(findComponents(scene, cube.entity.id, 'light')).toEqual([]);
    expect(findComponents(scene, fixedId('entity', 'nobody'), 'mesh')).toEqual([]);
  });

  it('answers a copy of the list, so a caller may delete while it walks', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    putComponent(scene, cube.entity.id, colliderType.create());
    putComponent(scene, cube.entity.id, colliderType.create());

    for (const collider of findComponents(scene, cube.entity.id, 'collider')) {
      deleteComponent(scene, cube.entity.id, collider.id);
    }

    expect(findComponents(scene, cube.entity.id, 'collider')).toEqual([]);
    expect(componentsOfType(scene, 'collider').has(cube.entity.id)).toBe(false);
  });
});

describe('asking which entities carry a type', () => {
  it('answers from the table rather than from the entities', () => {
    const { scene, litId } = lit(50);

    // The nine scans this replaced walked every entity and every component of
    // each. What the table costs is the number of *answers*.
    expect(entitiesWith(scene, 'light')).toEqual([litId]);
    expect(entitiesWith(scene, 'mesh')).toHaveLength(50);
    expect(entitiesWith(scene, 'camera')).toEqual([]);
  });

  it('forgets an entity once its last component of a type goes', () => {
    const { scene, litId } = lit(2);
    const light = assertDefined(findComponent(scene, litId, 'light'), 'the light');

    deleteComponent(scene, litId, light.id);

    // The entry has to go with the component, or `entitiesWith` reports an
    // entity whose record is an empty object and every caller has to re-check.
    expect(entitiesWith(scene, 'light')).toEqual([]);
    expect(hasComponent(scene, litId, 'light')).toBe(false);
    expect(hasComponent(scene, litId, 'mesh')).toBe(true);
  });
});

describe('two components of one type on one entity', () => {
  it('keeps the second one intact when the first is removed', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = colliderType.create();
    const second = { ...colliderType.create(), shape: createColliderShape('sphere') };
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    deleteComponent(scene, cube.entity.id, first.id);

    // This is why the third level is the id and not a slot: a slot is a
    // position, and removing the first would slide the second onto it — the
    // override defect reduced to a narrower case but intact.
    const left = componentsOf(registries, scene, cube.entity.id).filter((c) => c.type === 'collider');
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(second.id);
    expect((left[0] as ColliderComponent).shape.kind).toBe('sphere');
    expect(findComponentById(scene, cube.entity.id, second.id)).toBe(second);
  });

  it('survives a round trip through the file', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = createScript();
    const second = createScript();
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    const loaded = componentsOf(registries, deserializeScene(registries, serializeScene(registries, scene)), cube.entity.id);

    // Registry order across types still holds: the mesh comes before both
    // scripts. Within one type it does not, and `componentsOf` says so — a
    // document read back from a file lists two scripts in id order, because
    // `serializeScene` sorts keys, and ids are random. Asserting the order they
    // were added in passed only when the two happened to sort that way, which
    // was about half of every run.
    expect(loaded[0]!.id).toBe(assertDefined(componentsOf(registries, scene, cube.entity.id)[0], 'the first component').id);
    expect(loaded.slice(1).map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
  });
});

describe('the order an entity lists its components in', () => {
  /** A cube carrying four types, added in an order that is no registry's. */
  function crowded(): { scene: SceneDoc; id: EntityId } {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    putComponent(scene, cube.entity.id, createScript());
    putComponent(scene, cube.entity.id, createLight('point'));
    putComponent(scene, cube.entity.id, rigidbodyType.create());
    return { scene, id: cube.entity.id };
  }

  it('follows the registry, whatever order they were added in', () => {
    const { scene, id } = crowded();

    // The array carried the order the author added things in; a table by type
    // has none, so the registry's order stands in. It is the same for every
    // entity, which the old one was not.
    expect(componentsOf(registries, scene, id).map((c) => c.type)).toEqual(['mesh', 'light', 'rigidbody', 'script']);
  });

  it('is the order of the registry it is handed, and of no list kept beside it', () => {
    const { scene, id } = crowded();
    const reversed = createCoreRegistries();
    for (const definition of [...registries.components.values()].reverse()) reversed.components.register(definition);

    expect(componentsOf(reversed, scene, id).map((c) => c.type)).toEqual(['script', 'rigidbody', 'light', 'mesh']);
  });
});

describe('a component of a type this build does not define', () => {
  const FLICKER = fixedId('componentType', 'plugin.flicker');
  const F1 = fixedId('component', 'f1');
  /** As a plugin's file would hold it. Nothing here knows any of its fields. */
  const flicker = { id: 'f1', type: 'plugin.flicker', rate: 3, curve: { keys: [0, 1] } };

  /** A scene file whose one cube also carries a flicker, and the cube's id. */
  function written(): { json: string; cubeId: EntityId } {
    const cube = createMeshEntity('box');
    const file = JSON.parse(serializeScene(registries, sceneWith([cube])));
    file.components['plugin.flicker'] = { [cube.entity.id]: { f1: flicker } };
    return { json: stableJson(file), cubeId: cube.entity.id };
  }

  function opened(): { scene: SceneDoc; cubeId: EntityId } {
    const { json, cubeId } = written();
    return { scene: deserializeScene(registries, json), cubeId };
  }

  it('is kept exactly as found, apart from the components this build can read', () => {
    const { scene, cubeId } = opened();

    expect(scene.unknownComponents.get(FLICKER)?.get(cubeId)?.get(F1)).toEqual(flicker);
    // And handed to no reader of a component: there it would be read as a type
    // it is not.
    expect(scene.components.has(FLICKER)).toBe(false);
    expect(componentsOf(registries, scene, cubeId).map((c) => c.type)).toEqual(['mesh']);
    expect(findComponentById(scene, cubeId, F1)).toBeUndefined();
  });

  it('is saved back byte for byte', () => {
    const { json } = written();

    expect(serializeScene(registries, deserializeScene(registries, json))).toBe(json);
  });

  it('crosses a message in the one block a file holds it in', () => {
    const { scene, cubeId } = opened();

    const message = JSON.parse(jsonOf(sceneJsonOf(scene)));

    // Written raw, the document would put it under a key no reader reads, and
    // the first save that crossed a process would lose it.
    expect(message.components['plugin.flicker']).toEqual({ [cubeId]: { f1: flicker } });
    expect(message).not.toHaveProperty('unknownComponents');
    expect(deserializeScene(registries, JSON.stringify(message)).unknownComponents).toEqual(scene.unknownComponents);
  });

  it('is named among the types the document holds and this build does not know', () => {
    const { scene } = opened();

    expect(unknownComponentTypes(scene)).toEqual(['plugin.flicker']);
    expect(unknownComponentTypes(sceneWith([createMeshEntity('box')]))).toEqual([]);
  });

  it('goes with its entity, and leaves no line behind in the file', () => {
    const { scene, cubeId } = opened();

    removeSubtree(scene, cubeId);

    // Left behind it would be unreachable and still written out, for a type
    // nothing here could ever draw or delete.
    expect(scene.unknownComponents.get(FLICKER)?.has(cubeId)).toBe(false);
    expect(unknownComponentTypes(scene)).toEqual([]);
    expect(JSON.parse(serializeScene(registries, scene)).components).not.toHaveProperty('plugin.flicker');
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('is copied with its entity', () => {
    const { scene, cubeId } = opened();

    const copyId = assertDefined(cloneSubtree(scene, cubeId, null), 'the copy of the cube');

    const copy = scene.unknownComponents.get(FLICKER)?.get(copyId)?.get(F1);
    expect(copy).toEqual(flicker);
    expect(copy).not.toBe(scene.unknownComponents.get(FLICKER)?.get(cubeId)?.get(F1));
  });

  it('stays when what its entity carries of the known types is replaced', () => {
    const { scene, cubeId } = opened();

    setComponentsOf(scene, cubeId, [createLight('point')]);

    expect(componentsOf(registries, scene, cubeId).map((c) => c.type)).toEqual(['light']);
    expect(scene.unknownComponents.get(FLICKER)?.get(cubeId)?.get(F1)).toEqual(flicker);
  });

  it('is lifted into a prefab with its entity, through the prefab\'s file and back into a scene', () => {
    const { scene, cubeId } = opened();

    const prefab = prefabFromEntities('Lamp', scene, cubeId);
    const text = serializePrefab(registries, prefab);
    const reread = deserializePrefab(registries, text, prefab.id);

    expect(prefab.unknownComponents.get(FLICKER)?.get(cubeId)?.get(F1)).toEqual(flicker);
    expect(JSON.parse(text).components['plugin.flicker']).toEqual({ [cubeId]: { f1: flicker } });
    expect(reread.unknownComponents).toEqual(prefab.unknownComponents);
    expect(JSON.parse(jsonOf(prefabJsonOf(prefab))).components['plugin.flicker']).toEqual({ [cubeId]: { f1: flicker } });
    // Prefab Mode edits the prefab as a scene, and writes it back.
    const edited = prefabToScene(reread);
    expect(edited.unknownComponents).toEqual(prefab.unknownComponents);
    expect(sceneToPrefab(edited, reread).unknownComponents).toEqual(prefab.unknownComponents);
  });

  it('is not carried onto the entities an instance places', () => {
    const { scene, cubeId } = opened();
    const prefab = prefabFromEntities('Lamp', scene, cubeId);
    const host = createEntity('Lamp', [createPrefabInstance(prefab.id)]);
    const level = sceneWith([host]);

    const { scene: expanded } = expandPrefabs(registries, level, new Map([[prefab.id, prefab]]));

    // The expansion is what is drawn, and nothing draws a type nobody defines.
    expect(expanded.entities.has(instancedId(host.entity.id, cubeId))).toBe(true);
    expect(expanded.unknownComponents.size).toBe(0);
  });
});

describe('a scene\'s file', () => {
  it('lists a table for every registered type, the ones it holds nothing of too, and nothing else', () => {
    const file = JSON.parse(serializeScene(registries, createEmptyScene()));

    // As a file has always been written: it does not gain a line the first
    // time a light is added, and where the document keeps the types this build
    // does not define is no part of it.
    expect(file.components).toEqual(Object.fromEntries(registries.components.values().map(({ id }) => [id, {}])));
    expect(Object.keys(file)).toEqual(['components', 'entities', 'environment', 'id', 'name', 'rootOrder', 'version']);
  });
});

describe('an entity that comes and goes', () => {
  it('takes its components with it', () => {
    const parent = createEntity('Parent');
    const child = createMeshEntity('box');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    const scene = sceneWith([parent, child]);

    removeSubtree(scene, parent.entity.id);

    // A component left behind is reachable from nothing, drawn by nothing, and
    // written to disk on the next save — the same family of silent leak.
    expect(entitiesWith(scene, 'mesh')).toEqual([]);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('is reported by the hierarchy check when one is orphaned anyway', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    scene.entities.delete(cube.entity.id);
    scene.rootOrder = [];

    // The DEV assertion after every mutation. Nothing else would say a word.
    expect(validateHierarchy(scene)).toEqual([
      `components.mesh holds "${cube.entity.id}", which is not in the entity table`,
    ]);
  });

  it('arrives with them, through the one door that inserts', () => {
    const scene = sceneWith([]);
    const cube = createMeshEntity('box');

    expect(insertEntity(scene, cube)).toBe(true);
    expect(componentsOf(registries, scene, cube.entity.id)).toHaveLength(1);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('is copied with them, ids and all', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const source = assertDefined(componentsOf(registries, scene, cube.entity.id)[0], 'the cube\'s component');

    const copyId = assertDefined(cloneSubtree(scene, cube.entity.id, null), 'the copy of the cube');
    const copy = assertDefined(componentsOf(registries, scene, copyId)[0], 'the copy\'s component');

    // Keeping the id is deliberate: it is unique within its entity, which is
    // exactly what the per-entity table encodes, and a prefab override names a
    // component by it.
    expect(copy.id).toBe(source.id);
    expect(copy).not.toBe(source);
    expect(validateHierarchy(scene)).toEqual([]);
  });
});

describe('the references a component holds to other entities', () => {
  it('asks about what is an id and nothing else, and renames what it is told to', () => {
    const door = fixedId('entity', 'door');
    const copy = fixedId('entity', 'door-copy');
    const script = { ...createScript(), props: { target: door, empty: '', count: 3 } };
    const asked: string[] = [];

    const [renamed] = renameEntityReferences([script], (id) => {
      asked.push(id);
      return id === door ? copy : undefined;
    });

    // An empty string names no entity, so `rename` is never handed one.
    expect(asked).toContain(door);
    expect(asked).not.toContain('');
    expect(renamed).toMatchObject({ props: { target: copy, empty: '', count: 3 } });
  });
});
