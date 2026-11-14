import {
  COMPONENT_TYPES,
  SCENE_FORMAT_VERSION,
  assertDefined,
  cloneSubtree,
  componentsOf,
  createColliderShape,
  createComponent,
  createEntity,
  createMeshEntity,
  deleteComponent,
  deserializeScene,
  emptyComponentTables,
  entitiesWith,
  findComponent,
  findComponentById,
  findComponents,
  fixedId,
  hasComponent,
  insertEntity,
  putComponent,
  removeSubtree,
  renameEntityReferences,
  serializeScene,
  validateHierarchy,
  type ColliderComponent,
  type ComponentId,
  type EntityId,
  type LightComponent,
  type MeshComponent,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { copyComponentTables } from '../src/scene/components';
import { sceneWith } from './fixtures';

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
  putComponent(scene, litId, createComponent('light'));
  return { scene, ids: cubes.map((cube) => cube.entity.id), litId };
}

describe('the tables themselves', () => {
  it('are a Map of Maps for each type, of the component that type holds', () => {
    // The three levels are type, entity, component id. A Map is copied and
    // frozen by immer in one step, where a record of ten thousand keys is
    // frozen key by key.
    expectTypeOf<SceneDoc['components']['mesh']>().toEqualTypeOf<Map<EntityId, Map<ComponentId, MeshComponent>>>();
    expectTypeOf<SceneDoc['components']['light']>().toEqualTypeOf<Map<EntityId, Map<ComponentId, LightComponent>>>();
    expectTypeOf<SceneDoc['components']['collider']>().toEqualTypeOf<
      Map<EntityId, Map<ComponentId, ColliderComponent>>
    >();
  });

  it('start empty, one for every type this build knows', () => {
    const tables = emptyComponentTables();

    // Written out type by type, which the compiler checks against the mapped
    // type, and the list of types is written out beside it: this is what says
    // the two name the same ones.
    expect(Object.keys(tables).sort()).toEqual([...COMPONENT_TYPES].sort());
    for (const type of COMPONENT_TYPES) {
      expect(tables[type], type).toBeInstanceOf(Map);
      expect(tables[type].size, type).toBe(0);
    }
  });

  it('are copied one level deep, for every type', () => {
    const { scene } = lit(2);

    const copy = copyComponentTables(scene.components);

    // What an expansion adds goes into the copy; the Maps and the components
    // under each entity stay the very objects the scene holds.
    expect(Object.keys(copy).sort()).toEqual([...COMPONENT_TYPES].sort());
    for (const type of COMPONENT_TYPES) {
      expect(copy[type], type).not.toBe(scene.components[type]);
      expect(copy[type].size, type).toBe(scene.components[type].size);
      for (const [entityId, held] of scene.components[type]) expect(copy[type].get(entityId), type).toBe(held);
    }
  });

  it('hold an entity\'s components of a type in a Map keyed by their ids', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const mesh = assertDefined(findComponent(scene, cube.entity.id, 'mesh'), 'the cube\'s mesh');

    const held = scene.components.mesh.get(cube.entity.id);

    expect(held).toBeInstanceOf(Map);
    expect(held?.get(mesh.id)).toBe(mesh);
  });
});

describe('listing the components of one type on an entity', () => {
  it('answers every one of them, in the order they were added', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = createComponent('collider');
    const second = createComponent('collider');
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
    putComponent(scene, cube.entity.id, createComponent('collider'));
    putComponent(scene, cube.entity.id, createComponent('collider'));

    for (const collider of findComponents(scene, cube.entity.id, 'collider')) {
      deleteComponent(scene, cube.entity.id, collider.id);
    }

    expect(findComponents(scene, cube.entity.id, 'collider')).toEqual([]);
    expect(scene.components.collider.has(cube.entity.id)).toBe(false);
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
    const first = createComponent('collider');
    const second = { ...createComponent('collider'), shape: createColliderShape('sphere') };
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    deleteComponent(scene, cube.entity.id, first.id);

    // This is why the third level is the id and not a slot: a slot is a
    // position, and removing the first would slide the second onto it — the
    // override defect reduced to a narrower case but intact.
    const left = componentsOf(scene, cube.entity.id).filter((c) => c.type === 'collider');
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(second.id);
    expect((left[0] as ColliderComponent).shape.kind).toBe('sphere');
    expect(findComponentById(scene, cube.entity.id, second.id)).toBe(second);
  });

  it('survives a round trip through the file', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = createComponent('script');
    const second = createComponent('script');
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    const loaded = componentsOf(deserializeScene(serializeScene(scene)), cube.entity.id);

    // Registry order across types still holds: the mesh comes before both
    // scripts. Within one type it does not, and `componentsOf` says so — a
    // document read back from a file lists two scripts in id order, because
    // `serializeScene` sorts keys, and ids are random. Asserting the order they
    // were added in passed only when the two happened to sort that way, which
    // was about half of every run.
    expect(loaded[0]!.id).toBe(assertDefined(componentsOf(scene, cube.entity.id)[0], 'the first component').id);
    expect(loaded.slice(1).map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
  });
});

