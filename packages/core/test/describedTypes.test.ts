import { describe, expect, it } from 'vitest';
import {
  audioListenerType,
  cameraType,
  componentAssets,
  createCamera,
  createEntity,
  createLight,
  deserializeScene,
  findComponent,
  fixedId,
  insertEntity,
  lightType,
  playerControllerType,
  rigidbodyType,
  serializeScene,
  type ComponentDoc,
  type ComponentType,
  type EntityId,
  type LightKind,
} from '../src/index';
import { sceneWith } from './fixtures';
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
