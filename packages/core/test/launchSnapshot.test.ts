import {
  LAUNCH_SNAPSHOT_VERSION,
  PREFAB_FORMAT_VERSION,
  assertDefined,
  conformLaunchSnapshot,
  createDefaultLayer,
  createMaterial,
  createPhysicsMaterial,
  createPhysicsSettings,
  createEntity,
  createPrefabDoc,
  createRenderingSettings,
  createStarterScene,
  encodeLaunchSnapshot,
  decodeScene,
  fixedId,
  serializeScene,
  type LaunchSnapshot,
  type PrefabDoc,
  unwrap,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

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

const STONE = fixedId('asset', 'stone');
const ICE = fixedId('asset', 'ice');
const CRATE = fixedId('asset', 'crate');
const TREE = fixedId('asset', 'tree');
const BROKEN = fixedId('asset', 'broken');

/** A crate whose one entity is its root, under ids that are the same at every call. */
function crate(): PrefabDoc {
  const root = createEntity('Crate').entity;
  root.id = fixedId('entity', 'root');
  return { ...createPrefabDoc('Crate', [root], root.id), id: CRATE };
}

function snapshot(): LaunchSnapshot {
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: fixedId('scene', 'scene-1'), name: 'Level', scene: createStarterScene() },
    materials: new Map([[STONE, createMaterial('#777777')]]),
    physicsMaterials: new Map([[ICE, { ...createPhysicsMaterial(), friction: 0, frictionCombine: 'min' }]]),
    // Under the id it is filed by, as a prefab read from a library always is.
    prefabs: new Map([
      [CRATE, crate()],
    ]),
    rendering: { ...createRenderingSettings(), exposure: 1.5 },
    physics: {
      ...createPhysicsSettings(),
      gravity: [0, -3, 0],
      layers: [createDefaultLayer(), { id: 'player', name: 'Player', ignores: ['default'] }],
    },
    loadingScene: fixedId('scene', 'loading'),
  };
}

/** The snapshot as the window sends it. */
const sent = () => encodeLaunchSnapshot(registries, snapshot());

describe('a launch snapshot, as it is sent', () => {
  it('carries its entry scene and each prefab as text, and everything else as it is', () => {
    const original = snapshot();

    const wire = encodeLaunchSnapshot(registries, original);

    expect(wire.version).toBe(LAUNCH_SNAPSHOT_VERSION);
    expect(wire.entry).toEqual({ id: 'scene-1', name: 'Level', sceneJson: expect.any(String) });
    // A message, not a file: what the main process reads back from it is the
    // scene that was sent.
    expect(serializeScene(registries, unwrap(decodeScene(registries, wire.entry.sceneJson), 'Scene file'))).toBe(
      serializeScene(registries, original.entry.scene),
    );
    expect(wire.prefabs).toEqual({ [CRATE]: expect.any(String) });
    expect(wire.materials).toEqual(Object.fromEntries(original.materials));
    expect(wire.loadingScene).toBe('loading');
  });
});

describe('a launch snapshot, where it arrives', () => {
  it('comes back as it was sent when it is well formed, with the entry scene as it arrived', () => {
    const original = snapshot();
    const wire = encodeLaunchSnapshot(registries, original);

    const received = conformLaunchSnapshot(registries, structuredClone(wire));

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
    expect(() => conformLaunchSnapshot(registries, value)).toThrow();
  });

  it('conforms each material', () => {
    const wire = {
      ...sent(),
      materials: { stone: { ...createMaterial(), side: 'sideways', trap: 1 } },
    };

    const { materials } = conformLaunchSnapshot(registries, wire).snapshot;
    const material = assertDefined(materials.get(STONE), 'the stone material');

    expect(material.side).toBe(createMaterial().side);
    expect(material).not.toHaveProperty('trap');
  });

  it('conforms each physics material', () => {
    const { physicsMaterials } = conformLaunchSnapshot(registries, {
      ...sent(),
      physicsMaterials: { ice: { restitution: 0.5, frictionCombine: 'sum' }, broken: 'nothing' },
    }).snapshot;

    // The rule read as Average, the missing friction the factory's.
    expect(physicsMaterials.get(ICE)).toEqual({ ...createPhysicsMaterial(), restitution: 0.5 });
    expect(physicsMaterials.get(BROKEN)).toEqual(createPhysicsMaterial());
  });

  it('falls back on the factories’ settings, and on no loading scene', () => {
    const { snapshot: conformed } = conformLaunchSnapshot(registries, { ...sent(), rendering: 'x', loadingScene: 3 });

    expect(conformed.rendering).toEqual(createRenderingSettings());
    expect(conformed.loadingScene).toBeNull();
  });

  it('refuses an entry whose id is not an id, and has no loading scene when that is not one', () => {
    const wire = sent();

    // A scene's id is a text that is not empty, and what a window sends is
    // whatever a script on the other side of the bridge made of it.
    expect(() =>
      conformLaunchSnapshot(registries, { ...wire, entry: { ...wire.entry, id: '' } }),
    ).toThrow('by id and name');
    expect(() =>
      conformLaunchSnapshot(registries, { ...wire, entry: { ...wire.entry, id: 7 } }),
    ).toThrow('by id and name');
    expect(conformLaunchSnapshot(registries, { ...wire, loadingScene: '' }).snapshot.loadingScene).toBeNull();
  });

  it('reads each prefab under the id it arrived by, and drops one that is not text', () => {
    const { prefabs } = conformLaunchSnapshot(registries, {
      ...sent(),
      prefabs: { tree: sent().prefabs[CRATE], broken: { not: 'text' } },
    }).snapshot;

    const tree = assertDefined(prefabs.get(TREE), 'the tree prefab');
    expect(tree.version).toBe(PREFAB_FORMAT_VERSION);
    // Under the id it arrived by, whatever the text said of its own.
    expect(tree.id).toBe(TREE);
    expect(prefabs.has(BROKEN)).toBe(false);
  });

  it('refuses a prefab of another format, which nothing converts, as it refuses a scene', () => {
    const older = JSON.stringify({ ...JSON.parse(sent().prefabs[CRATE] ?? '{}'), version: PREFAB_FORMAT_VERSION - 1 });

    expect(() => conformLaunchSnapshot(registries, { ...sent(), prefabs: { tree: older } })).toThrow(
      `Prefab tree\nversion: written in format ${PREFAB_FORMAT_VERSION - 1}`,
    );
  });

  it('refuses a prefab whose text is not JSON, as it refuses a scene', () => {
    expect(() =>
      conformLaunchSnapshot(registries, { ...sent(), prefabs: { tree: '{ not json' } }),
    ).toThrow('Prefab tree\nis not JSON');
  });

  it('drops a field it does not know', () => {
    expect(conformLaunchSnapshot(registries, { ...sent(), trap: 1 }).snapshot).not.toHaveProperty('trap');
  });

  it('reads its layer table entry by entry', () => {
    const wire = sent();
    const { physics } = conformLaunchSnapshot(registries, {
      ...wire,
      physics: { ...wire.physics, layers: [{ id: 'player', name: 'Player', ignores: [] }, 'oops'] },
    }).snapshot;

    expect(physics.layers).toEqual([createDefaultLayer(), { id: 'player', name: 'Player', ignores: [] }]);
    expect(physics.gravity).toEqual([0, -3, 0]);
  });
});
