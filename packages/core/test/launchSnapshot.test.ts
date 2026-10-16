import {
  LAUNCH_SNAPSHOT_VERSION,
  PREFAB_FORMAT_VERSION,
  componentsOf,
  conformLaunchSnapshot,
  createMaterial,
  createPhysicsSettings,
  createPrefabDoc,
  createRenderingSettings,
  createStarterScene,
  emptyComponentTables,
  type LaunchSnapshot,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The snapshot a device launch sends, checked where it arrives in the main
 * process. It is whatever the renderer sent — a project's own script can call
 * the bridge — and it becomes the files a phone downloads, so every value below
 * that is not a factory's is deliberately wrong.
 */

function snapshot(): LaunchSnapshot {
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: 'scene-1', name: 'Level', scene: createStarterScene() },
    materials: { stone: createMaterial('#777777') },
    prefabs: { crate: createPrefabDoc('Crate', [], emptyComponentTables(), '') },
    rendering: { ...createRenderingSettings(), exposure: 1.5 },
    physics: { ...createPhysicsSettings(), gravity: [0, -3, 0] },
    loadingScene: 'loading',
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

describe('a launch snapshot, where it arrives', () => {
  it('comes back as it was sent when it is well formed', () => {
    const sent = snapshot();

    expect(conformLaunchSnapshot(structuredClone(sent))).toEqual(sent);
  });

  it.each([
    ['a version it does not know', { ...snapshot(), version: 2 }],
    ['no version', { ...snapshot(), version: undefined }],
    ['an entry without an id', { ...snapshot(), entry: { name: 'Level', scene: createStarterScene() } }],
    ['an entry without a name', { ...snapshot(), entry: { id: 'scene-1', scene: createStarterScene() } }],
    ['no entry', { ...snapshot(), entry: null }],
    ['not an object', 'snapshot'],
  ])('is refused with %s', (_why, value) => {
    expect(() => conformLaunchSnapshot(value)).toThrow();
  });

  it('conforms each material', () => {
    const sent = {
      ...snapshot(),
      materials: { stone: { ...createMaterial(), side: 'sideways', trap: 1 } },
    };

    const material = conformLaunchSnapshot(sent).materials['stone']!;

    expect(material.side).toBe(createMaterial().side);
    expect(material).not.toHaveProperty('trap');
  });

  it('falls back on the factories’ settings, and on no loading scene', () => {
    const conformed = conformLaunchSnapshot({ ...snapshot(), rendering: 'x', loadingScene: 3 });

    expect(conformed.rendering).toEqual(createRenderingSettings());
    expect(conformed.loadingScene).toBeNull();
  });

  it('migrates a prefab an older editor wrote, and drops one that is not an object', () => {
    const conformed = conformLaunchSnapshot({
      ...snapshot(),
      prefabs: { tree: oldPrefab(), broken: 'nothing' },
    });

    const tree = conformed.prefabs['tree']!;
    expect(tree.version).toBe(PREFAB_FORMAT_VERSION);
    expect(componentsOf(tree, 'trunk').map((component) => component.id)).toEqual([
      'trunk:0',
      'trunk:1',
    ]);
    expect(conformed.prefabs).not.toHaveProperty('broken');
  });

  it('drops a field it does not know', () => {
    expect(conformLaunchSnapshot({ ...snapshot(), trap: 1 })).not.toHaveProperty('trap');
  });
});
