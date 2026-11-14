import {
  applyPrefabOverride,
  assertDefined,
  componentsOf,
  createColliderShape,
  createComponent,
  createJoint,
  createLightEntity,
  insertEntity,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  deserializePrefab,
  expandPrefabs,
  findComponent,
  fixedId,
  jsonOf,
  migratePrefab,
  putComponent,
  instanceOwnerOf,
  instancedId,
  prefabFromEntities,
  prefabToScene,
  prefabVariantOf,
  prefabsFromJson,
  sceneToPrefab,
  serializePrefab,
  splitInstancedId,
  stableJson,
  variantBaseOf,
  type AssetId,
  type PrefabDoc,
  type PrefabInstanceComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith, sceneWith } from './fixtures';

/*
 * A prefab is held by reference, so a thousand trees are a thousand lines in
 * the scene rather than a thousand copies. The price is that what you see is
 * derived, and everything downstream — the binder, the physics world, the
 * behaviour registry — must still be handed a plain scene.
 */

const PREFAB_1 = fixedId('asset', 'prefab-1');
const PREFAB_2 = fixedId('asset', 'prefab-2');
const PREFAB_LOOP = fixedId('asset', 'prefab-loop');
const SCRIPT_1 = fixedId('asset', 'script-1');
const TREE = fixedId('asset', 'tree');
const LAMP = fixedId('asset', 'lamp');
const ROOM = fixedId('asset', 'room');

/** A trunk with one branch, so parenting inside the prefab is exercised. */
function treePrefab(): PrefabDoc {
  const trunk = createMeshEntity('cylinder');
  trunk.entity.name = 'Trunk';
  const leaves = createMeshEntity('sphere');
  leaves.entity.name = 'Leaves';
  leaves.entity.parent = trunk.entity.id;
  leaves.entity.transform.position = [0, 2, 0];
  trunk.entity.children = [leaves.entity.id];
  return prefabWith('Tree', [trunk, leaves], trunk.entity.id);
}

/**
 * An entity that places a prefab.
 *
 * `_prefab` is never read: the instance names `PREFAB_1`, the id `library`
 * serves whichever prefab it is given under. It stays so that each call says
 * which prefab it places.
 */
function instanceOf(_prefab: PrefabDoc, at: [number, number, number] = [0, 0, 0]) {
  const host = createEntity('Tree', [
    createPrefabInstance(PREFAB_1),
  ]);
  host.entity.transform.position = at;
  return host;
}

const library = (prefab: PrefabDoc) => ({ get: (id: AssetId) => (id === PREFAB_1 ? prefab : undefined) });

/*
 * A prefab file is the document as text, written as a scene is: key-sorted, so
 * that it diffs. The same text is what the bridge carries, in and out.
 */
describe('a prefab as text', () => {
  it('is written key-sorted, and read back as it was', () => {
    const prefab = treePrefab();

    const text = serializePrefab(prefab);

    expect(text).toBe(stableJson(prefab));
    expect(deserializePrefab(text)).toEqual(prefab);
    expect(serializePrefab(deserializePrefab(text))).toBe(text);
  });

  it('is read through the migration, which fills what an older editor left out', () => {
    const older = jsonOf({ ...treePrefab(), version: 1, components: undefined });

    const read = deserializePrefab(older);

    expect(read.version).toBe(treePrefab().version);
    expect(componentsOf(read, read.root)).toEqual([]);
  });

  it('is refused in words when it is not JSON', () => {
    expect(() => deserializePrefab('{ not json')).toThrow('Prefab file is not valid JSON');
  });

  it('is read under the id it is given, whatever its own file says', () => {
    const text = serializePrefab(treePrefab());

    // A prefab is an asset, and the place that read it knows the asset's id: its
    // sidecar's, or its key in a library.
    expect(deserializePrefab(text, TREE).id).toBe(TREE);
  });

  it('is refused when it has no id of its own and none is given', () => {
    const text = jsonOf({ ...treePrefab(), id: '' });

    expect(() => deserializePrefab(text)).toThrow('no id of its own');
    expect(deserializePrefab(text, TREE).id).toBe(TREE);
  });

  it('is refused when its root is not an id, where every copy would hang under an entity named nothing', () => {
    expect(() => deserializePrefab(jsonOf({ ...treePrefab(), root: '' }))).toThrow('no root entity');
    expect(() => deserializePrefab(jsonOf({ ...treePrefab(), root: 7 }))).toThrow('no root entity');
    expect(() => deserializePrefab(jsonOf({ ...treePrefab(), root: undefined }))).toThrow('no root entity');
  });

  it('holds its entities in a Map once read', () => {
    const read = deserializePrefab(serializePrefab(treePrefab()));

    expect(read.entities).toBeInstanceOf(Map);
    expect(read.entities.size).toBe(2);
  });

  it('is read out of the JSON a manifest holds, each one, as the player reads them', () => {
    // Filed under its own id, as a manifest files each one.
    const tree = { ...treePrefab(), id: TREE };
    // As `build.json` is written, and fetched.
    const fetched = JSON.parse(jsonOf({ [TREE]: tree }));

    const read = prefabsFromJson(fetched);

    expect(read.get(TREE)?.entities).toBeInstanceOf(Map);
    expect(read.get(TREE)).toEqual(tree);
  });

  it('refuses a document that already holds a Map, which no file does', () => {
    // `Object.entries` of a Map is empty: taken for a file's table, it would be
    // a prefab with no entities, and nothing to say so.
    expect(() => migratePrefab(treePrefab())).toThrow('missing its entity table');
  });
});

