import {
  LAUNCH_SNAPSHOT_VERSION,
  PREFAB_FORMAT_VERSION,
  assertDefined,
  componentsOf,
  conformLaunchSnapshot,
  createDefaultLayer,
  createMaterial,
  createPhysicsMaterial,
  createPhysicsSettings,
  createPrefabDoc,
  createRenderingSettings,
  createStarterScene,
  emptyComponentTables,
  encodeLaunchSnapshot,
  fixedId,
  serializeScene,
  type LaunchSnapshot,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The snapshot a device launch sends, checked where it arrives in the main
 * process. It is whatever the renderer sent — a project's own script can call
 * the bridge — and it becomes the files a phone downloads, so every value below
 * that is not a factory's is deliberately wrong.
 *
 * It crosses as the window writes it: the entry scene and each prefab are text,
 * since a document holds Maps and Electron does not promise a Map survives its
 * bridge. Play keeps its documents in memory and encodes nothing.
 */

function snapshot(): LaunchSnapshot {
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: fixedId('scene', 'scene-1'), name: 'Level', scene: createStarterScene() },
    materials: { stone: createMaterial('#777777') },
    physicsMaterials: { ice: { ...createPhysicsMaterial(), friction: 0, frictionCombine: 'min' } },
    prefabs: { crate: createPrefabDoc('Crate', [], emptyComponentTables(), '') },
    rendering: { ...createRenderingSettings(), exposure: 1.5 },
    physics: {
      ...createPhysicsSettings(),
      gravity: [0, -3, 0],
      layers: [createDefaultLayer(), { id: 'player', name: 'Player', ignores: ['default'] }],
    },
    loadingScene: fixedId('scene', 'loading'),
  };
}

/** A prefab as an older editor wrote it: its components inside the entity, with no ids. */
function oldPrefab(): unknown {
  return {
    version: 1,
    id: 'prefab-1',
    name: 'Tree',
    root: 'trunk',
    entities: {
      trunk: {
        id: 'trunk',
        name: 'Trunk',
        parent: null,
        children: [],
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        locked: false,
        components: [{ type: 'rigidbody' }, { type: 'collider' }],
      },
    },
  };
}

/** The snapshot as the window sends it. */
const sent = () => encodeLaunchSnapshot(snapshot());

describe('a launch snapshot, as it is sent', () => {
  it('carries its entry scene and each prefab as text, and everything else as it is', () => {
    const original = snapshot();

    const wire = encodeLaunchSnapshot(original);

    expect(wire.version).toBe(LAUNCH_SNAPSHOT_VERSION);
    expect(wire.entry).toEqual({ id: 'scene-1', name: 'Level', sceneJson: expect.any(String) });
    expect(JSON.parse(wire.entry.sceneJson)).toEqual(JSON.parse(serializeScene(original.entry.scene)));
    expect(wire.prefabs).toEqual({ crate: expect.any(String) });
    expect(wire.materials).toEqual(original.materials);
    expect(wire.loadingScene).toBe('loading');
  });
});

