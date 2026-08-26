import {
  componentsOf,
  createComponent,
  insertEntity,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  expandPrefabs,
  putComponent,
  instanceOwnerOf,
  instancedId,
  prefabFromEntities,
  prefabToScene,
  prefabVariantOf,
  sceneToPrefab,
  splitInstancedId,
  variantBaseOf,
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

function instanceOf(prefab: PrefabDoc, at: [number, number, number] = [0, 0, 0]) {
  const host = createEntity('Tree', [
    createPrefabInstance('prefab-1'),
  ]);
  host.entity.transform.position = at;
  return host;
}

const library = (prefab: PrefabDoc) => ({ get: (id: string) => (id === 'prefab-1' ? prefab : undefined) });

describe('prefab expansion', () => {
  it('replaces an instance with the prefab contents, parented to it', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab, [5, 0, 5]);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    const produced = Object.values(scene.entities).filter((e) => instanceOwnerOf(e.id) === host.entity.id);
    expect(produced.map((e) => e.name).sort()).toEqual(['Leaves', 'Trunk']);

    // The prefab root hangs under the entity that placed it, so the instance's
    // transform is what puts the copy in the world.
    const trunk = produced.find((e) => e.name === 'Trunk')!;
    expect(trunk.parent).toBe(host.entity.id);
    const leaves = produced.find((e) => e.name === 'Leaves')!;
    expect(leaves.parent).toBe(trunk.id);

    // The host is still there, still carrying the reference.
    expect(scene.entities[host.entity.id]?.transform.position).toEqual([5, 0, 5]);
  });

  it('gives each instance its own copies', () => {
    const prefab = treePrefab();
    const a = instanceOf(prefab, [0, 0, 0]);
    const b = instanceOf(prefab, [10, 0, 0]);
    const { scene } = expandPrefabs(sceneWith([a, b]), library(prefab));

    // Two instances, four entities, and no id collides — which is the whole
    // reason instanced ids carry the instance they belong to.
    expect(Object.keys(scene.entities)).toHaveLength(6);
    expect(scene.entities[instancedId(a.entity.id, prefab.root)]).toBeDefined();
    expect(scene.entities[instancedId(b.entity.id, prefab.root)]).toBeDefined();
  });

  it('applies overrides without touching the prefab', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const instance = host.components[0] as PrefabInstanceComponent;
    instance.overrides = {
      [prefab.root]: { name: 'Short trunk', transform: { scale: [1, 0.5, 1] } },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    const trunk = scene.entities[instancedId(host.entity.id, prefab.root)]!;

    expect(trunk.name).toBe('Short trunk');
    expect(trunk.transform.scale).toEqual([1, 0.5, 1]);
    // The asset is what every other instance reads; an override must not reach it.
    expect(prefab.entities[prefab.root]?.name).toBe('Trunk');
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
    const built = scene.entities[instancedId(host.entity.id, prefab.root)]!;

    // By id, so this lands on the rigidbody however the prefab is reordered
    // later. Keyed by position, inserting anything before it moved the override
    // onto the mesh — which is B10.
    const parts = componentsOf(scene, built.id);
    expect(parts.find((c) => c.id === body!.id)).toMatchObject({ type: 'rigidbody', mass: 12 });
    expect(parts.find((c) => c.id === mesh!.id)?.type).toBe('mesh');
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
    const built = scene.entities[instancedId(host.entity.id, prefab.root)]!;

    const parts = componentsOf(scene, built.id);
    expect(parts.find((c) => c.id === body.id)).toMatchObject({ mass: 12 });
    expect(parts.find((c) => c.type === 'audioListener')).toBeDefined();
    expect(parts.find((c) => c.type === 'mesh')).not.toMatchObject({ mass: 12 });
  });

  it('drops an override whose component no longer exists', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    (host.components[0] as PrefabInstanceComponent).overrides = {
      [prefab.root]: { components: { 'gone-long-ago': { castShadow: false } } },
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
    expect(scene.entities[host.entity.id]).toBeDefined();
    expect(Object.keys(scene.entities)).toHaveLength(1);
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
    expect(second.scene.entities[id]).toBe(first.scene.entities[id]);
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

    expect(second.scene.entities[instancedId(host.entity.id, prefab.root)]?.name).toBe('Edited');
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
      createPrefabInstance('prefab-1'),
    ]);
    planted.entity.parent = floor.entity.id;
    planted.entity.transform.position = [1, 0, 1];
    floor.entity.children = [planted.entity.id];
    return prefabWith('Room', [floor, planted], floor.entity.id);
  }

  const twoPrefabs = (tree: PrefabDoc, room: PrefabDoc) => ({
    get: (id: string) => (id === 'prefab-1' ? tree : id === 'prefab-2' ? room : undefined),
  });

  function roomInstance() {
    return createEntity('Room', [
      createPrefabInstance('prefab-2'),
    ]);
  }

  it('expands a prefab placed inside another prefab', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = roomInstance();

    const { scene } = expandPrefabs(sceneWith([host]), twoPrefabs(tree, room));
    const names = Object.values(scene.entities).map((entity) => entity.name);

    // Before this, the inner instance was copied as an entity carrying a
    // component nothing ever read, so a room arrived with no tree in it.
    expect(names).toContain('Trunk');
    expect(names).toContain('Leaves');

    // The nesting shows in the id, and the owner stays the instance the author
    // actually placed.
    const nestedHost = instancedId(host.entity.id, Object.values(room.entities).find((e) => e.name === 'Planted tree')!.id);
    expect(scene.entities[instancedId(nestedHost, tree.root)]?.parent).toBe(nestedHost);
    expect(instanceOwnerOf(instancedId(nestedHost, tree.root))).toBe(host.entity.id);
  });

  it('stops rather than hangs when a prefab contains itself', () => {
    const loop = createEntity('Root', [createPrefabInstance('prefab-loop')]);
    const selfish = prefabWith('Selfish', [loop], loop.entity.id);

    const host = createEntity('Loop', [
      createPrefabInstance('prefab-loop'),
    ]);

    // Reachable by hand-editing a file, or by a rename that makes two assets
    // agree on an id. An editor that freezes is worse than one that shows less.
    const library = { get: () => selfish };
    expect(() => expandPrefabs(sceneWith([host]), library)).not.toThrow();
    expect(Object.keys(expandPrefabs(sceneWith([host]), library).scene.entities).length).toBeLessThan(5);
  });

  it('rebuilds when the inner prefab changed, not just the outer one', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = roomInstance();
    const scene = sceneWith([host]);

    const first = expandPrefabs(scene, twoPrefabs(tree, room));
    const editedTree = structuredClone(tree);
    Object.values(editedTree.entities).find((e) => e.name === 'Trunk')!.name = 'Thick trunk';
    const second = expandPrefabs(scene, twoPrefabs(editedTree, room), first);

    // The outer instance and its own prefab are untouched objects, so an
    // identity check on those alone would have handed back the stale room.
    const names = Object.values(second.scene.entities).map((entity) => entity.name);
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

    for (const id of Object.keys(first.scene.entities)) {
      expect(second.scene.entities[id]).toBe(first.scene.entities[id]);
    }
  });

  it('expands one instance per entity, so ids cannot collide', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    host.components.push(createPrefabInstance('prefab-1'));

    // Two instances on one entity would build the same ids twice and quietly
    // keep half of each.
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));
    expect(Object.keys(scene.entities)).toHaveLength(3);
  });
});