describe('prefab expansion', () => {
  it('replaces an instance with the prefab contents, parented to it', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab, [5, 0, 5]);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    const produced = [...scene.entities.values()].filter((e) => instanceOwnerOf(e.id) === host.entity.id);
    expect(produced.map((e) => e.name).sort()).toEqual(['Leaves', 'Trunk']);

    // The prefab root hangs under the entity that placed it, so the instance's
    // transform is what puts the copy in the world.
    const trunk = produced.find((e) => e.name === 'Trunk')!;
    expect(trunk.parent).toBe(host.entity.id);
    const leaves = produced.find((e) => e.name === 'Leaves')!;
    expect(leaves.parent).toBe(trunk.id);

    // The host is still there, still carrying the reference.
    expect(scene.entities.get(host.entity.id)?.transform.position).toEqual([5, 0, 5]);
  });

  it('gives each instance its own copies', () => {
    const prefab = treePrefab();
    const a = instanceOf(prefab, [0, 0, 0]);
    const b = instanceOf(prefab, [10, 0, 0]);
    const { scene } = expandPrefabs(sceneWith([a, b]), library(prefab));

    // Two instances, four entities, and no id collides — which is the whole
    // reason instanced ids carry the instance they belong to.
    expect(scene.entities.size).toBe(6);
    expect(scene.entities.get(instancedId(a.entity.id, prefab.root))).toBeDefined();
    expect(scene.entities.get(instancedId(b.entity.id, prefab.root))).toBeDefined();
  });

  it('applies overrides without touching the prefab', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const instance = host.components[0] as PrefabInstanceComponent;
    instance.overrides = {
      [prefab.root]: { name: 'Short trunk', transform: { scale: [1, 0.5, 1] } },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const trunk = assertDefined(scene.entities.get(instancedId(host.entity.id, prefab.root)), 'the placed trunk');

    expect(trunk.name).toBe('Short trunk');
    expect(trunk.transform.scale).toEqual([1, 0.5, 1]);
    // The asset is what every other instance reads; an override must not reach it.
    expect(prefab.entities.get(prefab.root)?.name).toBe('Trunk');
  });

  it('overrides a property of one component and leaves its siblings alone', () => {
    const prefab = treePrefab();
    putComponent(prefab, prefab.root, createComponent('rigidbody'));
    const [mesh, body] = componentsOf(prefab, prefab.root);

    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { [body!.id]: { mass: 12 } } },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const built = assertDefined(scene.entities.get(instancedId(host.entity.id, prefab.root)), 'the placed trunk');

    // By id, so this lands on the rigidbody however the prefab is reordered
    // later. Keyed by position, inserting anything before it moved the override
    // onto the mesh.
    const parts = componentsOf(scene, built.id);
    expect(parts.find((c) => c.id === body!.id)).toMatchObject({ type: 'rigidbody', mass: 12 });
    expect(parts.find((c) => c.id === mesh!.id)?.type).toBe('mesh');
  });

  it('cannot put a name where a collider’s shape lives, from an override written before scene 11', () => {
    const prefab = treePrefab();
    const collider = createComponent('collider');
    putComponent(prefab, prefab.root, collider);

    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { [collider.id]: { shape: 'sphere', radius: 0.4, isSensor: true } } },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const built = componentsOf(scene, instancedId(host.entity.id, prefab.root)).find(
      (c) => c.id === collider.id,
    );

    // Spread alone, the name sat where the union lives and the runtime built
    // nothing. Filled, it is the factory box, the sensor kept, `radius` gone.
    expect(built).toEqual({ ...collider, shape: createColliderShape('box'), isSensor: true });
  });

  it('lets a whole shape in an override win', () => {
    const prefab = treePrefab();
    const collider = createComponent('collider');
    putComponent(prefab, prefab.root, collider);
    const sphere = { kind: 'sphere', radius: 0.4 };

    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { [collider.id]: { shape: sphere } } },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const built = componentsOf(scene, instancedId(host.entity.id, prefab.root)).find(
      (c) => c.id === collider.id,
    );
    // Filled from its own kind, as any stored shape is.
    expect(built).toEqual({ ...collider, shape: { ...createColliderShape('sphere'), radius: 0.4 } });
  });

  it('follows the component it names when the prefab is reordered', () => {
    const prefab = treePrefab();
    putComponent(prefab, prefab.root, createComponent('rigidbody'));
    const body = componentsOf(prefab, prefab.root)[1]!;

    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { [body.id]: { mass: 12 } } },
    };

    // The author adds another component, which used to slide every override of
    // every instance one place along when they were named by position.
    putComponent(prefab, prefab.root, createComponent('audioListener'));

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const built = assertDefined(scene.entities.get(instancedId(host.entity.id, prefab.root)), 'the placed trunk');

    const parts = componentsOf(scene, built.id);
    expect(parts.find((c) => c.id === body.id)).toMatchObject({ mass: 12 });
    expect(parts.find((c) => c.type === 'audioListener')).toBeDefined();
    expect(parts.find((c) => c.type === 'mesh')).not.toMatchObject({ mass: 12 });
  });

  it('drops an override whose component no longer exists', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { [fixedId('component', 'gone-long-ago')]: { castShadow: false } } },
    };

    // The prefab was restructured after the override was recorded. Unity has
    // the same problem and the same answer: forget it rather than fail.
    expect(() => expandPrefabs(sceneWith([host]), library(prefab))).not.toThrow();
  });

  it('leaves an instance whose prefab is missing as an empty entity', () => {
    const host = instanceOf(treePrefab());
    const { scene } = expandPrefabs(sceneWith([host]), { get: () => undefined });

    // Deleting what an author placed because an asset is momentarily
    // unreadable is worse than showing nothing there.
    expect(scene.entities.get(host.entity.id)).toBeDefined();
    expect(scene.entities.size).toBe(1);
  });

  it('hands back the same entity objects when nothing changed', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const scene = sceneWith([host]);

    const first = expandPrefabs(scene, library(prefab));
    const second = expandPrefabs(scene, library(prefab), first);

    // The binder decides what to rebuild by comparing identity, so a fresh copy
    // each time would throw away every geometry and material in the scene.
    const id = instancedId(host.entity.id, prefab.root);
    expect(second.scene.entities.get(id)).toBe(first.scene.entities.get(id));
  });

  it('hands back the same components when nothing changed, which the binder reads by identity too', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const scene = sceneWith([host]);

    const first = expandPrefabs(scene, library(prefab));
    const second = expandPrefabs(scene, library(prefab), first);

    const id = instancedId(host.entity.id, prefab.root);
    const placed = first.scene.components.mesh.get(id);
    expect(placed?.size).toBe(1);
    expect(second.scene.components.mesh.get(id)).toBe(placed);
  });

  it('writes into no table the scene owns', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const own = createMeshEntity('box');
    const scene = sceneWith([host, own]);

    const { scene: expanded } = expandPrefabs(scene, library(prefab));

    // The expansion adds what the instance produced to a copy of each table. Added
    // to the scene's own, it would reach the document the author edits, and the
    // next save would write the placed copies out as if they had been drawn.
    expect(expanded.components.mesh.size).toBe(3);
    expect([...scene.components.mesh.keys()]).toEqual([own.entity.id]);
    expect(expanded.components.mesh).not.toBe(scene.components.mesh);
    // And what the scene holds is the very same inner table, not a copy.
    expect(expanded.components.mesh.get(own.entity.id)).toBe(scene.components.mesh.get(own.entity.id));
  });

  it('puts the lights a prefab places in the expanded scene\'s tables, where the editor looks for one', () => {
    const lamp = createLightEntity('point');
    const prefab = prefabWith('Lamp', [lamp], lamp.entity.id);
    const host = createEntity('Lamp', [createPrefabInstance(PREFAB_1)]);
    const scene = sceneWith([host]);

    const { scene: expanded } = expandPrefabs(scene, library(prefab));

    // A level whose lights all come from instances has none in the document, and
    // the editor's fallback pair is switched off by asking the expanded scene.
    expect(scene.components.light.size).toBe(0);
    expect(expanded.components.light.size).toBe(1);
  });

  it('rebuilds an instance whose overrides changed', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const first = expandPrefabs(sceneWith([host]), library(prefab));

    const edited = structuredClone(host);
    (edited.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { name: 'Edited' },
    };
    const second = expandPrefabs(sceneWith([edited]), library(prefab), first);

    expect(second.scene.entities.get(instancedId(host.entity.id, prefab.root))?.name).toBe('Edited');
  });
});