describe('a launch snapshot, where it arrives', () => {
  it('comes back as it was sent when it is well formed, with the entry scene as it arrived', () => {
    const original = snapshot();
    const wire = encodeLaunchSnapshot(original);

    const received = conformLaunchSnapshot(structuredClone(wire));

    expect(received.snapshot).toEqual(original);
    expect(received.entryJson).toBe(wire.entry.sceneJson);
  });

  it.each([
    ['a version it does not know', { ...sent(), version: 1 }],
    ['no version', { ...sent(), version: undefined }],
    ['an entry without an id', { ...sent(), entry: { name: 'Level', sceneJson: sent().entry.sceneJson } }],
    ['an entry without a name', { ...sent(), entry: { id: 'scene-1', sceneJson: sent().entry.sceneJson } }],
    ['an entry scene that is not text', { ...sent(), entry: { ...sent().entry, sceneJson: createStarterScene() } }],
    ['an entry scene that is not JSON', { ...sent(), entry: { ...sent().entry, sceneJson: '{ not json' } }],
    ['an entry scene that is not a scene', { ...sent(), entry: { ...sent().entry, sceneJson: '[]' } }],
    ['the documents as objects, as version 1 sent them', { ...sent(), entry: { id: 'scene-1', name: 'Level', scene: createStarterScene() } }],
    ['no entry', { ...sent(), entry: null }],
    ['not an object', 'snapshot'],
  ])('is refused with %s', (_why, value) => {
    expect(() => conformLaunchSnapshot(value)).toThrow();
  });

  it('conforms each material', () => {
    const wire = {
      ...sent(),
      materials: { stone: { ...createMaterial(), side: 'sideways', trap: 1 } },
    };

    const { materials } = conformLaunchSnapshot(wire).snapshot;
    const material = assertDefined(materials['stone'], 'the stone material');

    expect(material.side).toBe(createMaterial().side);
    expect(material).not.toHaveProperty('trap');
  });

  it('conforms each physics material', () => {
    const { physicsMaterials } = conformLaunchSnapshot({
      ...sent(),
      physicsMaterials: { ice: { restitution: 0.5, frictionCombine: 'sum' }, broken: 'nothing' },
    }).snapshot;

    // The rule read as Average, the missing friction the factory's.
    expect(physicsMaterials['ice']).toEqual({ ...createPhysicsMaterial(), restitution: 0.5 });
    expect(physicsMaterials['broken']).toEqual(createPhysicsMaterial());
  });

  it('falls back on the factories’ settings, and on no loading scene', () => {
    const { snapshot: conformed } = conformLaunchSnapshot({ ...sent(), rendering: 'x', loadingScene: 3 });

    expect(conformed.rendering).toEqual(createRenderingSettings());
    expect(conformed.loadingScene).toBeNull();
  });

  it('refuses an entry whose id is not an id, and has no loading scene when that is not one', () => {
    const wire = sent();

    // A scene's id is a text that is not empty, and what a window sends is
    // whatever a script on the other side of the bridge made of it.
    expect(() => conformLaunchSnapshot({ ...wire, entry: { ...wire.entry, id: '' } })).toThrow('by id and name');
    expect(() => conformLaunchSnapshot({ ...wire, entry: { ...wire.entry, id: 7 } })).toThrow('by id and name');
    expect(conformLaunchSnapshot({ ...wire, loadingScene: '' }).snapshot.loadingScene).toBeNull();
  });

  it('migrates a prefab an older editor wrote, and drops one that is not text', () => {
    const { prefabs } = conformLaunchSnapshot({
      ...sent(),
      prefabs: { tree: JSON.stringify(oldPrefab()), broken: { not: 'text' } },
    }).snapshot;

    const tree = assertDefined(prefabs['tree'], 'the tree prefab');
    expect(tree.version).toBe(PREFAB_FORMAT_VERSION);
    expect(componentsOf(tree, 'trunk').map((component) => component.id)).toEqual([
      'trunk:0',
      'trunk:1',
    ]);
    expect(prefabs).not.toHaveProperty('broken');
  });

  it('refuses a prefab whose text is not JSON, as it refuses a scene', () => {
    expect(() => conformLaunchSnapshot({ ...sent(), prefabs: { tree: '{ not json' } })).toThrow('not valid JSON');
  });

  it('drops a field it does not know', () => {
    expect(conformLaunchSnapshot({ ...sent(), trap: 1 }).snapshot).not.toHaveProperty('trap');
  });

  it('reads its layer table entry by entry', () => {
    const wire = sent();
    const { physics } = conformLaunchSnapshot({
      ...wire,
      physics: { ...wire.physics, layers: [{ id: 'player', name: 'Player', ignores: [] }, 'oops'] },
    }).snapshot;

    expect(physics.layers).toEqual([createDefaultLayer(), { id: 'player', name: 'Player', ignores: [] }]);
    expect(physics.gravity).toEqual([0, -3, 0]);
  });
});
