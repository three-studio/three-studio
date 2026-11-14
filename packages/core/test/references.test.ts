import {
  createEntity,
  createJoint,
  createPrefabInstance,
  createMaterial,
  createCollider,
  createModel,
  createScript,
  createMeshEntity,
  collectSceneAssets,
  findAssetUsage,
  expandPrefabs,
  findBrokenReferences,
  findMissingEntities,
  findPrefabInstances,
  fixedId,
  instancedId,
  isUsed,
  totalUses,
  type AssetId,
  type MeshComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith } from './fixtures';
import { sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * Deleting an asset is the one operation no undo takes back, so what uses it
 * has to be answerable before the file goes. This walks the same places the
 * exporter collects from — the two disagreeing would mean one shipping a
 * texture the other says nothing references.
 */

const TEXTURE = fixedId('asset', 'tex-1');
const SKY = fixedId('asset', 'tex-sky');
const PREFAB = fixedId('asset', 'prefab-1');

describe('who uses an asset', () => {
  it('finds a texture in a mesh slot, in a material asset, and inside a prefab', () => {
    const mat1 = fixedId('asset', 'mat-1');
    const mat2 = fixedId('asset', 'mat-2');
    const mesh = createMeshEntity('box');
    (mesh.components[0] as MeshComponent).material.normalMap = TEXTURE;

    const inPrefab = createMeshEntity('sphere');
    (inPrefab.components[0] as MeshComponent).material.colorMap = TEXTURE;
    const prefab = prefabWith('Rock', [inPrefab], inPrefab.entity.id);

    const usage = findAssetUsage(
      registries,
      TEXTURE,
      sceneWith([mesh]),
      new Map([
        [mat1, { ...createMaterial(), aoMap: TEXTURE }],
        [mat2, createMaterial()],
      ]),
      new Map([[PREFAB, prefab]]),
    );

    expect(usage.entities).toEqual([mesh.entity.id]);
    expect(usage.materials).toEqual([mat1]);
    expect(usage.prefabs).toEqual([PREFAB]);
    expect(totalUses(usage)).toBe(3);
  });

  it('finds a model, a script and a sound by the id their component carries', () => {
    const modelId = fixedId('asset', 'model-1');
    const scriptId = fixedId('asset', 'script-1');
    const model = createEntity('Tree', [{ ...createModel(), assetId: modelId }]);
    const scripted = createEntity('Spinner', [
      { ...createScript(), assetId: scriptId },
    ]);
    const scene = sceneWith([model, scripted]);

    expect(findAssetUsage(registries, modelId, scene, new Map(), new Map()).entities).toEqual([model.entity.id]);
    expect(findAssetUsage(registries, scriptId, scene, new Map(), new Map()).entities).toEqual([scripted.entity.id]);
    expect(isUsed(findAssetUsage(registries, fixedId('asset', 'audio-1'), scene, new Map(), new Map()))).toBe(false);
  });

  it('a physics material is used by the colliders that link it, ships with their scene, and is a broken reference once gone', () => {
    const ice = fixedId('asset', 'ice');
    const puck = createEntity('Puck', [{ ...createCollider(), materialId: ice }]);
    const scene = sceneWith([puck]);

    expect(findAssetUsage(registries, ice, scene, new Map(), new Map()).entities).toEqual([puck.entity.id]);
    expect(collectSceneAssets(registries, scene, new Map(), new Map())).toContain(ice);
    expect(findBrokenReferences(registries, scene, new Set())).toEqual([
      { entityId: puck.entity.id, assetId: ice },
    ]);
  });

  it('finds the scene environment, which is not an entity and holds no component', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = SKY;

    const usage = findAssetUsage(registries, SKY, scene, new Map(), new Map());

    // Before this the answer was "nothing in the open scene uses it", and the
    // delete went ahead on a file the whole level was lit by.
    expect(usage.environment).toBe(true);
    expect(isUsed(usage)).toBe(true);
    expect(totalUses(usage)).toBe(1);
  });

  it('counts one image used as both the sky and the light once', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = SKY;
    scene.environment.environmentTexture = SKY;

    // There is one environment, so it is one use however many of its slots name
    // the file — "2 things use it" would be counting slots, not things.
    expect(totalUses(findAssetUsage(registries, SKY, scene, new Map(), new Map()))).toBe(1);
  });

  it('says nothing uses an asset nothing names', () => {
    const usage = findAssetUsage(
      registries,
      fixedId('asset', 'tex-spare'),
      sceneWith([createMeshEntity('box')]),
      new Map(),
      new Map(),
    );
    expect(isUsed(usage)).toBe(false);
  });

  it('is not matched by the slots nobody filled', () => {
    // A model not yet given a file holds `''` and an unset texture slot holds
    // `null`. Neither names an asset, and counting them as uses of one would
    // report the whole scene.
    const scene = sceneWith([createEntity('Blank', [createModel()]), createMeshEntity('box')]);

    expect(isUsed(findAssetUsage(registries, TEXTURE, scene, new Map(), new Map()))).toBe(false);
  });
});

describe('counting prefab instances', () => {
  it('lists the entities placing one, and only that one', () => {
    const instance = (assetId: AssetId) =>
      createEntity('Tree', [createPrefabInstance(assetId)]);
    const a = instance(PREFAB);
    const b = instance(PREFAB);
    const other = instance(fixedId('asset', 'prefab-2'));

    // The number to show before an Apply: how many objects it is about to
    // change.
    expect(findPrefabInstances(PREFAB, sceneWith([a, b, other])).sort()).toEqual(
      [a.entity.id, b.entity.id].sort(),
    );
  });
});

/*
 * An entity a component names that the scene does not have: a joint whose
 * Connected Body was deleted, which the hierarchy marks as it marks a missing
 * asset.
 */
describe('who names an entity that is gone', () => {
  it('a joint naming an entity the scene does not have names a missing entity', () => {
    const frame = createEntity('Frame');
    const door = createEntity('Door', [{ ...createJoint(), connectedEntity: fixedId('entity', 'gone') }]);
    const free = createEntity('Free', [createJoint()]);
    const held = createEntity('Held', [{ ...createJoint(), connectedEntity: frame.entity.id }]);

    expect(findMissingEntities(registries, sceneWith([frame, door, free, held]))).toEqual([
      { entityId: door.entity.id, type: 'joint' },
    ]);
  });

  it('reaches what a prefab places, through the expanded scene', () => {
    const door = createEntity('Door', [{ ...createJoint(), connectedEntity: fixedId('entity', 'gone') }]);
    const prefab = prefabWith('Door', [door], door.entity.id);
    const host = createEntity('Doorway', [createPrefabInstance(PREFAB)]);

    const { scene } = expandPrefabs(registries, sceneWith([host]), new Map([[PREFAB, prefab]]));

    expect(findMissingEntities(registries, scene)).toEqual([
      { entityId: instancedId(host.entity.id, door.entity.id), type: 'joint' },
    ]);
  });
});