/*
 * One override folded into one entity, which is what the expansion does for each
 * entity it places and what "apply overrides" does to the prefab: the same
 * function, so that the two cannot disagree about what an override means.
 */
describe('folding one override into an entity', () => {
  /** A copy of a prefab's root, and the mesh and the rigid body it holds. */
  function bodied() {
    const prefab = treePrefab();
    putComponent(prefab, prefab.root, createComponent('rigidbody'));
    const [mesh, body] = componentsOf(prefab, prefab.root);
    return {
      entity: structuredClone(assertDefined(prefab.entities.get(prefab.root), 'the prefab root')),
      mesh: assertDefined(mesh, 'its mesh'),
      body: assertDefined(body, 'its rigid body'),
    };
  }

  it('reaches the component it names, and no other', () => {
    const { entity, mesh, body } = bodied();

    const folded = applyPrefabOverride(entity, [mesh, body], { components: { [body.id]: { mass: 12 } } });

    expect(folded.find((component) => component.id === body.id)).toMatchObject({ type: 'rigidbody', mass: 12 });
    // The very same object: nothing named it.
    expect(folded.find((component) => component.id === mesh.id)).toBe(mesh);
  });

  it('drops an override that names a component the prefab lost', () => {
    const { entity, mesh, body } = bodied();

    const folded = applyPrefabOverride(entity, [mesh, body], {
      components: { [fixedId('component', 'lost-long-ago')]: { mass: 12 } },
    });

    // Not an error and not a new component: the prefab was restructured after
    // the override was recorded, and forgetting it is the answer Unity gives.
    expect(folded).toEqual([mesh, body]);
  });

  it('never lets an override change the id it is looked up by', () => {
    const { entity, mesh, body } = bodied();

    const folded = applyPrefabOverride(entity, [mesh, body], {
      components: { [body.id]: { id: 'somebody-else', mass: 12 } },
    });

    expect(folded.map((component) => component.id)).toEqual([mesh.id, body.id]);
  });
});

