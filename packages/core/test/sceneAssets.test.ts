import {
  assertDefined,
  collectSceneAssets,
  createComponent,
  createEmptyScene,
  deserializeScene,
  emptyComponentTables,
  fixedId,
  setComponentsOf,
  serializeScene,
  unknownComponentTypes,
  createEntity,
  createPrefabInstance,
  createMaterial,
  createMeshEntity,
  findComponent,
  sceneName,
  type AssetId,
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

const MAT = fixedId('asset', 'mat-1');
const MODEL = fixedId('asset', 'model-1');
const TEX_INLINE = fixedId('asset', 'tex-inline');
const TEX_SHARED = fixedId('asset', 'tex-shared');
const MODEL_LAMP = fixedId('asset', 'model-lamp');
const PREFAB_LAMP = fixedId('asset', 'prefab-lamp');
const PREFAB_ROOM = fixedId('asset', 'prefab-room');
const PREFAB_LOOP = fixedId('asset', 'prefab-loop');
const TEX_SKY = fixedId('asset', 'tex-sky');
const TEX_IBL = fixedId('asset', 'tex-ibl');
const SCRIPT_DOOR = fixedId('asset', 'script-door');
const TEX_DOOR = fixedId('asset', 'tex-door');
const MAT_DOOR = fixedId('asset', 'mat-door');
const TEX_WOOD = fixedId('asset', 'tex-wood');

function sceneWith(templates: EntityTemplate[]): SceneDoc {
  const scene: SceneDoc = {
    version: 1,
    id: fixedId('scene', 'scene'),
    name: 'Main',
    entities: new Map(templates.map(({ entity }) => [entity.id, entity])),
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
    const model = createEntity('Tree', [{ ...createComponent('model'), assetId: MODEL }]);
    const scene = sceneWith([mesh, model]);
    const component = assertDefined(findComponent(scene, mesh.entity.id, 'mesh'), 'the box mesh');
    component.material.colorMap = TEX_INLINE;
    component.materialId = MAT;

    const ids = collectSceneAssets(
      scene,
      new Map([[MAT, { ...createMaterial(), normalMap: TEX_SHARED }]]),
      new Map(),
    );

    // The shared material's normal map is named by nothing in the scene; miss
    // it and the level pops in a frame late, textureless.
    expect(ids.sort()).toEqual([MAT, MODEL, TEX_INLINE, TEX_SHARED].sort());
  });

  it('follows a prefab into its contents, and through a nested one', () => {
    const inner = createEntity('Lamp', [{ ...createComponent('model'), assetId: MODEL_LAMP }]);
    const lamp = prefabWith('Lamp', [inner], inner.entity.id);

    const roomRoot = createEntity('Room', [
      createPrefabInstance(PREFAB_LAMP),
    ]);
    const room = prefabWith('Room', [roomRoot], roomRoot.entity.id);

    const host = createEntity('Room', [
      createPrefabInstance(PREFAB_ROOM),
    ]);

    const ids = collectSceneAssets(
      sceneWith([host]),
      new Map(),
      new Map([
        [PREFAB_LAMP, lamp],
        [PREFAB_ROOM, room],
      ]),
    );

    // One id in the scene, a model two prefabs down: the instance is what the
    // author placed, and the wait is the lamp.
    expect(ids).toContain(MODEL_LAMP);
  });

  it('collects the sky and the light it casts, which belong to no entity', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    scene.environment.backgroundMode = 'texture';
    scene.environment.backgroundTexture = TEX_SKY;
    scene.environment.environmentTexture = TEX_IBL;

    const ids = collectSceneAssets(scene, new Map(), new Map());

    // The walk this used to be went over the component tables only, and the
    // environment is a property of the scene. So the heaviest file in the
    // project — an equirectangular HDR is megabytes where a prop is kilobytes —
    // was the one asset the exporter did not ship and the loading bar did not
    // count, and the build came up with no sky and every surface unlit.
    expect(ids).toContain(TEX_SKY);
    expect(ids).toContain(TEX_IBL);
  });

  it('leaves out a background texture the scene is not showing', () => {
    const scene = sceneWith([createMeshEntity('box')]);
    // `background` keeps its texture when the mode goes back to colour, so that
    // switching back does not lose the choice. It still has to ship: switching
    // the mode in a built game is a supported thing to do, and an id that
    // resolves to nothing is the failure this whole test file is about.
    scene.environment.backgroundMode = 'color';
    scene.environment.backgroundTexture = TEX_SKY;

    expect(collectSceneAssets(scene, new Map(), new Map())).toContain(TEX_SKY);
  });

  it('terminates on a prefab that contains itself', () => {
    const root = createEntity('Loop', [
      createPrefabInstance(PREFAB_LOOP),
    ]);
    const loop = prefabWith('Loop', [root], root.entity.id);

    expect(() =>
      collectSceneAssets(sceneWith([root]), new Map(), new Map([[PREFAB_LOOP, loop]])),
    ).not.toThrow();
  });
});

