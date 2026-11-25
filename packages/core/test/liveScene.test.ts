import {
  assertDefined,
  collectDescendants,
  createComponentId,
  createEntity,
  createMeshEntity,
  createPrefabInstance,
  createSceneId,
  deleteComponent,
  expandPrefabs,
  findComponent,
  fixedId,
  insertEntity,
  instancedId,
  jointType,
  liveScene,
  mergeScene,
  placePrefab,
  putComponent,
  removeSubtree,
  validateHierarchy,
  type AssetId,
  type EntityId,
  type PrefabDoc,
  type Transform,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith, sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * A running world edits its scene: a game spawns, destroys and instantiates
 * while it plays. The scene it was made from is the editor's document, which
 * immer has frozen and which Stop goes back to, so the world edits a copy of
 * its own — and that copy holds the expansion, which a game destroys and
 * parents under as it does anything else.
 */

const TREE = fixedId('asset', 'tree');
const ROOM = fixedId('asset', 'room');

/** A trunk with its leaves under it. */
function treePrefab(): PrefabDoc {
  const trunk = createMeshEntity('cylinder');
  trunk.entity.name = 'Trunk';
  const leaves = createMeshEntity('sphere');
  leaves.entity.name = 'Leaves';
  leaves.entity.parent = trunk.entity.id;
  trunk.entity.children = [leaves.entity.id];
  return { ...prefabWith('Tree', [trunk, leaves], trunk.entity.id), id: TREE };
}

/** A floor with a door hinged on it and a tree planted on it: a reference to rename, and a prefab inside a prefab. */
function roomPrefab(): { prefab: PrefabDoc; floor: EntityId; door: EntityId; planted: EntityId } {
  const floor = createMeshEntity('plane');
  floor.entity.name = 'Floor';
  const door = createEntity('Door', [{ ...jointType.create(), connectedEntity: floor.entity.id }]);
  const planted = createEntity('Planted tree', [createPrefabInstance(TREE)]);
  for (const child of [door, planted]) child.entity.parent = floor.entity.id;
  floor.entity.children = [door.entity.id, planted.entity.id];
  return {
    prefab: { ...prefabWith('Room', [floor, door, planted], floor.entity.id), id: ROOM },
    floor: floor.entity.id,
    door: door.entity.id,
    planted: planted.entity.id,
  };
}

const libraryOf = (...prefabs: readonly PrefabDoc[]) => ({
  get: (id: AssetId) => prefabs.find((prefab) => prefab.id === id),
});

describe("a running world's scene", () => {
  it('owns every record, list, table and Map an edit writes, and shares the components', () => {
    const parent = createMeshEntity('box');
    const child = createMeshEntity('sphere');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    const scene = sceneWith([parent, child]);

    const live = liveScene(scene);

    expect(live.entities).not.toBe(scene.entities);
    for (const [id, entity] of scene.entities) {
      expect(live.entities.get(id)).toEqual(entity);
      expect(live.entities.get(id)).not.toBe(entity);
      expect(live.entities.get(id)?.children).not.toBe(entity.children);
    }
    expect(live.rootOrder).toEqual(scene.rootOrder);
    expect(live.rootOrder).not.toBe(scene.rootOrder);
    expect(live.components).not.toBe(scene.components);
    for (const [type, table] of scene.components) {
      expect(live.components.get(type)).not.toBe(table);
      for (const [entityId, held] of table) {
        expect(live.components.get(type)?.get(entityId)).not.toBe(held);
        // An edit replaces a component and never writes into one, so the copy
        // holds the very objects the scene does.
        for (const [componentId, component] of held) {
          expect(live.components.get(type)?.get(entityId)?.get(componentId)).toBe(component);
        }
      }
    }
  });

  it('leaves the scene it was made from as it was, whatever the graph does to the copy', () => {
    const parent = createMeshEntity('box');
    const child = createMeshEntity('sphere');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    const scene = sceneWith([parent, child]);
    // What a module this build lacks put on the child: removing the child drops it too.
    scene.unknownComponents.set(fixedId('componentType', 'sparkle'), {
      version: 1,
      components: new Map([[child.entity.id, new Map([[fixedId('component', 'sparkle-1'), { glow: 2 }]])]]),
    });
    const mesh = assertDefined(findComponent(scene, parent.entity.id, 'mesh'), "the parent's mesh");
    const before = structuredClone(scene);

    const live = liveScene(scene);
    const spawned = createMeshEntity('cylinder');
    expect(insertEntity(live, spawned, parent.entity.id)).toBe(true);
    putComponent(live, child.entity.id, { ...jointType.create(), connectedEntity: parent.entity.id });
    expect(deleteComponent(live, parent.entity.id, mesh.id)).toBe(true);
    expect(removeSubtree(live, child.entity.id)).toEqual([child.entity.id]);

    expect(scene).toEqual(before);
    expect(live.entities.get(parent.entity.id)?.children).toEqual([spawned.entity.id]);
  });
});

describe("a running world's expansion", () => {
  /** A scene placing the room once, expanded, and the running world's copy of it. */
  function placedRoom() {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = createEntity('Room', [createPrefabInstance(ROOM)]);
    const expanded = expandPrefabs(registries, sceneWith([host]), libraryOf(tree, room.prefab)).scene;
    return {
      tree,
      host: host.entity.id,
      floor: instancedId(host.entity.id, room.floor),
      planted: instancedId(host.entity.id, room.planted),
      expanded,
      live: liveScene(expanded),
    };
  }

  it('lists the contents of each placement under it, those of a placement inside one too', () => {
    const { tree, host, floor, planted, expanded, live } = placedRoom();

    expect(live.entities.get(host)?.children).toEqual([floor]);
    expect(live.entities.get(planted)?.children).toEqual([instancedId(planted, tree.root)]);
    expect(validateHierarchy(live)).toEqual([]);
    // Listed in the copy's records only: the expansion's are the document's, frozen in the editor.
    expect(expanded.entities.get(host)?.children).toEqual([]);
  });

  it('removes a placement with everything it placed, and their components', () => {
    const { host, live } = placedRoom();
    const placed = [host, ...collectDescendants(live, host)];
    expect(placed).toHaveLength(6);

    expect(removeSubtree(live, host)).toEqual(placed);

    expect(live.entities.size).toBe(0);
    for (const table of live.components.values()) expect([...table.keys()]).toEqual([]);
  });

  it('removes an entity a prefab placed, with what is under it, and leaves its placement', () => {
    const { host, floor, live } = placedRoom();

    expect(removeSubtree(live, floor)).toHaveLength(5);

    expect([...live.entities.keys()]).toEqual([host]);
    expect(live.entities.get(host)?.children).toEqual([]);
    expect(validateHierarchy(live)).toEqual([]);
  });

  it('links an entity under one a prefab placed, and refuses one named as a prefab names what it places', () => {
    const { host, floor, live } = placedRoom();
    const lamp = createEntity('Lamp');
    const impostor = createEntity('Impostor');
    impostor.entity.id = instancedId(host, fixedId('entity', 'lamp'));

    expect(insertEntity(live, lamp, floor)).toBe(true);
    expect(insertEntity(live, impostor, null)).toBe(false);

    expect(live.entities.get(lamp.entity.id)?.parent).toBe(floor);
    expect(live.entities.get(floor)?.children.at(-1)).toBe(lamp.entity.id);
    expect(live.entities.has(impostor.entity.id)).toBe(false);
    expect(validateHierarchy(live)).toEqual([]);
  });
});

describe('placing a prefab into a running scene', () => {
  const transform: Transform = { position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [2, 2, 2] };

  it('places it under its parent, at its transform, named as the prefab, its contents under it', () => {
    const room = roomPrefab();
    const stage = createEntity('Stage');
    const live = liveScene(sceneWith([stage]));

    const placed = assertDefined(
      placePrefab(registries, live, libraryOf(treePrefab(), room.prefab), {
        prefab: ROOM,
        parent: stage.entity.id,
        transform,
      }),
      'the placement',
    );

    const placement = live.entities.get(placed.root);
    expect(placement?.name).toBe('Room');
    expect(placement?.parent).toBe(stage.entity.id);
    expect(placement?.transform).toEqual(transform);
    expect(placement?.transform).not.toBe(transform);
    expect(live.entities.get(stage.entity.id)?.children).toEqual([placed.root]);
    expect(findComponent(live, placed.root, 'prefabInstance')?.assetId).toBe(ROOM);
    expect(placement?.children).toEqual([instancedId(placed.root, room.floor)]);
    expect(new Set(placed.entities)).toEqual(new Set([placed.root, ...collectDescendants(live, placed.root)]));
    expect(placed.entities).toHaveLength(6);
    expect(validateHierarchy(live)).toEqual([]);
  });

  it('places what the expansion of the same placement produces: ids, components, references, nested prefabs', () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const stage = createEntity('Stage');
    const library = libraryOf(tree, room.prefab);
    const live = liveScene(sceneWith([stage]));

    const { root } = assertDefined(
      placePrefab(registries, live, library, { prefab: ROOM, parent: stage.entity.id, transform }),
      'the placement',
    );

    // The same placement as a document holds it — the entity and its instance,
    // nothing under it —, expanded, then made a running world's scene.
    const placement = assertDefined(live.entities.get(root), 'the placement');
    const instance = assertDefined(findComponent(live, root, 'prefabInstance'), 'its instance');
    const document = sceneWith([
      { entity: { ...stage.entity, children: [root] }, components: [] },
      { entity: { ...placement, children: [] }, components: [instance] },
    ]);
    const expected = liveScene(expandPrefabs(registries, document, library).scene);

    expect(live.entities).toEqual(expected.entities);
    expect(live.components).toEqual(expected.components);
    expect(findComponent(live, instancedId(root, room.door), 'joint')?.connectedEntity).toBe(
      instancedId(root, room.floor),
    );
    expect(live.entities.has(instancedId(instancedId(root, room.planted), tree.root))).toBe(true);
  });

  it('places nothing for a prefab the library lacks, or under a parent the scene does not hold', () => {
    const room = roomPrefab();
    const live = liveScene(sceneWith([createEntity('Stage')]));
    const before = structuredClone(live);
    const request = { prefab: ROOM, parent: null, transform };

    expect(placePrefab(registries, live, libraryOf(treePrefab()), request)).toBeNull();
    expect(
      placePrefab(registries, live, libraryOf(treePrefab(), room.prefab), {
        ...request,
        parent: fixedId('entity', 'nowhere'),
      }),
    ).toBeNull();

    expect(live).toEqual(before);
  });
});