/*
 * A prefab that places other prefabs. Unity got here in 2018.3 and it is the
 * first thing anyone asks for: a lamp prefab used inside a room prefab.
 */
describe('nested prefabs', () => {
  /** A room holding one instance of the tree prefab. */
  function roomPrefab(): PrefabDoc {
    const floor = createMeshEntity('plane');
    floor.entity.name = 'Floor';
    const planted = createEntity('Planted tree', [
      createPrefabInstance(PREFAB_1),
    ]);
    planted.entity.parent = floor.entity.id;
    planted.entity.transform.position = [1, 0, 1];
    floor.entity.children = [planted.entity.id];
    return prefabWith('Room', [floor, planted], floor.entity.id);
  }

  const twoPrefabs = (tree: PrefabDoc, room: PrefabDoc) => ({
    get: (id: AssetId) => (id === PREFAB_1 ? tree : id === PREFAB_2 ? room : undefined),
  });

  function roomInstance() {
    return createEntity('Room', [
      createPrefabInstance(PREFAB_2),
    ]);
  }

  it('expands a prefab placed inside another prefab', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = roomInstance();

    const { scene } = expandPrefabs(sceneWith([host]), twoPrefabs(tree, room));
    const names = [...scene.entities.values()].map((entity) => entity.name);

    // Before this, the inner instance was copied as an entity carrying a
    // component nothing ever read, so a room arrived with no tree in it.
    expect(names).toContain('Trunk');
    expect(names).toContain('Leaves');

    // The nesting shows in the id, and the owner stays the instance the author
    // actually placed.
    const nestedHost = instancedId(host.entity.id, [...room.entities.values()].find((e) => e.name === 'Planted tree')!.id);
    expect(scene.entities.get(instancedId(nestedHost, tree.root))?.parent).toBe(nestedHost);
    expect(instanceOwnerOf(instancedId(nestedHost, tree.root))).toBe(host.entity.id);
  });

  it('stops rather than hangs when a prefab contains itself', () => {
    const loop = createEntity('Root', [createPrefabInstance(PREFAB_LOOP)]);
    const selfish = prefabWith('Selfish', [loop], loop.entity.id);

    const host = createEntity('Loop', [
      createPrefabInstance(PREFAB_LOOP),
    ]);

    // Reachable by hand-editing a file, or by a rename that makes two assets
    // agree on an id. An editor that freezes is worse than one that shows less.
    const library = { get: () => selfish };
    expect(() => expandPrefabs(sceneWith([host]), library)).not.toThrow();
    expect(expandPrefabs(sceneWith([host]), library).scene.entities.size).toBeLessThan(5);
  });

  it('rebuilds when the inner prefab changed, not just the outer one', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = roomInstance();
    const scene = sceneWith([host]);

    const first = expandPrefabs(scene, twoPrefabs(tree, room));
    const editedTree = structuredClone(tree);
    [...editedTree.entities.values()].find((e) => e.name === 'Trunk')!.name = 'Thick trunk';
    const second = expandPrefabs(scene, twoPrefabs(editedTree, room), first);

    // The outer instance and its own prefab are untouched objects, so an
    // identity check on those alone would have handed back the stale room.
    const names = [...second.scene.entities.values()].map((entity) => entity.name);
    expect(names).toContain('Thick trunk');
  });

  it('still reuses everything when nothing changed', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = roomInstance();
    const scene = sceneWith([host]);
    const library = twoPrefabs(tree, room);

    const first = expandPrefabs(scene, library);
    const second = expandPrefabs(scene, library, first);

    for (const id of first.scene.entities.keys()) {
      expect(second.scene.entities.get(id)).toBe(first.scene.entities.get(id));
    }
  });

  it('expands one instance per entity, so ids cannot collide', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    host.components.push(createPrefabInstance(PREFAB_1));

    // Two instances on one entity would build the same ids twice and quietly
    // keep half of each.
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    expect(scene.entities.size).toBe(3);
  });
});

