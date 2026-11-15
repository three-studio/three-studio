import { describe, expect, it } from 'vitest';
import {
  assertDefined,
  audioListenerType,
  cameraType,
  componentAssets,
  componentEntities,
  createCamera,
  createEntity,
  createGeometry,
  createLight,
  createLightEntity,
  createMaterial,
  createMeshComponent,
  createPrefabInstance,
  deserializeScene,
  expandPrefabs,
  findComponent,
  findMissingEntities,
  fixedId,
  insertEntity,
  instancedId,
  lightType,
  materialAssets,
  meshType,
  playerControllerType,
  rigidbodyType,
  serializeScene,
  waterType,
  type ComponentDoc,
  type ComponentType,
  type EntityId,
  type GeometryKind,
  type LightKind,
  type WaterSun,
} from '../src/index';
import { prefabWith, sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The kernel's types described by their fields: each one's blank component,
 * decoder and references now come from its schema, and nothing about the data
 * moved but what the format meant to move — a rigid body's locks are named
 * axes. Each factory's values as they were written out by hand before, so that
 * a new component starts exactly where it did.
 */

/** What every new component of these types held before its type was a schema, but its id. */
const BEFORE = {
  camera: { type: 'camera', projection: 'perspective', fov: 60, near: 0.1, far: 2000, frustumSize: 10, isMain: false },
  audioListener: { type: 'audioListener', masterVolume: 1 },
  playerController: {
    type: 'playerController',
    mode: 'fps',
    moveSpeed: 6,
    sprintMultiplier: 1.8,
    jumpHeight: 1.2,
    maxSlope: (50 * Math.PI) / 180,
    stepHeight: 0.4,
    mouseSensitivity: 0.0022,
    eyeHeight: 1.6,
    cameraDistance: 5,
    fov: 70,
    touchControls: 'auto',
    touchLookSpeed: 2.5,
  },
  rigidbody: {
    type: 'rigidbody',
    bodyType: 'dynamic',
    mass: 1,
    linearDamping: 0,
    angularDamping: 0.05,
    gravityScale: 1,
    ccd: false,
    interpolate: true,
    // Named axes where they were a tuple: the format's one change for this type.
    lockPosition: { x: false, y: false, z: false },
    lockRotation: { x: false, y: false, z: false },
  },
} as const;

/** A light of each kind, as `createLight` made it: the kind decides its intensity and whether it casts. */
const LIGHTS: readonly [LightKind, number, boolean][] = [
  ['ambient', 0.4, false],
  ['hemisphere', 0.8, false],
  ['directional', 2, true],
  ['point', 12, true],
  ['spot', 20, true],
  ['rectArea', 40, false],
  ['projector', 20, true],
];

const SHADOW = { bias: 0, normalBias: 0, radius: 1, blurSamples: 8, near: 0.5, far: 500, orthoSize: 5, focus: 1 };

describe('a new component of a type described by its fields', () => {
  it.each([
    ['camera', cameraType.create()],
    ['audioListener', audioListenerType.create()],
    ['playerController', playerControllerType.create()],
    ['rigidbody', rigidbodyType.create()],
  ] satisfies [keyof typeof BEFORE, ComponentDoc][])('%s starts as its factory made it', (type, made) => {
    expect(made).toEqual({ id: expect.any(String), ...BEFORE[type] });
  });

  it('is a camera of the projection asked for', () => {
    expect(createCamera('orthographic')).toEqual({ id: expect.any(String), ...BEFORE.camera, projection: 'orthographic' });
  });

  it.each(LIGHTS)('is a %s light at its own intensity, casting where it can', (kind, intensity, castShadow) => {
    expect(createLight(kind)).toEqual({
      id: expect.any(String),
      type: 'light',
      kind,
      color: '#ffffff',
      intensity,
      groundColor: '#4a4436',
      distance: 0,
      decay: 2,
      angle: Math.PI / 6,
      penumbra: 0.2,
      width: 1,
      height: 1,
      mapId: null,
      aspect: 0,
      castShadow,
      shadow: SHADOW,
    });
  });

  it('is a point light when nothing says which kind', () => {
    expect(lightType.create()).toMatchObject({ kind: 'point', intensity: 12, castShadow: true });
  });

  it('is at version 1, each type', () => {
    expect([cameraType, audioListenerType, playerControllerType, rigidbodyType, lightType].map((type) => type.version)).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });

  it('is a fresh value each time: no two share a vector or an object', () => {
    const one = rigidbodyType.create();
    const two = rigidbodyType.create();

    expect(one.lockPosition).not.toBe(two.lockPosition);
    expect(createLight('spot').shadow).not.toBe(createLight('spot').shadow);
  });
});

/** A scene holding one component of each of the five, every field away from its default. */
function heldScene(): { json: string; held: ComponentDoc[]; entityId: EntityId } {
  const held: ComponentDoc[] = [
    { ...createCamera('orthographic'), fov: 45, frustumSize: 7, isMain: true },
    { ...audioListenerType.create(), masterVolume: 0.25 },
    { ...playerControllerType.create(), mode: 'tps', maxSlope: 0.5, touchControls: 'never', cameraDistance: 9 },
    {
      ...rigidbodyType.create(),
      bodyType: 'kinematicPosition',
      mass: 3,
      lockPosition: { x: true, y: false, z: true },
      lockRotation: { x: false, y: true, z: false },
    },
    {
      ...createLight('projector'),
      mapId: fixedId('asset', 'cookie'),
      angle: 0.3,
      shadow: { ...SHADOW, bias: -0.0005, focus: 2 },
    },
  ];
  const template = createEntity('Rig', held);
  return { json: serializeScene(registries, sceneWith([template])), held, entityId: template.entity.id };
}

describe('a component of a type described by its fields, through a file', () => {
  it('comes back equal, each of the five', () => {
    const { json, held, entityId } = heldScene();
    const scene = deserializeScene(registries, json);

    for (const component of held) {
      expect(findComponent(scene, entityId, component.type)).toEqual(component);
    }
    expect(serializeScene(registries, scene)).toBe(json);
  });

  it.each([
    ['camera', 'projection', 'fisheye', 'one of "perspective", "orthographic"'],
    ['audioListener', 'masterVolume', 'loud', 'a finite number'],
    ['playerController', 'touchControls', 'sometimes', 'one of "auto", "always", "never"'],
    ['rigidbody', 'lockPosition', [true, false, true], 'an object'],
    ['light', 'mapId', '', 'an asset id or null'],
  ] satisfies [ComponentType, string, unknown, string][])(
    'refuses its scene when a %s\'s %s is malformed, naming where',
    (type, field, value, expected) => {
      const { json, entityId } = heldScene();
      const file = JSON.parse(json);
      const [componentId] = Object.keys(file.components[type][entityId]);
      file.components[type][entityId][componentId ?? ''][field] = value;

      expect(() => deserializeScene(registries, JSON.stringify(file))).toThrow(
        `components.${type}.${entityId}.${componentId}.${field}: expected ${expected}`,
      );
    },
  );

  it('refuses a nested field where it sits: a light\'s shadow, a body\'s lock', () => {
    const { json, entityId } = heldScene();
    const file = JSON.parse(json);
    const [lightId] = Object.keys(file.components.light[entityId]);
    const [bodyId] = Object.keys(file.components.rigidbody[entityId]);
    file.components.light[entityId][lightId ?? ''].shadow.bias = 'sharp';
    delete file.components.rigidbody[entityId][bodyId ?? ''].lockRotation.y;

    const refusal = (): unknown => deserializeScene(registries, JSON.stringify(file));
    expect(refusal).toThrow(`components.light.${entityId}.${lightId}.shadow.bias: expected a finite number, found "sharp"`);
    expect(refusal).toThrow(`components.rigidbody.${entityId}.${bodyId}.lockRotation.y: is missing`);
  });
});

describe('the assets a component of these types names', () => {
  it('is a light\'s cookie, and none for the four others', () => {
    const cookie = fixedId('asset', 'cookie');
    const { held } = heldScene();

    expect(held.map((component) => componentAssets(registries, component))).toEqual([[], [], [], [], [cookie]]);
    expect(componentAssets(registries, createLight('point'))).toEqual([null]);
  });

  it('is read from a scene too', () => {
    const scene = sceneWith([]);
    const lamp = createEntity('Lamp', [{ ...createLight('projector'), mapId: fixedId('asset', 'cookie') }]);
    insertEntity(scene, lamp);

    expect(componentAssets(registries, findComponent(scene, lamp.entity.id, 'light') ?? createLight('point'))).toEqual([
      fixedId('asset', 'cookie'),
    ]);
  });
});

// ------------------------------------------------------------- mesh and water

/** Each primitive as `createGeometry` made it, but its kind. */
const PRIMITIVES = {
  box: { width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
  sphere: { radius: 0.5, widthSegments: 32, heightSegments: 16 },
  plane: { width: 10, height: 10, widthSegments: 1, heightSegments: 1 },
  capsule: { radius: 0.5, height: 1, capSegments: 8, radialSegments: 16 },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 24 },
  circle: { radius: 0.5, segments: 32 },
  ring: { innerRadius: 0.25, outerRadius: 0.5, thetaSegments: 32 },
  torus: { radius: 0.4, tube: 0.15, radialSegments: 16, tubularSegments: 48 },
  torusKnot: { radius: 0.4, tube: 0.12, tubularSegments: 96, radialSegments: 16, p: 2, q: 3 },
  tetrahedron: { radius: 0.5, detail: 0 },
  octahedron: { radius: 0.5, detail: 0 },
  dodecahedron: { radius: 0.5, detail: 0 },
  icosahedron: { radius: 0.5, detail: 0 },
} as const satisfies Record<GeometryKind, object>;

/** The material every new mesh draws with, as `createMaterial` made it. */
const MATERIAL = {
  color: '#b7b7b7',
  roughness: 0.75,
  metalness: 0,
  emissive: '#000000',
  emissiveIntensity: 1,
  opacity: 1,
  transparent: false,
  wireframe: false,
  side: 'front',
  colorMap: null,
  normalMap: null,
  normalScale: 1,
  bumpMap: null,
  bumpScale: 1,
  roughnessMap: null,
  metalnessMap: null,
  emissiveMap: null,
  aoMap: null,
  aoIntensity: 1,
  alphaMap: null,
  displacementMap: null,
  displacementScale: 0.1,
  displacementBias: 0,
  tiling: [1, 1],
  offset: [0, 0],
  wrap: 'repeat',
} as const;

describe('a mesh', () => {
  it('starts as a cube of the default material, casting and receiving shadows', () => {
    expect(meshType.create()).toEqual({
      id: expect.any(String),
      type: 'mesh',
      castShadow: true,
      receiveShadow: true,
      geometry: { kind: 'box', ...PRIMITIVES.box },
      materialId: null,
      material: MATERIAL,
    });
    expect(createMaterial()).toEqual(MATERIAL);
    expect(createMaterial('#ff0000')).toEqual({ ...MATERIAL, color: '#ff0000' });
  });

  it.each(Object.entries(PRIMITIVES))('is a %s at the measures it had', (kind, measures) => {
    const geometry: unknown = { kind, ...measures };

    expect(createMeshComponent(isKind(kind)).geometry).toEqual(geometry);
    expect(createGeometry(isKind(kind))).toEqual(geometry);
  });

  it('names its material asset, then each map of its own material, in the order they were named', () => {
    const [shared, color, ao, height] = [
      fixedId('asset', 'shared'),
      fixedId('asset', 'color'),
      fixedId('asset', 'ao'),
      fixedId('asset', 'height'),
    ];
    const mesh = {
      ...meshType.create(),
      materialId: shared,
      material: { ...createMaterial(), colorMap: color, aoMap: ao, displacementMap: height },
    };

    expect(componentAssets(registries, mesh)).toEqual([shared, color, null, null, null, null, null, ao, null, height]);
    expect(materialAssets(mesh.material)).toEqual(componentAssets(registries, mesh).slice(1));
  });

  it('comes back from a file equal, its primitive and its material whole', () => {
    const mesh = { ...createMeshComponent('torusKnot'), materialId: fixedId('asset', 'shared'), castShadow: false };
    const template = createEntity('Knot', [mesh]);
    const json = serializeScene(registries, sceneWith([template]));

    expect(findComponent(deserializeScene(registries, json), template.entity.id, 'mesh')).toEqual(mesh);
  });

  it('refuses a primitive this build does not know, and a malformed material, naming where', () => {
    const template = createEntity('Cube', [createMeshComponent('box')]);
    const file = JSON.parse(serializeScene(registries, sceneWith([template])));
    const [id] = Object.keys(file.components.mesh[template.entity.id]);
    const stored = file.components.mesh[template.entity.id][id ?? ''];
    stored.geometry = { kind: 'teapot' };
    stored.material.side = 'inside';

    const refusal = (): unknown => deserializeScene(registries, JSON.stringify(file));
    expect(refusal).toThrow(`components.mesh.${template.entity.id}.${id}.geometry.kind: expected one of "box", "sphere"`);
    expect(refusal).toThrow(`components.mesh.${template.entity.id}.${id}.material.side: expected one of "front", "back", "double"`);
  });

  it('is at version 1', () => {
    expect([meshType.version, waterType.version]).toEqual([1, 1]);
  });
});

describe('a water surface', () => {
  it('starts as it did, lit by the sky', () => {
    expect(waterType.create()).toEqual({
      id: expect.any(String),
      type: 'water',
      geometry: { kind: 'plane', width: 50, height: 50, widthSegments: 1, heightSegments: 1 },
      normalMapId: null,
      waterColor: '#7f7f7f',
      alpha: 1,
      size: 1,
      speed: 1,
      direction: 0,
      choppiness: 1.5,
      distortionScale: 20,
      sun: { kind: 'sky' },
      resolutionScale: 0.5,
      side: 'front',
      fog: false,
    });
  });

  it('comes back from a file equal, whichever sun lights it', () => {
    const lamp = createLightEntity('directional');
    const suns: WaterSun[] = [
      { kind: 'sky' },
      { kind: 'light', entity: lamp.entity.id },
      { kind: 'custom', direction: [0, 1, 0], color: '#ffeedd' },
    ];
    for (const sun of suns) {
      const pond = createEntity('Pond', [{ ...waterType.create(), sun: structuredClone(sun) }]);
      const json = serializeScene(registries, sceneWith([lamp, pond]));

      expect(findComponent(deserializeScene(registries, json), pond.entity.id, 'water')?.sun).toEqual(sun);
    }
  });

  it('names the light it is lit by, as a reference to an entity', () => {
    const lamp = createLightEntity('directional');
    const lit = { ...waterType.create(), sun: { kind: 'light', entity: lamp.entity.id } } as const;

    expect(componentEntities(registries, lit)).toEqual([lamp.entity.id]);
    expect(componentEntities(registries, waterType.create())).toEqual([]);
    expect(componentAssets(registries, { ...lit, normalMapId: fixedId('asset', 'ripples') })).toEqual([
      fixedId('asset', 'ripples'),
    ]);
  });

  it('is marked when the light it is lit by is gone', () => {
    const lamp = createLightEntity('directional');
    const pond = createEntity('Pond', [{ ...waterType.create(), sun: { kind: 'light', entity: lamp.entity.id } }]);

    expect(findMissingEntities(registries, sceneWith([lamp, pond]))).toEqual([]);
    expect(findMissingEntities(registries, sceneWith([pond]))).toEqual([{ entityId: pond.entity.id, type: 'water' }]);
  });

  it('names, in a prefab\'s instance, the copy of the light it is lit by', () => {
    const lamp = createLightEntity('directional');
    const pond = createEntity('Pond', [{ ...waterType.create(), sun: { kind: 'light', entity: lamp.entity.id } }]);
    lamp.entity.children = [pond.entity.id];
    pond.entity.parent = lamp.entity.id;
    const prefab = prefabWith('Lit pond', [lamp, pond], lamp.entity.id);
    const PREFAB = fixedId('asset', 'lit-pond');
    const host = createEntity('Lit pond', [createPrefabInstance(PREFAB)]);

    const { scene } = expandPrefabs(registries, sceneWith([host]), { get: (id) => (id === PREFAB ? prefab : undefined) });

    expect(findComponent(scene, instancedId(host.entity.id, pond.entity.id), 'water')?.sun).toEqual({
      kind: 'light',
      entity: instancedId(host.entity.id, lamp.entity.id),
    });
  });

  it('refuses a sun of a kind this build does not know, and a light named by no id', () => {
    const pond = createEntity('Pond', [waterType.create()]);
    const file = JSON.parse(serializeScene(registries, sceneWith([pond])));
    const [id] = Object.keys(file.components.water[pond.entity.id]);
    const where = `components.water.${pond.entity.id}.${id}.sun`;

    file.components.water[pond.entity.id][id ?? ''].sun = { kind: 'moon' };
    expect(() => deserializeScene(registries, JSON.stringify(file))).toThrow(`${where}.kind: expected one of "sky", "light", "custom"`);
    file.components.water[pond.entity.id][id ?? ''].sun = { kind: 'light', entity: '' };
    expect(() => deserializeScene(registries, JSON.stringify(file))).toThrow(`${where}.entity: expected an entity id or null`);
  });
});

/** A primitive's kind, from a key of `PRIMITIVES`. */
function isKind(kind: string): GeometryKind {
  const known = Object.keys(PRIMITIVES).find((key): key is GeometryKind => key === kind);
  return assertDefined(known, `the primitive ${kind}`);
}