describe('merging a scene into a running world', () => {
  /** A box with a sphere under it, and a component of a type this build lacks on the sphere. */
  function pair(name: string) {
    const parent = createMeshEntity('box');
    parent.entity.name = name;
    const child = createMeshEntity('sphere');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    const scene = { ...sceneWith([parent, child]), id: createSceneId(), name };
    scene.unknownComponents.set(fixedId('componentType', 'sparkle'), {
      version: 1,
      components: new Map([[child.entity.id, new Map([[createComponentId(), { glow: 2 }]])]]),
    });
    return { scene, parent: parent.entity.id, child: child.entity.id };
  }

  it('moves its records, components and root order in, after what the document holds, and leaves it empty', () => {
    const level = pair('Level');
    const hud = pair('Hud');
    const live = liveScene(level.scene);
    const loaded = liveScene(hud.scene);
    const records = [...loaded.entities.values()];
    const meshes = assertDefined(loaded.components.get('mesh'), "the HUD's meshes");
    const held = [...meshes.values()];
    const sparkles = [...(loaded.unknownComponents.get(fixedId('componentType', 'sparkle'))?.components.values() ?? [])];

    mergeScene(live, loaded);

    expect([...live.entities.keys()]).toEqual([level.parent, level.child, hud.parent, hud.child]);
    expect([live.entities.get(hud.parent), live.entities.get(hud.child)]).toEqual(records);
    expect(live.entities.get(hud.parent)).toBe(records[0]);
    expect(live.rootOrder).toEqual([level.parent, hud.parent]);
    // The same Maps, so the components in them are the same objects; after the document's, in their own order.
    const table = assertDefined(live.components.get('mesh'), 'the meshes');
    expect([...table.keys()]).toEqual([level.parent, level.child, hud.parent, hud.child]);
    expect([table.get(hud.parent), table.get(hud.child)]).toEqual(held);
    expect(table.get(hud.parent)).toBe(held[0]);
    const unknown = assertDefined(live.unknownComponents.get(fixedId('componentType', 'sparkle')), 'the sparkles');
    expect([...unknown.components.keys()]).toEqual([level.child, hud.child]);
    expect(unknown.components.get(hud.child)).toBe(sparkles[0]);
    expect(validateHierarchy(live)).toEqual([]);

    expect(loaded.entities.size).toBe(0);
    expect(loaded.components.size).toBe(0);
    expect(loaded.unknownComponents.size).toBe(0);
    expect(loaded.rootOrder).toEqual([]);
  });

  it("keeps an instance's contents listed under their placement", () => {
    const tree = treePrefab();
    const room = roomPrefab();
    const host = createEntity('Room', [createPrefabInstance(ROOM)]);
    const expanded = expandPrefabs(registries, sceneWith([host]), libraryOf(tree, room.prefab)).scene;
    const live = liveScene(sceneWith([createEntity('Stage')]));

    mergeScene(live, liveScene({ ...expanded, id: fixedId('scene', 'room') }));

    expect(live.entities.get(host.entity.id)?.children).toEqual([instancedId(host.entity.id, room.floor)]);
    expect(validateHierarchy(live)).toEqual([]);
    expect(removeSubtree(live, host.entity.id)).toHaveLength(6);
  });

  it('throws on an entity id the document already holds, and moves nothing', () => {
    const level = pair('Level');
    const live = liveScene(level.scene);
    const copy = liveScene({ ...level.scene, id: fixedId('scene', 'copy') });
    const before = [...live.entities.keys()];

    expect(() => mergeScene(live, copy)).toThrow(level.parent);

    expect([...live.entities.keys()]).toEqual(before);
    expect(copy.entities.size).toBe(2);
  });
});