describe('what a script was handed in the inspector', () => {
  // A script declares its properties in code the main process never runs, so
  // a string there may be an asset, an entity or a sentence. It counts where a
  // project asset answers to it — and it used to count nowhere, so the texture
  // a script was given shipped in no build that did not ship everything.
  const scripted = (props: Record<string, string | number>) =>
    sceneWith([
      createEntity('Door', [
        { ...createComponent('script'), assetId: SCRIPT_DOOR, props },
      ]),
    ]);

  it('counts a property that names a project asset, and leaves a sentence alone', () => {
    const scene = scripted({ texture: 'tex-door', greeting: 'Hello', speed: 3 });
    const known: ReadonlySet<AssetId> = new Set([SCRIPT_DOOR, TEX_DOOR]);

    expect(collectSceneAssets(scene, new Map(), new Map(), known).sort()).toEqual([SCRIPT_DOOR, TEX_DOOR]);
    // Without the project's ids nothing tells the two strings apart, so only
    // the slots that say they hold an asset are read — as a loading bar asks.
    expect(collectSceneAssets(scene, new Map(), new Map())).toEqual([SCRIPT_DOOR]);
  });

  it('follows a material a script was handed to the maps it uses', () => {
    const scene = scripted({ skin: 'mat-door' });
    const known: ReadonlySet<AssetId> = new Set([SCRIPT_DOOR, MAT_DOOR, TEX_WOOD]);
    const materials = new Map([[MAT_DOOR, { ...createMaterial(), colorMap: TEX_WOOD }]]);

    expect(collectSceneAssets(scene, materials, new Map(), known).sort()).toEqual([
      MAT_DOOR,
      SCRIPT_DOOR,
      TEX_WOOD,
    ]);
  });
});

describe('component types this editor does not know', () => {
  it('names them, so an export can say what it could not follow', () => {
    const scene = sceneWith([createEntity('Lamp', [])]);
    // A type no module here defines has no place in a document: it is the file's
    // own table, kept as found, so the scene is read from a file that has one.
    const file = JSON.parse(serializeScene(scene));
    const lamp = assertDefined(Object.keys(file.entities)[0], 'the lamp');
    file.components['plugin.flicker'] = {
      [lamp]: { c1: { id: 'c1', type: 'plugin.flicker', sprite: 'tex-flame' } },
    };

    expect(unknownComponentTypes(deserializeScene(JSON.stringify(file)))).toEqual(['plugin.flicker']);
    expect(unknownComponentTypes(sceneWith([]))).toEqual([]);
  });
});

describe('naming a scene', () => {
  it('reduces a path to what a script says', () => {
    // Paths do not survive an export — a build files every scene under its own
    // id — so a script naming one would work in the editor and break in a
    // build. The name is what both ends agree on, through the manifest's alias
    // table.
    expect(sceneName('scenes/Level2.scene.json')).toBe('Level2');
    expect(sceneName('scene.json')).toBe('scene');
    expect(sceneName('Main')).toBe('Main');
  });
});