describe('references inside a prefab', () => {
  it('points a script property at the copy, not at the id in the asset', () => {
    const turret = createMeshEntity('box');
    turret.entity.name = 'Turret';
    const brain = createEntity('Brain', [
      { ...createComponent('script'), assetId: SCRIPT_1, props: { target: turret.entity.id, speed: 3 } },
    ]);
    turret.entity.children = [brain.entity.id];
    brain.entity.parent = turret.entity.id;
    const prefab = prefabWith('Tank', [turret, brain], turret.entity.id);

    const host = createEntity('Tank', [
      createPrefabInstance(PREFAB_1),
    ]);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    const script = componentsOf(scene, instancedId(host.entity.id, brain.entity.id))[0] as {
      props: Record<string, unknown>;
    };
    // The asset's id names nothing in the expanded scene, so every instance was
    // looking up an entity that does not exist.
    expect(script.props['target']).toBe(instancedId(host.entity.id, turret.entity.id));
    expect(script.props['speed']).toBe(3);
  });

  it('a joint in a prefab names the copy of its Connected Body', () => {
    const frame = createMeshEntity('box');
    frame.entity.name = 'Frame';
    const door = createEntity('Door', [{ ...createJoint(), connectedEntity: frame.entity.id }]);
    frame.entity.children = [door.entity.id];
    door.entity.parent = frame.entity.id;
    const prefab = prefabWith('Doorway', [frame, door], frame.entity.id);

    const host = createEntity('Doorway', [createPrefabInstance(PREFAB_1)]);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    const joint = findComponent(scene, instancedId(host.entity.id, door.entity.id), 'joint');
    expect(joint?.connectedEntity).toBe(instancedId(host.entity.id, frame.entity.id));
  });

  it('leaves values that only look like ids alone', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    // Names, colours and asset ids are strings too; only an id the prefab
    // itself holds is a reference to one of its entities.
    const trunk = assertDefined(scene.entities.get(instancedId(host.entity.id, prefab.root)), 'the placed trunk');
    expect(trunk.name).toBe('Trunk');
    const mesh = componentsOf(scene, trunk.id)[0] as { material: { color: string } };
    expect(mesh.material.color).toMatch(/^#/);
  });
});

