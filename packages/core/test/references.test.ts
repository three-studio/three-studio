import {
  createEntity,
  createPrefabInstance,
  createMaterial,
  createComponent,
  createMeshEntity,
    findAssetUsage,
  findPrefabInstances,
  isUsed,
  totalUses,
  type MeshComponent,
  type PrefabInstanceComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith } from './fixtures';
import { sceneWith } from './fixtures';

/*
 * Deleting an asset is the one operation no undo takes back, so what uses it
 * has to be answerable before the file goes. This walks the same places the
 * exporter collects from — the two disagreeing would mean one shipping a
 * texture the other says nothing references.
 */

describe('who uses an asset', () => {
  it('finds a texture in a mesh slot, in a material asset, and inside a prefab', () => {
    const mesh = createMeshEntity('box');
    (mesh.components[0] as MeshComponent).material.normalMap = 'tex-1';

    const inPrefab = createMeshEntity('sphere');
    (inPrefab.components[0] as MeshComponent).material.colorMap = 'tex-1';
    const prefab = prefabWith('Rock', [inPrefab], inPrefab.entity.id);

    const usage = findAssetUsage(
      'tex-1',
      sceneWith([mesh]),
      { 'mat-1': { ...createMaterial(), aoMap: 'tex-1' }, 'mat-2': createMaterial() },
      { 'prefab-1': prefab },
    );

    expect(usage.entities).toEqual([mesh.entity.id]);
    expect(usage.materials).toEqual(['mat-1']);
    expect(usage.prefabs).toEqual(['prefab-1']);
    expect(totalUses(usage)).toBe(3);
  });

  it('finds a model, a script and a sound by the id their component carries', () => {
    const model = createEntity('Tree', [{ ...createComponent('model'), assetId: 'model-1' }]);
    const scripted = createEntity('Spinner', [
      { ...createComponent('script'), assetId: 'script-1' },
    ]);
    const scene = sceneWith([model, scripted]);

    expect(findAssetUsage('model-1', scene, {}, {}).entities).toEqual([model.entity.id]);
    expect(findAssetUsage('script-1', scene, {}, {}).entities).toEqual([scripted.entity.id]);
    expect(isUsed(findAssetUsage('audio-1', scene, {}, {}))).toBe(false);
  });

  it('finds the scene environment, which is not an entity and holds no component', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = 'tex-sky';

    const usage = findAssetUsage('tex-sky', scene, {}, {});

    // Before this the answer was "nothing in the open scene uses it", and the
    // delete went ahead on a file the whole level was lit by.
    expect(usage.environment).toBe(true);
    expect(isUsed(usage)).toBe(true);
    expect(totalUses(usage)).toBe(1);
  });

  it('counts one image used as both the sky and the light once', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = 'tex-sky';
    scene.environment.environmentTexture = 'tex-sky';

    // There is one environment, so it is one use however many of its slots name
    // the file — "2 things use it" would be counting slots, not things.
    expect(totalUses(findAssetUsage('tex-sky', scene, {}, {}))).toBe(1);
  });

  it('says nothing uses an asset nothing names', () => {
    const usage = findAssetUsage('tex-spare', sceneWith([createMeshEntity('box')]), {}, {});
    expect(isUsed(usage)).toBe(false);
  });

  it('treats an empty id as used by nothing, rather than matching every empty slot', () => {
    // Every unset texture slot is `null`, but a material id can be `''` on its
    // way through a picker — and matching those would report the whole scene.
    const usage = findAssetUsage('', sceneWith([createMeshEntity('box')]), {}, {});
    expect(isUsed(usage)).toBe(false);
  });
});

describe('counting prefab instances', () => {
  it('lists the entities placing one, and only that one', () => {
    const instance = (assetId: string) =>
      createEntity('Tree', [createPrefabInstance(assetId)]);
    const a = instance('prefab-1');
    const b = instance('prefab-1');
    const other = instance('prefab-2');

    // The number to show before an Apply: how many objects it is about to
    // change.
    expect(findPrefabInstances('prefab-1', sceneWith([a, b, other])).sort()).toEqual(
      [a.entity.id, b.entity.id].sort(),
    );
  });
});
