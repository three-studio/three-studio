import {
  assertDefined,
  createEntity,
  createMeshEntity,
  modelType,
  findBrokenReferences,
  findComponent,
  fixedId,
  type AssetId,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * A reference to an asset that is gone is an **ordinary state**, not a fault.
 * Deleting an asset something uses is allowed, and the dialog says so — "N
 * things in this project use it. They will keep the reference and show
 * nothing." A scene saved before the delete keeps it too.
 *
 * What is not allowed is for the author to have no way of seeing it. An entity
 * that draws nothing looks exactly like an entity that is not there, and the
 * only clue was a stack trace in the console.
 */

const MODEL = fixedId('asset', 'model-1');
const TEXTURE = fixedId('asset', 'tex-1');
const GONE = fixedId('asset', 'gone');
const BURNT = fixedId('asset', 'burnt');
const SKY_GONE = fixedId('asset', 'sky-gone');

const KNOWN: ReadonlySet<AssetId> = new Set([MODEL, TEXTURE]);

describe('what a scene names and the project does not have', () => {
  it('names the entity and the id, so both ends of the break are reachable', () => {
    const tree = createEntity('Tree', [{ ...modelType.create(), assetId: GONE }]);

    expect(findBrokenReferences(registries, sceneWith([tree]), KNOWN)).toEqual([
      { entityId: tree.entity.id, assetId: GONE },
    ]);
  });

  it('says nothing about an id the project holds', () => {
    const tree = createEntity('Tree', [{ ...modelType.create(), assetId: MODEL }]);

    expect(findBrokenReferences(registries, sceneWith([tree]), KNOWN)).toEqual([]);
  });

  it('leaves an empty slot alone, which is a field nobody filled', () => {
    // A texture slot is `null` when it is empty, but a file can hold `''` there:
    // the reader keeps any text a slot is given. Reporting it would put every
    // unfilled slot in the project on the list.
    const box = createMeshEntity('box');
    const scene = sceneWith([box]);
    const mesh = assertDefined(findComponent(scene, box.entity.id, 'mesh'), 'the box mesh');
    // Written past the type, as a file does.
    Reflect.set(mesh.material, 'normalMap', '');

    expect(findBrokenReferences(registries, scene, KNOWN)).toEqual([]);
  });

  it('reads texture slots inside a mesh material, not only whole-asset ids', () => {
    const box = createMeshEntity('box');
    const scene = sceneWith([box]);
    const mesh = assertDefined(findComponent(scene, box.entity.id, 'mesh'), 'the box mesh');
    mesh.material.colorMap = TEXTURE;
    mesh.material.aoMap = BURNT;

    expect(findBrokenReferences(registries, scene, KNOWN)).toEqual([
      { entityId: box.entity.id, assetId: BURNT },
    ]);
  });

  it('counts one entity naming one missing id once, however many slots name it', () => {
    // A material reusing a single image as its colour and its ambient occlusion
    // map is one broken reference to fix, not two to read past.
    const box = createMeshEntity('box');
    const scene = sceneWith([box]);
    const mesh = assertDefined(findComponent(scene, box.entity.id, 'mesh'), 'the box mesh');
    mesh.material.colorMap = BURNT;
    mesh.material.aoMap = BURNT;

    expect(findBrokenReferences(registries, scene, KNOWN)).toHaveLength(1);
  });

  it('finds the environment, which is not an entity and carries no component', () => {
    // The blind spot that once shipped a build with no sky: the component walk
    // cannot reach the environment, so it is asked separately.
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment = { ...scene.environment, backgroundTexture: SKY_GONE };

    expect(findBrokenReferences(registries, scene, KNOWN)).toEqual([
      { entityId: null, assetId: SKY_GONE },
    ]);
  });

  it('reports every entity separately when several name the same missing asset', () => {
    const one = createEntity('A', [{ ...modelType.create(), assetId: GONE }]);
    const two = createEntity('B', [{ ...modelType.create(), assetId: GONE }]);

    const broken = findBrokenReferences(registries, sceneWith([one, two]), KNOWN);
    expect(broken.map((entry) => entry.entityId).sort()).toEqual(
      [one.entity.id, two.entity.id].sort(),
    );
  });

  it('finds nothing in a scene that names nothing', () => {
    expect(findBrokenReferences(registries, sceneWith([createEntity('Empty')]), new Set())).toEqual([]);
  });
});