describe('reading an expanded id', () => {
  it('tells a scene entity from one a prefab produced', () => {
    // The predicate the whole editor keys on: whether an edit is a document
    // change or an override, whether Delete applies, whether the hierarchy
    // tints the row.
    expect(splitInstancedId(fixedId('entity', 'abc123'))).toBeNull();
    expect(splitInstancedId(fixedId('entity', 'host/local'))).toEqual({
      owner: fixedId('entity', 'host'),
      local: fixedId('entity', 'local'),
      depth: 1,
    });
  });

  it('counts the prefabs crossed, so a nested entity is not mistaken for an editable one', () => {
    // Depth 2 was placed by a prefab, not by the scene: there is no component in
    // the document to hang an override on, and pretending otherwise would write
    // one that expansion silently ignores.
    expect(splitInstancedId(fixedId('entity', 'host/inner/leaf'))).toEqual({
      owner: fixedId('entity', 'host'),
      local: fixedId('entity', 'inner/leaf'),
      depth: 2,
    });
  });

  it('is nothing for an id with an empty half, which names no entity on either side', () => {
    // The owner, the local path and each prefab crossed on the way are entity
    // ids, and an id is never empty. Split at the first separator, `/x` would
    // have been an instance with no owner.
    expect(splitInstancedId(fixedId('entity', '/x'))).toBeNull();
    expect(splitInstancedId(fixedId('entity', 'host/'))).toBeNull();
    expect(splitInstancedId(fixedId('entity', 'host//leaf'))).toBeNull();
    expect(splitInstancedId(fixedId('entity', 'host/inner/'))).toBeNull();
    expect(instanceOwnerOf(fixedId('entity', '/x'))).toBeNull();
  });
});

describe('creating a prefab from a scene', () => {
  it('takes the sub-tree and resets the root transform', () => {
    const trunk = createMeshEntity('cylinder');
    trunk.entity.transform.position = [7, 0, 3];
    const leaves = createMeshEntity('sphere');
    leaves.entity.parent = trunk.entity.id;
    trunk.entity.children = [leaves.entity.id];

    const prefab = prefabFromEntities('Tree', sceneWith([trunk, leaves]), trunk.entity.id);

    expect(prefab.entities.size).toBe(2);
    expect(prefab.root).toBe(trunk.entity.id);
    // A prefab describes a shape, not a place: one that remembered where it was
    // first made would drop every copy in the same spot.
    expect(prefab.entities.get(trunk.entity.id)?.transform.position).toEqual([0, 0, 0]);
    expect(prefab.entities.get(trunk.entity.id)?.parent).toBeNull();
  });

  it('carries the components of the entities it takes, and nobody else\'s', () => {
    const trunk = createMeshEntity('cylinder');
    const leaves = createMeshEntity('sphere');
    leaves.entity.parent = trunk.entity.id;
    trunk.entity.children = [leaves.entity.id];
    const outsider = createMeshEntity('box');
    const scene = sceneWith([trunk, leaves, outsider]);

    const prefab = prefabFromEntities('Tree', scene, trunk.entity.id);

    expect([...prefab.components.mesh.keys()].sort()).toEqual([trunk.entity.id, leaves.entity.id].sort());
    // Copies, so editing the prefab does not edit the scene it was made from.
    expect(prefab.components.mesh.get(trunk.entity.id)).not.toBe(scene.components.mesh.get(trunk.entity.id));
    expect(prefab.components.mesh.get(trunk.entity.id)).toEqual(scene.components.mesh.get(trunk.entity.id));
  });
});

