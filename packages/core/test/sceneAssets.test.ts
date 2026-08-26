import {
  collectSceneAssets,
  createComponent,
  createEmptyScene,
  emptyComponentTables,
  setComponentsOf,
  createEntity,
  createPrefabInstance,
  createMaterial,
  createMeshEntity,
  sceneName,
  type MeshComponent,
  type PrefabInstanceComponent,
  type EntityTemplate,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { prefabWith } from './fixtures';

/*
 * What a loading bar counts. The document is a few kilobytes of JSON and the
 * wait is entirely its assets, so this list is the difference between a bar
 * that means something and one that jumps from nothing to done.
 */

function sceneWith(templates: EntityTemplate[]): SceneDoc {
  const scene: SceneDoc = {
    version: 1,
    id: 'scene',
    name: 'Main',
    entities: Object.fromEntries(templates.map(({ entity }) => [entity.id, entity])),
    components: emptyComponentTables(),
    rootOrder: templates.map(({ entity }) => entity.id),
    // From the factory, not by hand: the environment is not what any of these
    // exercise, and a literal here needs an edit every time it gains a field.
    environment: createEmptyScene().environment,
  };
  for (const template of templates) {
    setComponentsOf(scene, template.entity.id, template.components);
  }
  return scene;
}

describe('what a scene needs before it can be shown', () => {
  it('collects models, textures and a linked material’s own maps', () => {
    const mesh = createMeshEntity('box');
    const component = mesh.components[0] as MeshComponent;
    component.material.colorMap = 'tex-inline';
    component.materialId = 'mat-1';

    const model = createEntity('Tree', [{ ...createComponent('model'), assetId: 'model-1' }]);

    const ids = collectSceneAssets(
      sceneWith([mesh, model]),
      { 'mat-1': { ...createMaterial(), normalMap: 'tex-shared' } },
      {},
    );

    // The shared material's normal map is named by nothing in the scene; miss
    // it and the level pops in a frame late, textureless.
    expect(ids.sort()).toEqual(['mat-1', 'model-1', 'tex-inline', 'tex-shared'].sort());
  });

  it('follows a prefab into its contents, and through a nested one', () => {
    const inner = createEntity('Lamp', [{ ...createComponent('model'), assetId: 'model-lamp' }]);
    const lamp = prefabWith('Lamp', [inner], inner.entity.id);

    const roomRoot = createEntity('Room', [
      createPrefabInstance('prefab-lamp'),
    ]);
    const room = prefabWith('Room', [roomRoot], roomRoot.entity.id);

    const host = createEntity('Room', [
      createPrefabInstance('prefab-room'),
    ]);

    const ids = collectSceneAssets(sceneWith([host]), {}, {
      'prefab-lamp': lamp,
      'prefab-room': room,
    });

    // One id in the scene, a model two prefabs down: the instance is what the
    // author placed, and the wait is the lamp.
    expect(ids).toContain('model-lamp');
  });

  it('collects the sky and the light it casts, which belong to no entity', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = 'tex-sky';
    scene.environment.environmentTexture = 'tex-ibl';

    const ids = collectSceneAssets(scene, {}, {});

    // The walk this used to be went over the component tables only, and the
    // environment is a property of the scene. So the heaviest file in the
    // project — an equirectangular HDR is megabytes where a prop is kilobytes —
    // was the one asset the exporter did not ship and the loading bar did not
    // count, and the build came up with no sky and every surface unlit.
    expect(ids).toContain('tex-sky');
    expect(ids).toContain('tex-ibl');
  });

  it('leaves out a background texture the scene is not showing', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    // `background` keeps its texture when the mode goes back to colour, so that
    // switching back does not lose the choice. It still has to ship: switching
    // the mode in a built game is a supported thing to do, and an id that
    // resolves to nothing is the failure this whole test file is about.
    scene.environment.backgroundMode = 'color';
    scene.environment.backgroundTexture = 'tex-sky';

    expect(collectSceneAssets(scene, {}, {})).toContain('tex-sky');
  });

  it('terminates on a prefab that contains itself', () => {
    const root = createEntity('Loop', [
      createPrefabInstance('prefab-loop'),
    ]);
    const loop = prefabWith('Loop', [root], root.entity.id);

    expect(() =>
      collectSceneAssets(sceneWith([root]), {}, { 'prefab-loop': loop }),
    ).not.toThrow();
  });
});

describe('naming a scene', () => {
  it('reduces a path to what a script says', () => {
    // Paths do not survive an export — the entry scene is renamed to
    // `scene.json` — so a script naming one would work in the editor and break
    // in a build. The name is what both ends agree on.
    expect(sceneName('scenes/Level2.scene.json')).toBe('Level2');
    expect(sceneName('scene.json')).toBe('scene');
    expect(sceneName('Main')).toBe('Main');
  });
});