describe('references inside a prefab', () => {
  it('points a script property at the copy, not at the id in the asset', () => {
    const turret = createMeshEntity('box');
    turret.entity.name = 'Turret';
    const brain = createEntity('Brain', [
      { ...createComponent('script'), assetId: 'script-1', props: { target: turret.entity.id, speed: 3 } },
    ]);
    turret.entity.children = [brain.entity.id];
    brain.entity.parent = turret.entity.id;
    const prefab = prefabWith('Tank', [turret, brain], turret.entity.id);

    const host = createEntity('Tank', [
      createPrefabInstance('prefab-1'),
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

  it('leaves values that only look like ids alone', () => {
    const prefab = treePrefab();
    const host = instanceOf(prefab);
    const { scene } = expandPrefabs(sceneWith([host]), library(prefab));

    // Names, colours and asset ids are strings too; only an id the prefab
    // itself holds is a reference to one of its entities.
    const trunk = scene.entities[instancedId(host.entity.id, prefab.root)]!;
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
    expect(splitInstancedId('abc123')).toBeNull();
    expect(splitInstancedId('host/local')).toEqual({ owner: 'host', local: 'local', depth: 1 });
  });

  it('counts the prefabs crossed, so a nested entity is not mistaken for an editable one', () => {
    // Depth 2 was placed by a prefab, not by the scene: there is no component in
    // the document to hang an override on, and pretending otherwise would write
    // one that expansion silently ignores.
    expect(splitInstancedId('host/inner/leaf')).toEqual({
      owner: 'host',
      local: 'inner/leaf',
      depth: 2,
    });
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

    expect(Object.keys(prefab.entities)).toHaveLength(2);
    expect(prefab.root).toBe(trunk.entity.id);
    // A prefab describes a shape, not a place: one that remembered where it was
    // first made would drop every copy in the same spot.
    expect(prefab.entities[trunk.entity.id]?.transform.position).toEqual([0, 0, 0]);
    expect(prefab.entities[trunk.entity.id]?.parent).toBeNull();
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
    const variant = prefabVariantOf('Autumn Tree', base, 'prefab-1');

    expect(Object.keys(variant.entities)).toHaveLength(1);
    expect(variantBaseOf(variant)).toBe('prefab-1');
    // An ordinary prefab is not one, and must not be offered "revert to base".
    expect(variantBaseOf(base)).toBeNull();
  });

  it('draws the base, and follows a change to it', () => {
    const base = treePrefab();
    const variant = prefabVariantOf('Autumn Tree', base, 'prefab-1');
    const host = createEntity('Tree', [
      createPrefabInstance('prefab-2'),
    ]);
    const library = {
      get: (id: string) => (id === 'prefab-1' ? base : id === 'prefab-2' ? variant : undefined),
    };

    const names = () =>
      Object.values(expandPrefabs(sceneWith([host]), library).scene.entities).map((e) => e.name);

    expect(names()).toContain('Trunk');

    // Editing the base is the whole reason to make a variant rather than a
    // copy: every variant of it changes too.
    Object.values(base.entities).find((entity) => entity.name === 'Trunk')!.name = 'Bare trunk';
    expect(names()).toContain('Bare trunk');
  });

  it('keeps its own overrides while following everything else', () => {
    const base = treePrefab();
    const variant = prefabVariantOf('Short Tree', base, 'prefab-1');
    // The override a variant carries lives on its root's instance component —
    // set in Prefab Mode, because a scene cannot reach two prefabs deep.
    const rootInstance = componentsOf(variant, variant.root)[0] as PrefabInstanceComponent;
    rootInstance.overrides = { [base.root]: { transform: { scale: [1, 0.4, 1] } } };

    const host = createEntity('Tree', [
      createPrefabInstance('prefab-2'),
    ]);
    const { scene } = expandPrefabs(sceneWith([host]), {
      get: (id: string) => (id === 'prefab-1' ? base : id === 'prefab-2' ? variant : undefined),
    });

    const trunk = Object.values(scene.entities).find((entity) => entity.name === 'Trunk')!;
    expect(trunk.transform.scale).toEqual([1, 0.4, 1]);
    // And the base is untouched, so every other variant of it is too.
    expect(base.entities[base.root]?.transform.scale).toEqual([1, 1, 1]);
  });
});

describe('editing a prefab as a scene', () => {
  it('round-trips through a scene without changing its identity', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);

    expect(asScene.rootOrder).toEqual([prefab.root]);
    expect(Object.keys(asScene.entities)).toHaveLength(2);

    const back = sceneToPrefab(asScene, prefab);
    // Same id and name: the file is rewritten, not replaced. A new id would
    // orphan every instance in every scene that names this one.
    expect(back.id).toBe(prefab.id);
    expect(back.name).toBe(prefab.name);
    expect(back.root).toBe(prefab.root);
    expect(Object.keys(back.entities).sort()).toEqual(Object.keys(prefab.entities).sort());
  });

  it('carries an entity added while editing', () => {
    const prefab = treePrefab();
    const asScene = prefabToScene(prefab);
    const added = createMeshEntity('box');
    added.entity.parent = prefab.root;
    insertEntity(asScene, added, prefab.root);

    // Adding a child is exactly what Apply cannot do from an instance, and the
    // reason Prefab Mode has to exist at all.
    expect(Object.keys(sceneToPrefab(asScene, prefab).entities)).toHaveLength(3);
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
  function roomPrefab(lampAssetId: string): PrefabDoc {
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
    const room = roomPrefab('lamp');
    const host = createEntity('Room', [
      createPrefabInstance('room'),
    ]);
    const library = {
      get: (id: string) => (id === 'lamp' ? lamp : id === 'room' ? room : undefined),
    };
    const placed = Object.values(room.entities).find((e) => e.name === 'Placed lamp')!;
    return { lamp, room, host, library, placed };
  }

  it('reaches an entity two prefabs deep, keyed by its path', () => {
    const { lamp, host, library, placed } = setup();
    const instance = host.components[0] as PrefabInstanceComponent;
    instance.overrides = {
      [`${placed.id}${'/'}${lamp.root}`]: { name: 'Broken lamp' },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library);
    const names = Object.values(scene.entities).map((entity) => entity.name);

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
    const roomDoc = library.get('room')!;
    const placement = componentsOf(roomDoc, placed.id)[0] as PrefabInstanceComponent;
    placement.overrides = { [lamp.root]: { name: 'Dim lamp', visible: true } };

    (host.components[0] as PrefabInstanceComponent).overrides = {
      [`${placed.id}/${lamp.root}`]: { visible: false },
    };

    const { scene } = expandPrefabs(sceneWith([host]), library);
    const built = Object.values(scene.entities).find((entity) => entity.name === 'Dim lamp')!;

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
      createPrefabInstance('room'),
    ]);

    const { scene } = expandPrefabs(sceneWith([host, other]), library);
    const names = Object.values(scene.entities).map((entity) => entity.name);

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
    expect(back.entities[added.entity.id]?.parent).toBe(prefab.root);
    expect(back.entities[prefab.root]?.children).toContain(added.entity.id);
    expect(Object.keys(back.entities)).toHaveLength(3);
  });

  it('leaves a prefab that already had one root alone', () => {
    const prefab = treePrefab();
    const back = sceneToPrefab(prefabToScene(prefab), prefab);

    expect(back.entities[prefab.root]?.children).toEqual(
      prefab.entities[prefab.root]?.children,
    );
  });
});