describe('the order an entity lists its components in', () => {
  it('follows the registry, whatever order they were added in', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    putComponent(scene, cube.entity.id, createComponent('script'));
    putComponent(scene, cube.entity.id, createComponent('light'));
    putComponent(scene, cube.entity.id, createComponent('rigidbody'));

    // The array carried the order the author added things in; a table by type
    // has none, so the registry's order stands in. It is the same for every
    // entity, which the old one was not.
    expect(componentsOf(scene, cube.entity.id).map((c) => c.type)).toEqual([
      'mesh',
      'light',
      'rigidbody',
      'script',
    ]);
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
    expect(componentsOf(scene, cube.entity.id)).toHaveLength(1);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('is copied with them, ids and all', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const source = assertDefined(componentsOf(scene, cube.entity.id)[0], 'the cube\'s component');

    const copyId = assertDefined(cloneSubtree(scene, cube.entity.id, null), 'the copy of the cube');
    const copy = assertDefined(componentsOf(scene, copyId)[0], 'the copy\'s component');

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
    const script = { ...createComponent('script'), props: { target: door, empty: '', count: 3 } };
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

describe('a document written before the tables existed', () => {
  /** Format 3: components in an array on each entity, with ids. */
  function formatThree(): string {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const raw = JSON.parse(serializeScene(scene)) as Record<string, unknown>;
    raw['version'] = 3;
    delete raw['components'];
    const entities = raw['entities'] as Record<string, Record<string, unknown>>;
    assertDefined(entities[cube.entity.id], 'the cube in the file')['components'] = [
      { id: 'c1', type: 'mesh', geometry: { kind: 'box' }, material: { color: '#ffffff' } },
      { id: 'c2', type: 'collider', shape: 'sphere' },
      { id: 'c3', type: 'collider', shape: 'box' },
    ];
    return JSON.stringify(raw);
  }

  it('moves every component into the tables, in the order it had', () => {
    const scene = deserializeScene(formatThree());
    const entityId = [...scene.entities.keys()][0]!;

    expect(componentsOf(scene, entityId).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    // Told apart by id: a shape stored as a name reads as the factory's box now.
    expect(findComponent(scene, entityId, 'collider')?.id).toBe('c2');
    expect(scene.version).toBe(SCENE_FORMAT_VERSION);
  });

  it('leaves nothing behind on the entity', () => {
    const scene = deserializeScene(formatThree());
    const entity = [...scene.entities.values()][0] as unknown as Record<string, unknown>;

    // Kept, the stale array would be re-imported on the next load and would
    // quietly overwrite every edit made since. An editor that reads format 3
    // refuses a format 4 document anyway, so keeping it helps nobody.
    expect(entity['components']).toBeUndefined();
  });

  it('is left exactly as it is the second time through', () => {
    const once = deserializeScene(formatThree());
    const twice = deserializeScene(serializeScene(once));

    // The pass runs at the boundary and has to be idempotent, or a scene saved
    // and reopened has its components migrated against an array that is no
    // longer there.
    //
    // Compared as the *file* rather than with a plain `JSON.stringify`: keys
    // are sorted on the way out now, so a freshly migrated document and the
    // same document read back differ in key order and in nothing else — and
    // plain stringify calls that a difference. See `stableJson`.
    expect(serializeScene(twice)).toBe(serializeScene(once));
  });
});