/*
 * A variant is a prefab whose root is an instance of another. Nothing in the
 * expansion knows the word — which is the point: the behaviour everyone wants
 * from variants is what nesting already does.
 */
describe('prefab variants', () => {
  it('is one entity holding an instance of the base', () => {
    const base = treePrefab();
    const variant = prefabVariantOf('Autumn Tree', PREFAB_1);

    expect(variant.entities.size).toBe(1);
    expect(variantBaseOf(variant)).toBe(PREFAB_1);
    // An ordinary prefab is not one, and must not be offered "revert to base".
    expect(variantBaseOf(base)).toBeNull();
  });

  it('draws the base, and follows a change to it', () => {
    const base = treePrefab();
    const variant = prefabVariantOf('Autumn Tree', PREFAB_1);
    const host = createEntity('Tree', [
      createPrefabInstance(PREFAB_2),
    ]);
    const library = {
      get: (id: AssetId) => (id === PREFAB_1 ? base : id === PREFAB_2 ? variant : undefined),
    };

    const names = () =>
      [...expandPrefabs(sceneWith([host]), library).scene.entities.values()].map((e) => e.name);

    expect(names()).toContain('Trunk');

    // Editing the base is the whole reason to make a variant rather than a
    // copy: every variant of it changes too.
    [...base.entities.values()].find((entity) => entity.name === 'Trunk')!.name = 'Bare trunk';
    expect(names()).toContain('Bare trunk');
  });

  it('keeps its own overrides while following everything else', () => {
    const base = treePrefab();
    const variant = prefabVariantOf('Short Tree', PREFAB_1);
    // The override a variant carries lives on its root's instance component —
    // set in Prefab Mode, because a scene cannot reach two prefabs deep.
    const rootInstance = componentsOf(variant, variant.root)[0] as PrefabInstanceComponent;
    rootInstance.overrides = { [base.root]: { transform: { scale: [1, 0.4, 1] } } };

    const host = createEntity('Tree', [
      createPrefabInstance(PREFAB_2),
    ]);
    const { scene } = expandPrefabs(sceneWith([host]), {
      get: (id: AssetId) => (id === PREFAB_1 ? base : id === PREFAB_2 ? variant : undefined),
    });

    const trunk = [...scene.entities.values()].find((entity) => entity.name === 'Trunk')!;
    expect(trunk.transform.scale).toEqual([1, 0.4, 1]);
    // And the base is untouched, so every other variant of it is too.
    expect(base.entities.get(base.root)?.transform.scale).toEqual([1, 1, 1]);
  });
});

describe('editing a prefab as a scene', () => {
  it('round-trips through a scene without changing its identity', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);

    expect(asScene.rootOrder).toEqual([prefab.root]);
    expect(asScene.entities.size).toBe(2);

    const back = sceneToPrefab(asScene, prefab);
    // Same id and name: the file is rewritten, not replaced. A new id would
    // orphan every instance in every scene that names this one.
    expect(back.id).toBe(prefab.id);
    expect(back.name).toBe(prefab.name);
    expect(back.root).toBe(prefab.root);
    expect([...back.entities.keys()].sort()).toEqual([...prefab.entities.keys()].sort());
    expect([...back.components.mesh.keys()].sort()).toEqual([...prefab.components.mesh.keys()].sort());
  });

  it('shares no table with the prefab it was lifted from', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);

    // Prefab Mode edits the scene; the asset on disk and in the library is what
    // every instance expands from, and is replaced only when the session ends.
    asScene.components.mesh.clear();

    expect(prefab.components.mesh.size).toBe(2);
  });

  it('carries an entity added while editing', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);
    const added = createMeshEntity('box');
    added.entity.parent = prefab.root;
    insertEntity(asScene, added, prefab.root);

    // Adding a child is exactly what Apply cannot do from an instance, and the
    // reason Prefab Mode has to exist at all.
    expect(sceneToPrefab(asScene, prefab).entities.size).toBe(3);
  });
});

/*
 * Overriding something a prefab placed, from the scene that placed the prefab.
 *
 * There is no component in the scene for the room's own placement of the lamp —
 * that lives in the room asset — so the override goes on the scene's instance,
 * keyed by the path to it. Unity's `m_Modifications` reach through nesting the
 * same way.
 */
