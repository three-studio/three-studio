import {
  SCENE_FORMAT_VERSION,
  cloneSubtree,
  componentsOf,
  createComponent,
  createEntity,
  createMeshEntity,
  deleteComponent,
  deserializeScene,
  entitiesWith,
  findComponent,
  findComponentById,
  hasComponent,
  insertEntity,
  putComponent,
  removeSubtree,
  serializeScene,
  validateHierarchy,
  type ColliderComponent,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';

/*
 * Components live in `scene.components`, by type then by entity then by their
 * own id — ADR-16.
 *
 * Three things are worth pinning here, and only the first is the headline. The
 * query is O(1) rather than a walk of every entity. The identity of a component
 * is its id, so two of one type on one entity survive each other. And an entity
 * that goes takes its components with it, which is the failure the storage
 * change introduces and nothing else would notice: a component keyed by an
 * entity that is not there is unreachable, still serialised, and still counted.
 */

/** A scene of `count` cubes, one of which also carries a light. */
function lit(count: number): { scene: SceneDoc; ids: string[]; litId: string } {
  const cubes = [...Array(count)].map(() => createMeshEntity('box'));
  const scene = sceneWith(cubes);
  const litId = cubes[0]!.entity.id;
  putComponent(scene, litId, createComponent('light'));
  return { scene, ids: cubes.map((cube) => cube.entity.id), litId };
}

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
    const light = findComponent(scene, litId, 'light')!;

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
    const second = { ...createComponent('collider'), shape: 'sphere' as const };
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    deleteComponent(scene, cube.entity.id, first.id);

    // This is why the third level is the id and not a slot: a slot is a
    // position, and removing the first would slide the second onto it — B10
    // reduced to a narrower case but intact. See ADR-9 and ADR-16.
    const left = componentsOf(scene, cube.entity.id).filter((c) => c.type === 'collider');
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(second.id);
    expect((left[0] as ColliderComponent).shape).toBe('sphere');
    expect(findComponentById(scene, cube.entity.id, second.id)).toBe(second);
  });

  it('survives a round trip through the file', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    const first = createComponent('script');
    const second = createComponent('script');
    putComponent(scene, cube.entity.id, first);
    putComponent(scene, cube.entity.id, second);

    const loaded = deserializeScene(serializeScene(scene));
    expect(componentsOf(loaded, cube.entity.id).map((c) => c.id)).toEqual([
      componentsOf(scene, cube.entity.id)[0]!.id,
      first.id,
      second.id,
    ]);
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
    // written to disk on the next save — the same family of silent leak as B1.
    expect(entitiesWith(scene, 'mesh')).toEqual([]);
    expect(validateHierarchy(scene)).toEqual([]);
  });

  it('is reported by the hierarchy check when one is orphaned anyway', () => {
    const cube = createMeshEntity('box');
    const scene = sceneWith([cube]);
    delete scene.entities[cube.entity.id];
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
    const source = componentsOf(scene, cube.entity.id)[0]!;

    const copyId = cloneSubtree(scene, cube.entity.id, null)!;
    const copy = componentsOf(scene, copyId)[0]!;

    // Keeping the id is deliberate: it is unique within its entity, which is
    // exactly what the per-entity table encodes, and a prefab override names a
    // component by it.
    expect(copy.id).toBe(source.id);
    expect(copy).not.toBe(source);
    expect(validateHierarchy(scene)).toEqual([]);
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
    entities[cube.entity.id]!['components'] = [
      { id: 'c1', type: 'mesh', geometry: { kind: 'box' }, material: { color: '#ffffff' } },
      { id: 'c2', type: 'collider', shape: 'sphere' },
      { id: 'c3', type: 'collider', shape: 'box' },
    ];
    return JSON.stringify(raw);
  }

  it('moves every component into the tables, in the order it had', () => {
    const scene = deserializeScene(formatThree());
    const entityId = Object.keys(scene.entities)[0]!;

    expect(componentsOf(scene, entityId).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(findComponent(scene, entityId, 'collider')?.shape).toBe('sphere');
    expect(scene.version).toBe(SCENE_FORMAT_VERSION);
  });

  it('leaves nothing behind on the entity', () => {
    const scene = deserializeScene(formatThree());
    const entity = Object.values(scene.entities)[0] as unknown as Record<string, unknown>;

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
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
