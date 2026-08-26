import {
  PREFAB_FORMAT_VERSION,
  SCENE_FORMAT_VERSION,
  componentsOf,
  deserializeScene,
  findComponent,
  migratePrefab,
  putComponent,
  type ComponentDoc,
  type PrefabDoc,
  type PrefabInstanceComponent,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * Components gain an id, and prefab overrides stop naming them by position.
 *
 * This migration does not get a second chance. A project on disk outlives every
 * version of the editor that will ever open it, and if the remap is wrong the
 * overrides are lost at the first save — so the documents here are written by
 * hand in the *old* shape rather than produced by the current factories. A test
 * that asserts the current shape can only ever agree with itself.
 *
 * The knot this pins down: an override lives in the **scene**, on the instance
 * component, while the component it names lives in the **prefab** — two files,
 * migrated at different times, by code that cannot see both. It works because
 * the id handed out during migration is derived from where the component
 * already is: `<entityId>:<index>`. Both sides compute the same string from
 * what they already hold, so neither needs the other.
 */

/** A prefab as an older editor wrote it: components with no ids. */
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
        components: [
          { type: 'mesh', geometry: { kind: 'box' }, material: { color: '#888888' }, materialId: null },
          { type: 'rigidbody' },
          { type: 'collider' },
        ],
      },
    },
  };
}

/** A scene overriding the second and third components of that prefab's trunk. */
function oldScene(): string {
  const host: unknown = {
    id: 'host',
    name: 'Tree',
    parent: null,
    children: [],
    transform: { position: [5, 0, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    components: [
      {
        type: 'prefabInstance',
        assetId: 'prefab-1',
        overrides: {
          // By position, which is the bug: adding a component to the prefab
          // slides every one of these onto a different component.
          trunk: { components: { 1: { mass: 12 }, 2: { isSensor: true } } },
          // Two prefabs deep, keyed by the path to the entity. Only the last
          // segment names an entity inside a prefab.
          'inner/lampRoot': { components: { 0: { intensity: 3 } } },
        },
      },
    ],
  };

  return JSON.stringify({
    version: 1,
    id: 'scene-1',
    name: 'Main',
    entities: { host },
    rootOrder: ['host'],
    environment: { background: '#2b2f33' },
  });
}

const overridesOf = (scene: SceneDoc, entityId: string): Record<string, unknown> => {
  const instance = findComponent(scene, entityId, 'prefabInstance') as PrefabInstanceComponent;
  return instance.overrides as unknown as Record<string, unknown>;
};

const overrideComponents = (scene: SceneDoc, entityId: string, key: string): Record<string, unknown> =>
  (overridesOf(scene, entityId)[key] as { components: Record<string, unknown> }).components;

describe('giving components an identity', () => {
  it('stamps every component of a scene written without ids', () => {
    const scene = deserializeScene(oldScene());

    expect(componentsOf(scene, 'host')[0]?.id).toBe('host:0');
    expect(scene.version).toBe(SCENE_FORMAT_VERSION);
  });

  it('stamps every component of a prefab, by the position it had', () => {
    const prefab = migratePrefab(oldPrefab() as PrefabDoc);

    // The ids the scene's overrides will be remapped onto, computed on the other
    // side of the wall without either file knowing about the other.
    expect(componentsOf(prefab, 'trunk').map((component) => component.id)).toEqual([
      'trunk:0',
      'trunk:1',
      'trunk:2',
    ]);
    expect(prefab.version).toBe(PREFAB_FORMAT_VERSION);
  });

  it('rekeys overrides from position to component id', () => {
    const scene = deserializeScene(oldScene());
    const direct = overrideComponents(scene, 'host', 'trunk');

    expect(Object.keys(direct).sort()).toEqual(['trunk:1', 'trunk:2']);
    expect(direct['trunk:1']).toEqual({ mass: 12 });
    expect(direct['trunk:2']).toEqual({ isSensor: true });
  });

  it('rekeys an override that reaches two prefabs deep', () => {
    const scene = deserializeScene(oldScene());
    const nested = overrideComponents(scene, 'host', 'inner/lampRoot');

    // The key is a path; the entity it names is its last segment, and that is
    // what the inner prefab used to build its own component ids.
    expect(Object.keys(nested)).toEqual(['lampRoot:0']);
    expect(nested['lampRoot:0']).toEqual({ intensity: 3 });
  });

  it('leaves an already-migrated document exactly as it is', () => {
    const once = deserializeScene(oldScene());
    const twice = deserializeScene(JSON.stringify(once));

    // The remap runs on the boundary and must be idempotent: a scene saved and
    // reopened would otherwise have its keys rewritten a second time, against
    // indices that no longer mean anything.
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('gives no id to a component type it has never heard of', () => {
    const raw = JSON.parse(oldScene()) as {
      entities: Record<string, { components: unknown[] }>;
    };
    raw.entities['host']!.components.push({ type: 'plugin:water', flow: 2 });

    const scene = deserializeScene(JSON.stringify(raw));
    const tables = scene.components as unknown as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    const kept = Object.values(tables['plugin:water']?.['host'] ?? {})[0] ?? {};

    // Rule 3 of the format contract: what this build does not recognise is
    // copied through untouched. An invented id would be written over the
    // author's data at the next save.
    // The id it is filed under is derived like every other, but the component
    // itself is copied through byte for byte.
    expect(kept).toEqual({ type: 'plugin:water', flow: 2 });
  });

  it('keeps ids the document already carries', () => {
    const raw = JSON.parse(oldScene()) as {
      version: number;
      entities: Record<string, { components: Record<string, unknown>[] }>;
    };
    raw.version = SCENE_FORMAT_VERSION;
    raw.entities['host']!.components[0]!['id'] = 'chosen-by-someone-else';

    const scene = deserializeScene(JSON.stringify(raw));
    expect(componentsOf(scene, 'host')[0]?.id).toBe('chosen-by-someone-else');
  });
});

/*
 * B10 itself: the prefab changes shape and the instances follow it correctly.
 */
describe('a prefab that gains a component', () => {
  it('does not slide the overrides of its instances onto other components', () => {
    const scene = deserializeScene(oldScene());
    const prefab = migratePrefab(oldPrefab() as PrefabDoc);

    // An author adds a light at the front of the trunk. Every override recorded
    // against the rigidbody and the collider used to move one place along: mass
    // landed on the collider, `isSensor` on nothing at all.
    putComponent(prefab, 'trunk', { id: 'added-later', type: 'audioListener', masterVolume: 1 });

    const byId = new Map(
      componentsOf(prefab, 'trunk').map((component) => [component.id, component]),
    );
    const overrides = overrideComponents(scene, 'host', 'trunk');

    for (const [componentId, patch] of Object.entries(overrides)) {
      const target = byId.get(componentId) as ComponentDoc | undefined;
      expect(target).toBeDefined();
      // And it is still the component the author meant, not its neighbour.
      if (componentId === 'trunk:1') expect(target?.type).toBe('rigidbody');
      if (componentId === 'trunk:2') expect(target?.type).toBe('collider');
      void patch;
    }
  });
});