describe('overriding through nesting', () => {
  function lampPrefab(): PrefabDoc {
    const lamp = createMeshEntity('sphere');
    lamp.entity.name = 'Lamp';
    return prefabWith('Lamp', [lamp], lamp.entity.id);
  }

  /** A room whose only child is an instance of the lamp. */
  function roomPrefab(lampAssetId: AssetId): PrefabDoc {
    const floor = createMeshEntity('plane');
    floor.entity.name = 'Floor';
    const placed = createEntity('Placed lamp', [
      createPrefabInstance(lampAssetId),
    ]);
    placed.entity.parent = floor.entity.id;
    floor.entity.children = [placed.entity.id];
    return prefabWith('Room', [floor, placed], floor.entity.id);
  }

  function setup() {
    const lamp = lampPrefab();
    const room = roomPrefab(LAMP);
    const host = createEntity('Room', [
      createPrefabInstance(ROOM),
    ]);
    const library = {
      get: (id: AssetId) => (id === LAMP ? lamp : id === ROOM ? room : undefined),
    };
    const placed = [...room.entities.values()].find((e) => e.name === 'Placed lamp')!;
    return { lamp, room, host, library, placed };
  }

  it('reaches an entity two prefabs deep, keyed by its path', () => {
    const { lamp, host, library, placed } = setup();
    const instance = host.components[0] as PrefabInstanceComponent;
    instance.overrides = {
      [`${placed.id}${'/'}${lamp.root}`]: { name: 'Broken lamp' },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library);
    const names = [...scene.entities.values()].map((entity) => entity.name);

    // Before this the edit was refused: the scene had nowhere to put it, and
    // the only way in was to change the room asset for every room.
    expect(names).toContain('Broken lamp');
    expect(names).not.toContain('Lamp');
  });

  it('lets the scene win over what the prefab that placed it says', () => {
    const { lamp, host, library, placed } = setup();
    const { room } = setup();
    void room;

    // The room says the lamp it places is dim; this room says it is off.
    const roomDoc = library.get(ROOM)!;
    const placement = componentsOf(roomDoc, placed.id)[0] as PrefabInstanceComponent;
    placement.overrides = { [lamp.root]: { name: 'Dim lamp', visible: true } };

    (host.components[0] as PrefabInstanceComponent).overrides = {
      [`${placed.id}/${lamp.root}`]: { visible: false },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library);
    const built = [...scene.entities.values()].find((entity) => entity.name === 'Dim lamp')!;

    // Nearest layer first, outermost last: the room's rename survives because
    // the scene said nothing about the name, and the scene's `visible` wins
    // because it is further out.
    expect(built.visible).toBe(false);
  });

  it('leaves other rooms alone', () => {
    const { lamp, host, library, placed } = setup();
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [`${placed.id}/${lamp.root}`]: { name: 'Broken lamp' },
    };
    const other = createEntity('Room', [
      createPrefabInstance(ROOM),
    ]);

    const { scene } = expandPrefabs(sceneWith([host, other]), library);
    const names = [...scene.entities.values()].map((entity) => entity.name);

    // The whole point of an override rather than an edit to the asset.
    expect(names).toContain('Broken lamp');
    expect(names).toContain('Lamp');
  });
});

describe('leaving prefab mode', () => {
  it('adopts anything added beside the root', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);

    // `Add ▸ Cube` in Prefab Mode puts the cube beside the root, because a
    // scene has many roots and a prefab has one. Written out as it stood, the
    // cube would be an entity nothing parents and nothing ever draws.
    const added = createMeshEntity('box');
    insertEntity(asScene, added);

    const back = sceneToPrefab(asScene, prefab);
    expect(back.entities.get(added.entity.id)?.parent).toBe(prefab.root);
    expect(back.entities.get(prefab.root)?.children).toContain(added.entity.id);
    expect(back.entities.size).toBe(3);
  });

  it('leaves a prefab that already had one root alone', () => {
    const prefab = treePrefab();
    const back = sceneToPrefab(prefabToScene(prefab), prefab);

    expect(back.entities.get(prefab.root)?.children).toEqual(
      prefab.entities.get(prefab.root)?.children,
    );
  });
});
