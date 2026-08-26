import {
  SCENE_FORMAT_VERSION,
  createComponent,
  createEnvironment,
  createMeshEntity,
  createSkySettings,
  deserializeScene,
  emptyComponentTables,
  findComponent,
  serializeScene,
  setComponentsOf,
  type MeshComponent,
  type SceneDoc,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * A scene on disk outlives every version of the editor that will open it.
 *
 * The failure is always the same and always silent until it is not: a property
 * added after the file was written arrives as `undefined`, reaches three or a
 * Tweakpane binding, and takes something down. It has already shipped twice —
 * texture slots, then geometry segments. These pin the general fix rather than
 * the two instances.
 */

/**
 * Every stored component of a type, in a raw parsed document.
 *
 * The tests below reach into the JSON as an older editor wrote it, and the
 * components are two levels down now: by entity, then by their own id.
 */
function rawComponents(raw: Record<string, unknown>, type: string): Record<string, unknown>[] {
  const tables = raw['components'] as Record<string, Record<string, Record<string, unknown>>>;
  return Object.values(tables[type] ?? {}).flatMap((held) =>
    Object.values(held as Record<string, Record<string, unknown>>),
  );
}

/** Strips properties from a serialised scene, as an older editor would have. */
function olderScene(strip: (scene: Record<string, unknown>) => void): string {
  const scene = createStarter();
  const raw = JSON.parse(serializeScene(scene)) as Record<string, unknown>;
  strip(raw);
  return JSON.stringify(raw);
}

function createStarter(): SceneDoc {
  const cube = createMeshEntity('box');
  cube.components.push(createComponent('rigidbody'), createComponent('playerController'));
  const components = emptyComponentTables();
  const scene: SceneDoc = {
    version: SCENE_FORMAT_VERSION,
    id: 'scene-1',
    name: 'Main',
    entities: { [cube.entity.id]: cube.entity },
    components,
    rootOrder: [cube.entity.id],
    // From the factory, not written out here. This is a starting point for
    // tests that strip fields back off it, and a literal would need an edit
    // every time the environment gains one — which is precisely the second
    // list of defaults the format rules say nobody keeps in step.
    environment: createEnvironment(),
  };
  setComponentsOf(scene, cube.entity.id, cube.components);
  return scene;
}

function firstMesh(scene: SceneDoc): MeshComponent {
  const entityId = Object.keys(scene.entities)[0]!;
  return findComponent(scene, entityId, 'mesh')!;
}

describe('scene migration', () => {
  it('fills material properties added after the scene was written', () => {
    const json = olderScene((raw) => {
      const mesh = rawComponents(raw, 'mesh')[0]!;
      const material = mesh['material'] as Record<string, unknown>;
      // Everything the material has gained since M4.
      for (const key of ['bumpMap', 'bumpScale', 'displacementMap', 'displacementScale', 'tiling', 'wrap']) {
        delete material[key];
      }
      delete mesh['materialId'];
    });

    const mesh = firstMesh(deserializeScene(json));
    expect(mesh.material.tiling).toEqual([1, 1]);
    expect(mesh.material.bumpScale).toBe(1);
    expect(mesh.material.displacementScale).toBeCloseTo(0.1);
    expect(mesh.materialId).toBeNull();
  });

  it('fills geometry properties added after the scene was written', () => {
    const json = olderScene((raw) => {
      const geometry = rawComponents(raw, 'mesh')[0]!['geometry'] as Record<string, unknown>;
      delete geometry['widthSegments'];
      delete geometry['heightSegments'];
      delete geometry['depthSegments'];
    });

    const mesh = firstMesh(deserializeScene(json));
    expect(mesh.geometry).toMatchObject({ widthSegments: 1, heightSegments: 1, depthSegments: 1 });
  });

  /*
   * The one that matters most, because it is the general case rather than the
   * two we have already been bitten by: any component gaining a property.
   */
  it('fills properties on components other than the mesh', () => {
    const json = olderScene((raw) => {
      for (const component of rawComponents(raw, 'rigidbody')) {
        delete component['gravityScale'];
        delete component['linearDamping'];
      }
      for (const component of rawComponents(raw, 'playerController')) {
        delete component['sprintMultiplier'];
        delete component['eyeHeight'];
      }
    });

    const migrated = deserializeScene(json);
    const entityId = Object.keys(migrated.entities)[0]!;
    const body = findComponent(migrated, entityId, 'rigidbody')!;
    const player = findComponent(migrated, entityId, 'playerController')!;

    expect(body).toMatchObject({ gravityScale: 1, linearDamping: 0 });
    // A missing multiplier would reach the controller as NaN, and a character
    // whose speed is NaN does not move at all.
    expect(player).toMatchObject({ sprintMultiplier: 1.8, eyeHeight: 1.7 });
  });

  it('fills a light of format 4, which had no shadow settings at all', () => {
    /*
     * Written by hand in the old shape rather than by stripping the new one,
     * because that is the shape that actually exists on disk: a format 4 light
     * had `castShadow` and nothing behind it. Every field of `shadow` reaching
     * three as `undefined` is a shadow camera with a `NaN` projection matrix,
     * which renders as the shadow silently vanishing.
     *
     * The kind is the point of the second half. Filling against a fixed kind
     * gave this directional light the point defaults — six times the intensity
     * its author chose.
     */
    const json = olderScene((raw) => {
      raw['version'] = 4;
      const entityId = Object.keys(raw['entities'] as Record<string, unknown>)[0]!;
      const tables = raw['components'] as Record<string, unknown>;
      tables['light'] = {
        [entityId]: {
          'light-1': {
            id: 'light-1',
            type: 'light',
            kind: 'directional',
            color: '#ffffff',
            groundColor: '#4a4436',
            distance: 0,
            decay: 2,
            angle: 0.5,
            penumbra: 0.2,
            castShadow: true,
          },
        },
      };
    });

    const scene = deserializeScene(json);
    const entityId = Object.keys(scene.entities)[0]!;
    const light = findComponent(scene, entityId, 'light')!;

    expect(light.shadow).toEqual({
      bias: 0,
      normalBias: 0,
      radius: 1,
      blurSamples: 8,
      near: 0.5,
      far: 500,
      orthoSize: 5,
      focus: 1,
    });
    expect(light.intensity).toBe(2);
    // Added after this file was written, so they are filled rather than kept.
    expect(light).toMatchObject({ width: 1, height: 1, mapId: null, aspect: 0 });
    // And what the file did say is untouched.
    expect(light).toMatchObject({ kind: 'directional', angle: 0.5, castShadow: true });
  });

  it('fills entity and environment properties', () => {
    const json = olderScene((raw) => {
      const entity = Object.values(raw['entities'] as Record<string, Record<string, unknown>>)[0]!;
      delete entity['locked'];
      delete entity['visible'];
      const environment = raw['environment'] as Record<string, unknown>;
      delete environment['fogFar'];
    });

    const scene = deserializeScene(json);
    const entity = Object.values(scene.entities)[0]!;
    expect(entity.visible).toBe(true);
    expect(entity.locked).toBe(false);
    expect(scene.environment.fogFar).toBe(400);
  });

  /*
   * A format 1 scene, written whole: every environment field the Inspector now
   * edits was added after it, and each one reaching three as `undefined` is a
   * different failure — a black background, an unlit scene, fog that never
   * ends.
   */
  it('fills the environment of a scene written before it had one this rich', () => {
    const json = olderScene((raw) => {
      raw['version'] = 1;
      raw['environment'] = {
        background: '#101418',
        fogEnabled: true,
        fogColor: '#8899aa',
        fogNear: 10,
        fogFar: 120,
      };
    });

    const { environment } = deserializeScene(json);
    expect(environment).toMatchObject({
      backgroundMode: 'color',
      backgroundTexture: null,
      environmentTexture: null,
      environmentIntensity: 1,
      fogMode: 'linear',
    });
    expect(environment.fogDensity).toBeCloseTo(0.01);
    // And what the author did write is still theirs.
    expect(environment).toMatchObject({ background: '#101418', fogNear: 10, fogFar: 120 });
  });

  it('fills the format 6 environment so an older scene renders unchanged', () => {
    // A whole format 5 environment, written by hand as that build wrote it.
    const json = olderScene((raw) => {
      raw['version'] = 5;
      raw['environment'] = {
        backgroundMode: 'texture',
        background: '#101418',
        backgroundTexture: 'tex-sky',
        environmentTexture: 'tex-sky',
        environmentIntensity: 1.4,
        fogEnabled: false,
        fogColor: '#2b2f33',
        fogMode: 'linear',
        fogNear: 30,
        fogFar: 400,
        fogDensity: 0.01,
      };
    });

    const { environment } = deserializeScene(json);

    // Every default is three's own, so the scene draws exactly as it did: no
    // blur, no attenuation, no turn. That is the whole bar a new field on a
    // persisted format has to clear.
    expect(environment).toMatchObject({
      backgroundBlur: 0,
      backgroundIntensity: 1,
      rotation: 0,
    });
    // `texture` rather than `background`: format 5 took its lighting from
    // `environmentTexture` and from nothing else, and `background` would have
    // switched the source under scenes that named two different images.
    expect(environment.environmentMode).toBe('texture');
    expect(environment).toMatchObject({
      backgroundTexture: 'tex-sky',
      environmentTexture: 'tex-sky',
      environmentIntensity: 1.4,
    });
  });

  it('fills the sky a level deeper, which a shallow spread would not', () => {
    // A build that shipped half the sky — the shape a partial write leaves, and
    // the one a shallow `{ ...blank, ...stored }` hands straight through with
    // eight fields missing.
    const json = olderScene((raw) => {
      const environment = raw['environment'] as Record<string, unknown>;
      environment['sky'] = { elevation: 42, turbidity: 8 };
    });

    const { sky } = deserializeScene(json).environment;

    expect(sky.elevation).toBe(42);
    expect(sky.turbidity).toBe(8);
    // And the rest arrives rather than reaching three as `undefined`.
    expect(sky.azimuth).toBe(180);
    expect(sky.rayleigh).toBe(1);
    expect(sky.cloudCoverage).toBeCloseTo(0.4);
    // Added to format 6 after scenes had already been saved as 6, so this is
    // the case that matters: a document written by a build that did not have
    // the field opens with the factory's value rather than `undefined`, which
    // would reach the shader as NaN and stop the clouds dead.
    expect(sky.cloudSpeed).toBeCloseTo(0.0001);
    // Added after the block existed, and a boolean where everything else is a
    // number — so it is the one a shallow merge would leave `undefined`, and
    // `undefined ? 1 : 0` reaches the shader as a sun that quietly went out.
    expect(sky.sunDisc).toBe(true);
    // Nothing left unfilled: `undefined` is neither of these.
    expect(
      Object.values(sky).every((value) => typeof value === 'number' || typeof value === 'boolean'),
    ).toBe(true);
  });

  it('gives a scene with no sky block at all a whole one', () => {
    const json = olderScene((raw) => {
      raw['version'] = 5;
      delete (raw['environment'] as Record<string, unknown>)['sky'];
    });

    expect(deserializeScene(json).environment.sky).toEqual(createSkySettings());
  });

  it('leaves values the scene already had alone', () => {
    const scene = createStarter();
    firstMesh(scene).material.tiling = [4, 2];
    firstMesh(scene).geometry = { kind: 'box', width: 9, height: 1, depth: 9, widthSegments: 32, heightSegments: 1, depthSegments: 32 };

    const migrated = deserializeScene(serializeScene(scene));
    expect(firstMesh(migrated).material.tiling).toEqual([4, 2]);
    expect(firstMesh(migrated).geometry).toMatchObject({ width: 9, widthSegments: 32 });
  });

  /*
   * The migration fills every component against its type's factory. A type
   * this build has never heard of has no factory, and inventing one would
   * write a shape over the author's data the next time the scene is saved.
   */
  it('leaves a component it does not know exactly as it found it', () => {
    // Written as a format-3 document, so it goes through the pass that moves
    // components into the tables — the one place an unknown type could be
    // dropped on the floor.
    const json = olderScene((raw) => {
      raw['version'] = 3;
      const entities = raw['entities'] as Record<string, { components?: unknown[] }>;
      const entity = Object.values(entities)[0]!;
      entity.components = [{ id: 'water-1', type: 'plugin:water', flow: 2, tint: '#0af' }];
      delete raw['components'];
    });

    const migrated = deserializeScene(json);
    const tables = migrated.components as unknown as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    const entityId = Object.keys(migrated.entities)[0]!;
    const kept = tables['plugin:water']?.[entityId]?.['water-1'] ?? {};

    // A table of its own, rather than a shape invented for it: nothing here can
    // read it, and filling it would write that invention over the author's data
    // on the next save.
    expect(kept).toEqual({ id: 'water-1', type: 'plugin:water', flow: 2, tint: '#0af' });
    // The old fallback returned a player controller for anything unrecognised,
    // so this used to come back with a move speed and an eye height.
    expect(kept['moveSpeed']).toBeUndefined();
  });

  it('fills a model of format 6, which drew whole files and nothing else', () => {
    /*
     * Written by hand in the old shape rather than by stripping the new one,
     * because that is the shape actually on disk: a format 6 model had an asset
     * and two shadow flags, and there was no way at all to give it a material.
     */
    const json = JSON.stringify({
      version: 6,
      id: 'scene-1',
      name: 'Main',
      entities: {
        e1: {
          id: 'e1',
          name: 'Chair',
          parent: null,
          children: [],
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          locked: false,
        },
      },
      components: {
        ...emptyComponentTables(),
        model: {
          e1: {
            'e1:0': { id: 'e1:0', type: 'model', assetId: 'chair', castShadow: true, receiveShadow: true },
          },
        },
      },
      rootOrder: ['e1'],
      environment: createEnvironment(),
    });

    const model = findComponent(deserializeScene(json), 'e1', 'model')!;

    // `''` is what "the whole file" has always meant, so the scene draws exactly
    // what it drew — which is the only way to add a field to a persisted format
    // without auditing every project that has one.
    expect(model).toMatchObject({
      assetId: 'chair',
      nodePath: '',
      nodeName: '',
      materialId: null,
    });
  });

  it('stamps the format the document now conforms to', () => {
    // Without this a migrated scene was saved back under its original number,
    // so the "newer editor" guard could never fire however many formats came.
    const json = olderScene((raw) => {
      raw['version'] = 0;
    });
    expect(deserializeScene(json).version).toBe(SCENE_FORMAT_VERSION);
  });

  it('refuses a scene written by a newer editor rather than mangling it', () => {
    const json = JSON.stringify({ ...createStarter(), version: SCENE_FORMAT_VERSION + 1 });
    expect(() => deserializeScene(json)).toThrow(/newer version/);
  });
});
