import {
  assertDefined,
  audioListenerType,
  audioSourceType,
  colliderType,
  createCamera,
  createColliderShape,
  createJointMotion,
  createLight,
  createLightEntity,
  createMeshComponent,
  createPrefabInstance,
  fixedId,
  jointType,
  modelType,
  playerControllerType,
  rigidbodyType,
  scriptType,
  waterType,
  type ColliderComponent,
  type ColliderShapeKind,
  type ComponentDoc,
  type GeometryKind,
  type JointKind,
  type LightKind,
  type WaterComponent,
} from '@three-studio/core';
import { Behaviour, NO_SCRIPTS, type ScriptProperties } from '@three-studio/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { isSeparator, type FieldSpec } from '../src/inspector/fields';
import { paneEntriesFor } from '../src/inspector/panes';
import { SCENE_SCHEMA } from '../src/inspector/schema';
import { useDocumentStore } from '../src/state/documentStore';
import { useScriptStore } from '../src/state/scriptStore';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/** A physics material's combine rules, as the pane offers them. */
const RULES = [
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'max', label: 'Maximum' },
];

/*
 * The panes of the kernel's types described by their fields, derived, row for
 * row what each type's pane was when written by hand — labels, ranges,
 * order, rules — and showing the same rows for each kind or mode that changed
 * them. Taken from the hand-written panes before they went, through JSON,
 * which keeps what a row declares and drops its functions.
 *
 * One change, the format's: a rigid body's locks are named axes, so their rows
 * are read at `x`, `y`, `z` where they were read at `0`, `1`, `2`.
 */

/**
 * The rows a component's pane declares, without their functions, and without
 * `tunable`: written by hand, that was the pane's `live`, and `tunable` below
 * reads it row by row.
 */
function rows(component: ComponentDoc): unknown {
  const entries = paneEntriesFor(registries, component).entries;
  return JSON.parse(JSON.stringify(entries, (key: string, value: unknown) => (key === 'tunable' ? undefined : value)));
}

/** The labels of the rows a component shows, a rule as `—`. */
function shown(component: ComponentDoc): string[] {
  return paneEntriesFor(registries, component).entries.flatMap((entry) => {
    if (isSeparator(entry)) return ['—'];
    if (entry.visibleWhen && !entry.visibleWhen(component)) return [];
    return ['path' in entry ? entry.label : entry.title];
  });
}

/** How many field rows a component's pane gives, and how many of them tune the running game in Play. */
function tunable(component: ComponentDoc): { rows: number; tunable: number } {
  const fields = paneEntriesFor(registries, component).entries.flatMap((entry) => ('path' in entry ? [entry] : []));
  return { rows: fields.length, tunable: fields.filter((field) => field.tunable === true).length };
}

function row(component: ComponentDoc, field: string): FieldSpec {
  const found = paneEntriesFor(registries, component).entries.find(
    (entry): entry is FieldSpec => 'path' in entry && entry.path.join('.') === field,
  );
  return assertDefined(found, `the row of ${field}`);
}

describe('the camera\'s pane', () => {
  it('is what was written by hand', () => {
    expect(rows(createCamera())).toEqual([
      { path: ['projection'], label: 'Projection', type: 'enum', options: [{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }] },
      { path: ['fov'], label: 'Field of view', type: 'number', min: 10, max: 130, step: 1 },
      { path: ['frustumSize'], label: 'Size', type: 'number', min: 0.1, step: 0.5 },
      { path: ['near'], label: 'Near', type: 'number', min: 0.001, step: 0.01 },
      { path: ['far'], label: 'Far', type: 'number', min: 1, step: 10 },
      { path: ['isMain'], label: 'Main camera' },
    ]);
  });

  it('shows the field of view for a perspective, the size for an orthographic', () => {
    expect(shown(createCamera('perspective'))).toEqual(['Projection', 'Field of view', 'Near', 'Far', 'Main camera']);
    expect(shown(createCamera('orthographic'))).toEqual(['Projection', 'Size', 'Near', 'Far', 'Main camera']);
  });
});

describe('the audio listener\'s pane', () => {
  it('is what was written by hand', () => {
    expect(rows(audioListenerType.create())).toEqual([
      { path: ['masterVolume'], label: 'Master volume', type: 'number', min: 0, max: 1, step: 0.01 },
    ]);
  });
});

describe('the player controller\'s pane', () => {
  it('is what was written by hand', () => {
    expect(rows(playerControllerType.create())).toEqual([
      { path: ['mode'], label: 'Mode', type: 'enum', options: [{ value: 'fps', label: 'FPS' }, { value: 'tps', label: 'TPS' }, { value: 'fly', label: 'Fly' }] },
      { path: ['moveSpeed'], label: 'Move speed', type: 'number', min: 0.1, max: 40, step: 0.1 },
      { path: ['sprintMultiplier'], label: 'Sprint ×', type: 'number', min: 1, max: 5, step: 0.1 },
      { path: ['jumpHeight'], label: 'Jump height', type: 'number', min: 0, max: 10, step: 0.1 },
      { path: ['maxSlope'], label: 'Max slope', type: 'number', min: 0, max: 89, step: 1 },
      { path: ['stepHeight'], label: 'Step height', type: 'number', min: 0, max: 2, step: 0.05 },
      { path: ['mouseSensitivity'], label: 'Mouse sensitivity', type: 'number', min: 0.0002, max: 0.01, step: 0.0001 },
      { path: ['eyeHeight'], label: 'Eye height (from feet)', type: 'number', min: 0, max: 4, step: 0.05 },
      { path: ['cameraDistance'], label: 'Camera distance', type: 'number', min: 0.5, max: 25, step: 0.1 },
      { path: ['fov'], label: 'Field of view', type: 'number', min: 30, max: 120, step: 1 },
      { path: ['touchControls'], label: 'Touch controls', type: 'enum', options: [{ value: 'auto', label: 'On first touch' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }] },
      { path: ['touchLookSpeed'], label: 'Touch look speed', type: 'number', min: 0.5, max: 8, step: 0.1 },
    ]);
  });

  const ALWAYS = ['Mode', 'Move speed', 'Sprint ×', 'Jump height'];
  const WALKING = ['Max slope', 'Step height'];
  const LOOKING = ['Mouse sensitivity', 'Eye height (from feet)'];

  it.each([
    ['fps', 'auto', [...ALWAYS, ...WALKING, ...LOOKING, 'Field of view', 'Touch controls', 'Touch look speed']],
    ['fps', 'never', [...ALWAYS, ...WALKING, ...LOOKING, 'Field of view', 'Touch controls']],
    ['tps', 'auto', [...ALWAYS, ...WALKING, ...LOOKING, 'Camera distance', 'Field of view', 'Touch controls', 'Touch look speed']],
    ['tps', 'never', [...ALWAYS, ...WALKING, ...LOOKING, 'Camera distance', 'Field of view', 'Touch controls']],
    ['fly', 'auto', [...ALWAYS, ...LOOKING, 'Field of view', 'Touch controls', 'Touch look speed']],
    ['fly', 'never', [...ALWAYS, ...LOOKING, 'Field of view', 'Touch controls']],
  ] as const)('shows in %s mode, touch controls %s, the rows it did', (mode, touchControls, labels) => {
    expect(shown({ ...playerControllerType.create(), mode, touchControls })).toEqual(labels);
  });

  it('shows the max slope in degrees, and stores it in radians', () => {
    const slope = row(playerControllerType.create(), 'maxSlope');

    expect(slope.toModel?.(Math.PI / 4)).toBeCloseTo(45);
    expect(slope.fromModel?.(30)).toBeCloseTo(Math.PI / 6);
  });
});

describe('the rigid body\'s pane', () => {
  const LOCKS = ['Lock position X', 'Lock position Y', 'Lock position Z', 'Lock rotation X', 'Lock rotation Y', 'Lock rotation Z'];

  it('is what was written by hand, its locks read by axis', () => {
    expect(rows(rigidbodyType.create())).toEqual([
      { path: ['bodyType'], label: 'Type', type: 'enum', options: [{ value: 'dynamic', label: 'Dynamic' }, { value: 'fixed', label: 'Fixed' }, { value: 'kinematicPosition', label: 'Kinematic' }] },
      { path: ['mass'], label: 'Mass', type: 'number', min: 0.001, step: 0.1 },
      { path: ['linearDamping'], label: 'Linear damping', type: 'number', min: 0, max: 10, step: 0.01 },
      { path: ['angularDamping'], label: 'Angular damping', type: 'number', min: 0, max: 10, step: 0.01 },
      { path: ['gravityScale'], label: 'Gravity scale', type: 'number', min: -5, max: 5, step: 0.1 },
      { path: ['ccd'], label: 'Continuous detection' },
      { path: ['interpolate'], label: 'Interpolate' },
      { path: ['lockPosition', 'x'], label: 'Lock position X' },
      { path: ['lockPosition', 'y'], label: 'Lock position Y' },
      { path: ['lockPosition', 'z'], label: 'Lock position Z' },
      { path: ['lockRotation', 'x'], label: 'Lock rotation X' },
      { path: ['lockRotation', 'y'], label: 'Lock rotation Y' },
      { path: ['lockRotation', 'z'], label: 'Lock rotation Z' },
    ]);
  });

  it.each([
    ['dynamic', ['Interpolate', ...LOCKS]],
    ['fixed', []],
    ['kinematicPosition', []],
  ] as const)('shows for a %s body the rows only the solver reads: %j', (bodyType, solver) => {
    expect(shown({ ...rigidbodyType.create(), bodyType })).toEqual([
      'Type',
      'Mass',
      'Linear damping',
      'Angular damping',
      'Gravity scale',
      'Continuous detection',
      ...solver,
    ]);
  });

  it('tunes the running game during Play, every row of it, as it did', () => {
    const { rows, tunable: tuning } = tunable(rigidbodyType.create());
    expect(rows).toBeGreaterThan(0);
    expect(tuning).toBe(rows);
    expect(tunable(createCamera())).toMatchObject({ tunable: 0 });
  });
});

describe('the light\'s pane', () => {
  it('is what was written by hand: no row for its kind, and a rule before its shadow', () => {
    expect(rows(createLight('point'))).toEqual([
      { path: ['color'], label: 'Colour' },
      { path: ['intensity'], label: 'Intensity', type: 'number', min: 0, max: 50, step: 0.1 },
      { path: ['groundColor'], label: 'Ground colour' },
      { path: ['distance'], label: 'Range', type: 'number', min: 0, max: 200, step: 0.5 },
      { path: ['decay'], label: 'Decay', type: 'number', min: 0, max: 4, step: 0.1 },
      { path: ['angle'], label: 'Cone angle', type: 'number', min: 1, max: 89, step: 1 },
      { path: ['penumbra'], label: 'Penumbra', type: 'number', min: 0, max: 1, step: 0.01 },
      { path: ['width'], label: 'Width', type: 'number', min: 0.01, max: 50, step: 0.05 },
      { path: ['height'], label: 'Height', type: 'number', min: 0.01, max: 50, step: 0.05 },
      { params: { view: 'asset', assetKind: 'texture' }, path: ['mapId'], label: 'Cookie' },
      { path: ['aspect'], label: 'Aspect (0 = image)', type: 'number', min: 0, max: 4, step: 0.01 },
      { path: ['castShadow'], label: 'Cast shadows' },
      { kind: 'separator' },
      { path: ['shadow', 'bias'], label: 'Bias', type: 'number', min: -0.01, max: 0.01, step: 0.0001 },
      { path: ['shadow', 'normalBias'], label: 'Normal bias', type: 'number', min: 0, max: 0.5, step: 0.001 },
      { path: ['shadow', 'radius'], label: 'Softness', type: 'number', min: 0, max: 25, step: 0.5 },
      { path: ['shadow', 'blurSamples'], label: 'Blur samples', type: 'number', min: 1, max: 32, step: 1 },
      { path: ['shadow', 'near'], label: 'Shadow near', type: 'number', min: 0.001, max: 10, step: 0.01 },
      { path: ['shadow', 'far'], label: 'Shadow far', type: 'number', min: 1, max: 2000, step: 10 },
      { path: ['shadow', 'orthoSize'], label: 'Shadow area', type: 'number', min: 1, max: 200, step: 1 },
      { path: ['shadow', 'focus'], label: 'Shadow focus', type: 'number', min: 0.1, max: 4, step: 0.05 },
    ]);
  });

  const SHADOW = ['Bias', 'Normal bias', 'Softness', 'Blur samples', 'Shadow near', 'Shadow far'];
  const REACH = ['Range', 'Decay'];
  const CONE = ['Cone angle', 'Penumbra'];

  it.each([
    ['ambient', [], []],
    ['hemisphere', ['Ground colour'], []],
    ['directional', ['Cast shadows'], ['Shadow area']],
    ['point', [...REACH, 'Cast shadows'], []],
    ['spot', [...REACH, ...CONE, 'Cast shadows'], ['Shadow focus']],
    ['rectArea', ['Width', 'Height'], []],
    ['projector', [...REACH, ...CONE, 'Cookie', 'Aspect (0 = image)', 'Cast shadows'], ['Shadow focus']],
  ] satisfies [LightKind, string[], string[]][])('shows for a %s light the rows of its kind, and its shadow while it casts one', (kind, own, shadow) => {
    expect(shown({ ...createLight(kind), castShadow: true })).toEqual(['Colour', 'Intensity', ...own, '—', ...SHADOW, ...shadow]);
    expect(shown({ ...createLight(kind), castShadow: false })).toEqual(['Colour', 'Intensity', ...own, '—']);
  });

  it('shows its cone in degrees, and stores it in radians', () => {
    const angle = row(createLight('spot'), 'angle');

    expect(angle.toModel?.(Math.PI / 6)).toBeCloseTo(30);
    expect(angle.fromModel?.(45)).toBeCloseTo(Math.PI / 4);
  });
});

describe('the five types\' panes', () => {
  it('are derived: no pane is registered for them, the rigid body\'s tuning being its fields\'', () => {
    const types = ['camera', 'audioListener', 'playerController', 'light', 'rigidbody'] as const;
    expect(types.map((type) => registries.panes.get(type))).toEqual(types.map(() => undefined));
  });
});

describe('the mesh\'s pane', () => {
  /** The material's rows, as `MATERIAL_FIELDS` wrote them. */
  const MATERIAL_ROWS = [
    { path: ['material', 'color'], label: 'Colour' },
    { path: ['material', 'roughness'], label: 'Roughness', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['material', 'metalness'], label: 'Metalness', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['material', 'emissive'], label: 'Emissive' },
    { path: ['material', 'emissiveIntensity'], label: 'Emissive power', type: 'number', min: 0, max: 20, step: 0.1 },
    { path: ['material', 'opacity'], label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['material', 'transparent'], label: 'Transparent' },
    { path: ['material', 'wireframe'], label: 'Wireframe' },
    { path: ['material', 'side'], label: 'Side', type: 'enum', options: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'double', label: 'Double' }] },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'colorMap'], label: 'Base colour map' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'normalMap'], label: 'Normal map' },
    { path: ['material', 'normalScale'], label: 'Normal strength', type: 'number', min: 0, max: 4, step: 0.05 },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'bumpMap'], label: 'Bump map' },
    { path: ['material', 'bumpScale'], label: 'Bump strength', type: 'number', min: 0, max: 4, step: 0.05 },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'roughnessMap'], label: 'Roughness map' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'metalnessMap'], label: 'Metalness map' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'emissiveMap'], label: 'Emissive map' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'aoMap'], label: 'Occlusion map' },
    { path: ['material', 'aoIntensity'], label: 'Occlusion strength', type: 'number', min: 0, max: 1, step: 0.01 },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'alphaMap'], label: 'Alpha map' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['material', 'displacementMap'], label: 'Displacement map' },
    { path: ['material', 'displacementScale'], label: 'Displacement', type: 'number', min: -2, max: 2, step: 0.01 },
    { path: ['material', 'displacementBias'], label: 'Displacement bias', type: 'number', min: -1, max: 1, step: 0.01 },
    { path: ['material', 'tiling'], label: 'Tiling', type: 'vec2', step: 0.1 },
    { path: ['material', 'offset'], label: 'Offset', type: 'vec2', step: 0.01 },
    { path: ['material', 'wrap'], label: 'Wrap', type: 'enum', options: [{ value: 'repeat', label: 'Repeat' }, { value: 'clamp', label: 'Clamp' }, { value: 'mirror', label: 'Mirror' }] },
  ];

  /** Each primitive's rows, as `GEOMETRY_FIELDS` wrote them: label, minimum, maximum, step. */
  const PRIMITIVE_ROWS: Record<GeometryKind, [string, string, number, number | null, number][]> = {
    box: [
      ['width', 'Width', 0.01, null, 0.1],
      ['height', 'Height', 0.01, null, 0.1],
      ['depth', 'Depth', 0.01, null, 0.1],
      ['widthSegments', 'Segments X', 1, 256, 1],
      ['heightSegments', 'Segments Y', 1, 256, 1],
      ['depthSegments', 'Segments Z', 1, 256, 1],
    ],
    sphere: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['widthSegments', 'Segments U', 3, 128, 1],
      ['heightSegments', 'Segments V', 2, 64, 1],
    ],
    plane: [
      ['width', 'Width', 0.01, null, 0.5],
      ['height', 'Height', 0.01, null, 0.5],
      ['widthSegments', 'Segments X', 1, 512, 1],
      ['heightSegments', 'Segments Y', 1, 512, 1],
    ],
    capsule: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['height', 'Height', 0.01, null, 0.1],
    ],
    cylinder: [
      ['radiusTop', 'Radius top', 0, null, 0.1],
      ['radiusBottom', 'Radius bottom', 0, null, 0.1],
      ['height', 'Height', 0.01, null, 0.1],
    ],
    circle: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['segments', 'Segments', 3, 128, 1],
    ],
    ring: [
      ['innerRadius', 'Inner radius', 0, null, 0.05],
      ['outerRadius', 'Outer radius', 0.01, null, 0.05],
      ['thetaSegments', 'Segments', 3, 128, 1],
    ],
    torus: [
      ['radius', 'Radius', 0.01, null, 0.05],
      ['tube', 'Tube', 0.01, null, 0.02],
      ['radialSegments', 'Segments U', 3, 64, 1],
      ['tubularSegments', 'Segments V', 3, 256, 1],
    ],
    torusKnot: [
      ['radius', 'Radius', 0.01, null, 0.05],
      ['tube', 'Tube', 0.01, null, 0.02],
      ['p', 'Winding P', 1, 20, 1],
      ['q', 'Winding Q', 1, 20, 1],
      ['radialSegments', 'Segments U', 3, 64, 1],
      ['tubularSegments', 'Segments V', 3, 512, 1],
    ],
    tetrahedron: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['detail', 'Subdivisions', 0, 5, 1],
    ],
    octahedron: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['detail', 'Subdivisions', 0, 5, 1],
    ],
    dodecahedron: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['detail', 'Subdivisions', 0, 5, 1],
    ],
    icosahedron: [
      ['radius', 'Radius', 0.01, null, 0.1],
      ['detail', 'Subdivisions', 0, 5, 1],
    ],
  };

  it.each(Object.entries(PRIMITIVE_ROWS))('is, for a %s, what was written by hand, keyed by its primitive', (kind, primitive) => {
    const mesh = createMeshComponent(kindOf(kind));

    expect(rows(mesh)).toEqual([
      { path: ['castShadow'], label: 'Cast shadows' },
      { path: ['receiveShadow'], label: 'Receive shadows' },
      { kind: 'separator' },
      ...primitive.map(([key, label, min, max, step]) => ({
        path: ['geometry', key],
        label,
        type: 'number',
        min,
        ...(max === null ? {} : { max }),
        step,
      })),
      { kind: 'separator' },
      { params: { view: 'asset', assetKind: 'material' }, path: ['materialId'], label: 'Material' },
      { kind: 'action', title: 'Save as Asset…' },
      { kind: 'action', title: 'Make Unique' },
      ...MATERIAL_ROWS,
    ]);
    expect(paneEntriesFor(registries, mesh).key).toBe(`mesh:${kind}`);
  });

  const BOX = ['Cast shadows', 'Receive shadows', '—', 'Width', 'Height', 'Depth', 'Segments X', 'Segments Y', 'Segments Z', '—', 'Material'];
  const LOOK = ['Colour', 'Roughness', 'Metalness', 'Emissive', 'Emissive power', 'Opacity', 'Transparent', 'Wireframe', 'Side'];
  const UV = ['Tiling', 'Offset', 'Wrap'];

  it('shows a map\'s strength once the map is set, and Save or Make Unique by whether the material is shared', () => {
    const map = fixedId('asset', 'map');
    const box = createMeshComponent('box');
    const mapped = { ...box, material: { ...box.material, normalMap: map, bumpMap: map, aoMap: map, displacementMap: map } };
    const MAPS = ['Base colour map', 'Normal map', 'Bump map', 'Roughness map', 'Metalness map', 'Emissive map', 'Occlusion map', 'Alpha map', 'Displacement map'];

    expect(shown(box)).toEqual([...BOX, 'Save as Asset…', ...LOOK, ...MAPS, ...UV]);
    expect(shown({ ...box, materialId: map })).toEqual([...BOX, 'Make Unique', ...LOOK, ...MAPS, ...UV]);
    expect(shown(mapped)).toEqual([
      ...BOX,
      'Save as Asset…',
      ...LOOK,
      'Base colour map',
      'Normal map',
      'Normal strength',
      'Bump map',
      'Bump strength',
      'Roughness map',
      'Metalness map',
      'Emissive map',
      'Occlusion map',
      'Occlusion strength',
      'Alpha map',
      'Displacement map',
      'Displacement',
      'Displacement bias',
      ...UV,
    ]);
  });
});

describe('the water\'s pane', () => {
  const custom: WaterComponent = { ...waterType.create(), sun: { kind: 'custom', direction: [0.70707, 0.70707, 0], color: '#ffffff' } };
  const lamp = createLightEntity('directional');
  const lit: WaterComponent = { ...waterType.create(), sun: { kind: 'light', entity: lamp.entity.id } };

  it('is what was written by hand, its sun one dropdown and the rows of the sun it holds', () => {
    expect(rows(custom)).toEqual([
      { path: ['geometry', 'width'], label: 'Width', type: 'number', min: 0.01, step: 0.5 },
      { path: ['geometry', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.5 },
      { kind: 'separator' },
      { params: { view: 'asset', assetKind: 'texture' }, path: ['normalMapId'], label: 'Normal map' },
      { path: ['waterColor'], label: 'Colour' },
      { path: ['alpha'], label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
      { path: ['size'], label: 'Ripple scale', type: 'number', min: 0.01, max: 20, step: 0.01 },
      { path: ['speed'], label: 'Speed', type: 'number', min: 0, max: 5, step: 0.05 },
      { path: ['direction'], label: 'Direction', type: 'number', min: 0, max: 360, step: 1 },
      { path: ['choppiness'], label: 'Choppiness', type: 'number', min: 0.1, max: 5, step: 0.05 },
      { path: ['distortionScale'], label: 'Distortion', type: 'number', min: 0, max: 100, step: 0.5 },
      { kind: 'separator' },
      { path: ['sun'], label: 'Sun' },
      { path: ['sun', 'direction'], label: 'Sun direction', type: 'vec3' },
      { path: ['sun', 'color'], label: 'Sun colour' },
      { kind: 'separator' },
      { path: ['resolutionScale'], label: 'Reflection quality', type: 'number', min: 0.1, max: 1, step: 0.05 },
      { path: ['side'], label: 'Side', type: 'enum', options: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'double', label: 'Double' }] },
      { path: ['fog'], label: 'Affected by fog' },
    ]);
  });

  const SURFACE = ['Width', 'Height', '—', 'Normal map', 'Colour', 'Opacity', 'Ripple scale', 'Speed', 'Direction', 'Choppiness', 'Distortion', '—', 'Sun'];
  const RENDER = ['—', 'Reflection quality', 'Side', 'Affected by fog'];

  it('shows the sun\'s own direction and colour for a custom sun alone, and keys the pane by the sun', () => {
    expect(shown(waterType.create())).toEqual([...SURFACE, ...RENDER]);
    expect(shown(lit)).toEqual([...SURFACE, ...RENDER]);
    expect(shown(custom)).toEqual([...SURFACE, 'Sun direction', 'Sun colour', ...RENDER]);
    expect([waterType.create(), lit, custom].map((water) => paneEntriesFor(registries, water).key)).toEqual([
      'water:sky',
      'water:light',
      'water:custom',
    ]);
  });

  it('offers the sky, the scene\'s lights and a sun of its own in one dropdown, and writes the one chosen', () => {
    useDocumentStore.getState().replaceScene(sceneWith([lamp]));
    const sun = row(waterType.create(), 'sun');

    expect(sun.optionsProvider?.()).toEqual({ 'Sky (scene sun)': 'sky', 'Directional Light': lamp.entity.id, Custom: 'custom' });
    expect([waterType.create().sun, lit.sun, custom.sun].map((value) => sun.toModel?.(value))).toEqual([
      'sky',
      lamp.entity.id,
      'custom',
    ]);
    expect(sun.fromModel?.('sky')).toEqual({ kind: 'sky' });
    expect(sun.fromModel?.(lamp.entity.id)).toEqual({ kind: 'light', entity: lamp.entity.id });
    // A sun of its own starts from its defaults, whatever it was before.
    expect(sun.fromModel?.('custom')).toEqual({ kind: 'custom', direction: [0.70707, 0.70707, 0], color: '#ffffff' });
  });

  it('shows its direction in degrees, and stores it in radians', () => {
    const direction = row(waterType.create(), 'direction');

    expect(direction.toModel?.(Math.PI)).toBeCloseTo(180);
    expect(direction.fromModel?.(90)).toBeCloseTo(Math.PI / 2);
  });
});

function kindOf(kind: string): GeometryKind {
  const kinds: readonly GeometryKind[] = ['box', 'sphere', 'plane', 'capsule', 'cylinder', 'circle', 'ring', 'torus', 'torusKnot', 'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron'];
  return assertDefined(kinds.find((known) => known === kind), `the primitive ${kind}`);
}

describe('the collider\'s pane', () => {
  const MATERIAL_ROWS = [
    { path: ['material', 'friction'], label: 'Friction', type: 'number', min: 0, max: 2, step: 0.01 },
    { path: ['material', 'frictionCombine'], label: 'Friction combine', type: 'enum', options: RULES },
    { path: ['material', 'restitution'], label: 'Bounciness', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['material', 'restitutionCombine'], label: 'Bounce combine', type: 'enum', options: RULES },
  ];
  const SHAPE_ROWS: Record<ColliderShapeKind, unknown[]> = {
    box: [
      { path: ['shape', 'size'], label: 'Size', type: 'vec3', min: 0.01, step: 0.1 },
      { path: ['shape', 'rounding'], label: 'Rounding', type: 'number', min: 0, step: 0.01 },
      { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 },
      { path: ['shape', 'rotation'], label: 'Rotation', type: 'vec3', step: 1 },
    ],
    sphere: [
      { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 },
    ],
    capsule: [
      { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 },
      { path: ['shape', 'rotation'], label: 'Rotation', type: 'vec3', step: 1 },
    ],
    cylinder: [
      { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'rounding'], label: 'Rounding', type: 'number', min: 0, step: 0.01 },
      { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 },
      { path: ['shape', 'rotation'], label: 'Rotation', type: 'vec3', step: 1 },
    ],
    cone: [
      { path: ['shape', 'radius'], label: 'Radius', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'height'], label: 'Height', type: 'number', min: 0.01, step: 0.05 },
      { path: ['shape', 'rounding'], label: 'Rounding', type: 'number', min: 0, step: 0.01 },
      { path: ['shape', 'center'], label: 'Center', type: 'vec3', step: 0.05 },
      { path: ['shape', 'rotation'], label: 'Rotation', type: 'vec3', step: 1 },
    ],
    mesh: [
      {
        path: ['shape', 'build'],
        label: 'Build',
        type: 'enum',
        options: [{ value: 'triangles', label: 'Triangles' }, { value: 'hull', label: 'Convex hull' }, { value: 'parts', label: 'Convex parts' }],
      },
    ],
  };
  const collider = (kind: ColliderShapeKind): ColliderComponent => ({ ...colliderType.create(), shape: createColliderShape(kind) });

  it.each(Object.entries(SHAPE_ROWS))('is, for a %s, what was written by hand, keyed by its shape', (kind, shape) => {
    expect(rows(collider(shapeKindOf(kind)))).toEqual([
      {
        path: ['shape'],
        label: 'Shape',
        type: 'enum',
        options: [
          { value: 'box', label: 'Box' },
          { value: 'sphere', label: 'Sphere' },
          { value: 'capsule', label: 'Capsule' },
          { value: 'cylinder', label: 'Cylinder' },
          { value: 'cone', label: 'Cone' },
          { value: 'mesh', label: 'Mesh' },
        ],
      },
      ...shape,
      { kind: 'action', title: 'Fit to Mesh' },
      { path: ['isSensor'], label: 'Is sensor' },
      { path: ['layer'], label: 'Layer' },
      { kind: 'separator' },
      { params: { view: 'asset', assetKind: 'physicsMaterial', emptyLabel: 'Embedded' }, path: ['materialId'], label: 'Material' },
      { kind: 'action', title: 'Save as Asset…' },
      { kind: 'action', title: 'Make Unique' },
      ...MATERIAL_ROWS,
    ]);
    // Then the project's layers, which its Layer row lists: a new project's here.
    expect(paneEntriesFor(registries, collider(shapeKindOf(kind))).key).toBe(`collider:${kind}:default:Default`);
  });

  const AFTER = ['Is sensor', 'Layer', '—', 'Material'];
  const PHYSICS = ['Friction', 'Friction combine', 'Bounciness', 'Bounce combine'];

  it('fits a shape to its mesh but a mesh, and saves or unlinks its material by whether it is shared', () => {
    expect(shown(collider('sphere'))).toEqual(['Shape', 'Radius', 'Center', 'Fit to Mesh', ...AFTER, 'Save as Asset…', ...PHYSICS]);
    expect(shown(collider('mesh'))).toEqual(['Shape', 'Build', ...AFTER, 'Save as Asset…', ...PHYSICS]);
    expect(shown({ ...collider('sphere'), materialId: fixedId('asset', 'ice') })).toEqual([
      'Shape',
      'Radius',
      'Center',
      'Fit to Mesh',
      ...AFTER,
      'Make Unique',
      ...PHYSICS,
    ]);
  });

  it('writes another shape whole, at its own defaults, as one value', () => {
    const shape = row(collider('box'), 'shape');

    expect(shape.toModel?.(createColliderShape('box'))).toBe('box');
    expect(shape.fromModel?.('sphere')).toEqual(createColliderShape('sphere'));
  });

  it('shows its rotation in degrees, offers the project\'s layers, and tunes the running game', () => {
    const rotation = row(collider('box'), 'shape.rotation');

    expect(rotation.toModel?.([Math.PI, 0, Math.PI / 2])).toEqual({ x: 180, y: 0, z: 90 });
    expect(row(collider('box'), 'layer').optionsProvider?.()).toEqual({ Default: 'default' });
    const { rows, tunable: tuning } = tunable(collider('box'));
    expect(tuning).toBe(rows);
  });
});

describe('the joint\'s pane', () => {
  /** The rows every joint shows after its kind's: D44 put a kind's rows right under Type. */
  const AROUND = [
    { path: ['connectedEntity'], label: 'Connected Body', type: 'entity' },
    { path: ['anchor'], label: 'Anchor', type: 'vec3', step: 0.01 },
    { path: ['enableCollision'], label: 'Enable Collision' },
  ];
  const TYPE = {
    path: ['motion'],
    label: 'Type',
    type: 'enum',
    options: [{ value: 'fixed', label: 'Fixed' }, { value: 'hinge', label: 'Hinge' }, { value: 'slider', label: 'Slider' }, { value: 'spring', label: 'Spring' }],
  };
  const MOVING = (min: number | null, step: number, force: string): unknown[] => [
    { path: ['motion', 'axis'], label: 'Axis', type: 'vec3', step: 0.1 },
    { path: ['motion', 'limits', 'enabled'], label: 'Limits' },
    { path: ['motion', 'limits', 'min'], label: 'Min', type: 'number', ...(min === null ? {} : { min }), step },
    { path: ['motion', 'limits', 'max'], label: 'Max', type: 'number', ...(min === null ? {} : { min }), step },
    { path: ['motion', 'motor', 'enabled'], label: 'Motor' },
    { path: ['motion', 'motor', 'speed'], label: 'Speed', type: 'number', step },
    { path: ['motion', 'motor', 'maxForce'], label: force, type: 'number', min: 0, step: 10 },
  ];
  const joint = (kind: JointKind): ComponentDoc => ({ ...jointType.create(), motion: createJointMotion(kind) });

  it.each([
    ['fixed', []],
    ['hinge', MOVING(null, 1, 'Max Torque')],
    ['slider', MOVING(null, 0.1, 'Max Force')],
    [
      'spring',
      [
        { path: ['motion', 'stiffness'], label: 'Stiffness', type: 'number', min: 0, step: 1 },
        { path: ['motion', 'damping'], label: 'Damping', type: 'number', min: 0, step: 0.1 },
      ],
    ],
  ] satisfies [JointKind, unknown[]][])('is, for a %s, what was written by hand, its rows under Type', (kind, own) => {
    expect(rows(joint(kind))).toEqual([TYPE, ...own, ...AROUND]);
    expect(paneEntriesFor(registries, joint(kind)).key).toBe(`joint:${kind}`);
  });

  it('shows the limits and the motor\'s settings while each is on', () => {
    const on = (kind: 'hinge' | 'slider'): ComponentDoc => {
      const motion = createJointMotion(kind);
      return { ...jointType.create(), motion: { ...motion, limits: { ...motion.limits, enabled: true }, motor: { ...motion.motor, enabled: true } } };
    };

    expect(shown(joint('hinge'))).toEqual(['Type', 'Axis', 'Limits', 'Motor', 'Connected Body', 'Anchor', 'Enable Collision']);
    expect(shown(on('hinge'))).toEqual([
      'Type',
      'Axis',
      'Limits',
      'Min',
      'Max',
      'Motor',
      'Speed',
      'Max Torque',
      'Connected Body',
      'Anchor',
      'Enable Collision',
    ]);
    expect(shown(on('slider'))).toContain('Max Force');
  });

  it('writes another kind whole, at its defaults; shows a hinge\'s angles in degrees; joins the World by default', () => {
    const type = row(joint('hinge'), 'motion');

    expect(type.fromModel?.('spring')).toEqual(createJointMotion('spring'));
    expect(row(joint('hinge'), 'motion.limits.min').toModel?.(-Math.PI / 2)).toBeCloseTo(-90);
    expect(row(joint('hinge'), 'motion.motor.speed').fromModel?.(90)).toBeCloseTo(Math.PI / 2);
    expect(row(joint('slider'), 'motion.limits.min').toModel).toBeUndefined();
    expect(row(joint('hinge'), 'connectedEntity').optionsProvider?.()).toMatchObject({ World: '' });
    const { rows, tunable: tuning } = tunable(joint('hinge'));
    expect(tuning).toBe(rows);
  });
});

function shapeKindOf(kind: string): ColliderShapeKind {
  const kinds: readonly ColliderShapeKind[] = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'mesh'];
  return assertDefined(kinds.find((known) => known === kind), `the shape ${kind}`);
}

describe('the model\'s pane', () => {
  const chair = (nodePath = ''): ComponentDoc => ({ ...modelType.create(), assetId: fixedId('asset', 'chair'), nodePath });

  it('is what was written by hand: no row for its file or its node, and Unpack after its material', () => {
    expect(rows(chair())).toEqual([
      { path: ['castShadow'], label: 'Cast shadows' },
      { path: ['receiveShadow'], label: 'Receive shadows' },
      { kind: 'separator' },
      { params: { view: 'asset', assetKind: 'material', emptyLabel: 'From file' }, path: ['materialId'], label: 'Material' },
      { kind: 'separator' },
      { kind: 'action', title: 'Unpack Model' },
    ]);
  });

  it('offers Unpack on the entity that draws the whole file alone', () => {
    expect(shown(chair())).toEqual(['Cast shadows', 'Receive shadows', '—', 'Material', '—', 'Unpack Model']);
    expect(shown(chair('0/1'))).toEqual(['Cast shadows', 'Receive shadows', '—', 'Material', '—']);
  });
});

describe('the audio source\'s pane', () => {
  const POSITIONAL = ['Falloff', 'Full volume within', 'Max distance', 'Rolloff', 'Cone inner', 'Cone outer', 'Outside cone'];
  const ALWAYS = [
    'Clip',
    '▶  Play',
    '▌▌  Pause',
    '■  Stop',
    '—',
    'Volume',
    'Pitch',
    'Detune',
    'Mute',
    'Loop',
    'Play on start',
    '—',
    'Start offset',
    'Delay',
    'Fade in',
    'Fade out',
    'Priority',
    '—',
    'Bus',
    '—',
    'Spatialize',
    '2D  ↔  3D',
  ];

  it('is what was written by hand, its blend a switch and a dial onto the one field', () => {
    expect(rows(audioSourceType.create())).toEqual([
      { params: { view: 'asset', assetKind: 'audio' }, path: ['assetId'], label: 'Clip' },
      { kind: 'action', label: 'Preview', title: '▶  Play' },
      { kind: 'action', title: '▌▌  Pause' },
      { kind: 'action', title: '■  Stop' },
      { kind: 'separator' },
      { path: ['volume'], label: 'Volume', type: 'number', min: 0, max: 2, step: 0.01 },
      { path: ['pitch'], label: 'Pitch', type: 'number', min: 0.1, max: 4, step: 0.01 },
      { path: ['detune'], label: 'Detune', type: 'number', min: -1200, max: 1200, step: 1 },
      { path: ['mute'], label: 'Mute' },
      { path: ['loop'], label: 'Loop' },
      { path: ['playOnStart'], label: 'Play on start' },
      { kind: 'separator' },
      { path: ['startOffset'], label: 'Start offset', type: 'number', min: 0, step: 0.01 },
      { path: ['delay'], label: 'Delay', type: 'number', min: 0, step: 0.01 },
      { path: ['fadeIn'], label: 'Fade in', type: 'number', min: 0, max: 30, step: 0.01 },
      { path: ['fadeOut'], label: 'Fade out', type: 'number', min: 0, max: 30, step: 0.01 },
      { path: ['priority'], label: 'Priority', type: 'number', min: 0, max: 256, step: 1 },
      { kind: 'separator' },
      {
        path: ['bus'],
        label: 'Bus',
        type: 'enum',
        options: [
          { value: 'master', label: 'Master' },
          { value: 'music', label: 'Music' },
          { value: 'sfx', label: 'SFX' },
          { value: 'ui', label: 'UI' },
          { value: 'ambience', label: 'Ambience' },
        ],
      },
      { kind: 'separator' },
      { path: ['spatialBlend'], label: 'Spatialize' },
      { path: ['spatialBlend'], label: '2D  ↔  3D', type: 'number', min: 0, max: 1, step: 0.01 },
      {
        path: ['distanceModel'],
        label: 'Falloff',
        type: 'enum',
        options: [
          { value: 'inverse', label: 'Inverse' },
          { value: 'linear', label: 'Linear' },
          { value: 'exponential', label: 'Exponential' },
        ],
      },
      { path: ['refDistance'], label: 'Full volume within', type: 'number', min: 0.1, max: 100, step: 0.1 },
      { path: ['maxDistance'], label: 'Max distance', type: 'number', min: 1, max: 2000, step: 1 },
      { path: ['rolloffFactor'], label: 'Rolloff', type: 'number', min: 0, max: 10, step: 0.1 },
      { path: ['coneInnerAngle'], label: 'Cone inner', type: 'number', min: 0, max: 360, step: 1 },
      { path: ['coneOuterAngle'], label: 'Cone outer', type: 'number', min: 0, max: 360, step: 1 },
      { path: ['coneOuterGain'], label: 'Outside cone', type: 'number', min: 0, max: 1, step: 0.01 },
    ]);
  });

  it('shows the falloff for a source that is any part positional', () => {
    expect(shown(audioSourceType.create())).toEqual([...ALWAYS, ...POSITIONAL]);
    expect(shown({ ...audioSourceType.create(), spatialBlend: 0 })).toEqual(ALWAYS);
    expect(shown({ ...audioSourceType.create(), spatialBlend: 0.3 })).toEqual([...ALWAYS, ...POSITIONAL]);
  });

  it('writes the switch as the two ends of the dial', () => {
    const spatialize = paneEntriesFor(registries, audioSourceType.create()).entries.find(
      (entry): entry is FieldSpec => 'path' in entry && entry.label === 'Spatialize',
    );

    expect([0, 0.3, 1].map((blend) => spatialize?.toModel?.(blend))).toEqual([false, true, true]);
    expect([false, true].map((on) => spatialize?.fromModel?.(on))).toEqual([0, 1]);
  });
});

describe('the script\'s pane', () => {
  const DOOR = fixedId('asset', 'door-script');
  const door = { ...scriptType.create(), assetId: DOOR };

  /** What a build leaves in the store: the door script, declaring `properties`. */
  const built = (properties: ScriptProperties): void => {
    class Door extends Behaviour {
      static override properties = properties;
    }
    useScriptStore.setState({ scripts: new Map([[DOOR, Door]]), revision: useScriptStore.getState().revision + 1 });
  };
  afterEach(() => useScriptStore.setState({ scripts: NO_SCRIPTS }));

  it('is its script, as an asset slot, then a row per property the script declares', () => {
    expect(rows(scriptType.create())).toEqual([{ params: { view: 'asset', assetKind: 'script' }, path: ['assetId'], label: 'Script' }]);

    built({ speed: { type: 'number', min: 0 } });
    expect(row(door, 'props.speed')).toMatchObject({ path: ['props', 'speed'], label: 'speed', type: 'number', min: 0 });
  });

  it('follows the script rebuilt, though the script is the same one', () => {
    built({ speed: { type: 'number', min: 0 } });
    expect(shown(door)).toEqual(['Script', 'speed']);

    built({ speed: { type: 'number', min: 0 }, open: { type: 'boolean', label: 'Open' } });
    expect(shown(door)).toEqual(['Script', 'speed', 'Open']);
  });
});

describe('the prefab instance\'s pane', () => {
  it('is what was written by hand: its prefab, then its seven actions', () => {
    expect(rows(createPrefabInstance(fixedId('asset', 'tree')))).toEqual([
      { params: { view: 'asset', assetKind: 'prefab' }, path: ['assetId'], label: 'Prefab' },
      { kind: 'action', title: 'Open Prefab' },
      { kind: 'action', title: 'Create Variant…' },
      { kind: 'action', title: 'Show in Project' },
      { kind: 'action', title: 'Select All Instances' },
      { kind: 'action', title: 'Apply Overrides' },
      { kind: 'action', title: 'Revert Overrides' },
      { kind: 'action', title: 'Unpack' },
    ]);
  });
});

describe('every pane', () => {
  it('is derived: the registry holds what types add to theirs, never a pane of its own', () => {
    for (const extension of registries.panes.values()) expect(extension).not.toHaveProperty('fields');
  });
});

/*
 * The scene pane keeps its sections and its conditions, written by hand: the
 * environment is no component, and has no pane to derive. Each row's label,
 * range, options and unit are the environment schema's.
 */
describe('the scene pane', () => {
  it('reads its rows off the environment\'s schema, row for row what was written by hand', () => {
    expect(JSON.parse(JSON.stringify(SCENE_SCHEMA))).toEqual([
      { label: 'Scene', fields: [
        { on: 'scene', key: 'name', label: 'Name' },
      ] },
      { label: 'Background', fields: [
        { on: 'environment', key: 'backgroundMode', label: 'Mode', type: 'enum', options: [{ value: 'color', label: 'Colour' }, { value: 'texture', label: 'Texture' }, { value: 'sky', label: 'Sky' }] },
        { on: 'environment', key: 'background', label: 'Colour' },
        { on: 'environment', key: 'backgroundTexture', label: 'Texture', params: { view: 'asset', assetKind: 'texture' } },
        { on: 'environment', key: 'backgroundIntensity', label: 'Intensity', type: 'number', min: 0, max: 5, step: 0.01 },
        { on: 'environment', key: 'backgroundBlur', label: 'Blur', type: 'number', min: 0, max: 1, step: 0.01 },
      ] },
      { label: 'Environment', fields: [
        { on: 'environment', key: 'environmentMode', label: 'Source', type: 'enum', options: [{ value: 'none', label: 'None' }, { value: 'background', label: 'Background' }, { value: 'texture', label: 'Texture' }] },
        { on: 'environment', key: 'environmentTexture', label: 'Lighting', params: { view: 'asset', assetKind: 'texture' } },
        { on: 'environment', key: 'environmentIntensity', label: 'Intensity', type: 'number', min: 0, max: 5, step: 0.01 },
        { on: 'environment', key: 'rotation', label: 'Rotation', type: 'number', min: -180, max: 180, step: 1 },
      ] },
      { label: 'Sky', fields: [
        { on: 'sky', key: 'elevation', label: 'Sun Height', type: 'number', min: -10, max: 90, step: 0.1 },
        { on: 'sky', key: 'azimuth', label: 'Sun Angle', type: 'number', min: -180, max: 180, step: 1 },
        { on: 'sky', key: 'turbidity', label: 'Haze', type: 'number', min: 0, max: 20, step: 0.1 },
        { on: 'sky', key: 'rayleigh', label: 'Blue', type: 'number', min: 0, max: 4, step: 0.01 },
        { on: 'sky', key: 'mieCoefficient', label: 'Sun Glow', type: 'number', min: 0, max: 0.1, step: 0.001 },
        { on: 'sky', key: 'mieDirectionalG', label: 'Glow Focus', type: 'number', min: 0, max: 1, step: 0.01 },
        { on: 'sky', key: 'sunDisc', label: 'Sun Disc' },
        { on: 'sky', key: 'cloudCoverage', label: 'Cloud Cover', type: 'number', min: 0, max: 1, step: 0.01 },
        { on: 'sky', key: 'cloudDensity', label: 'Cloud Density', type: 'number', min: 0, max: 1, step: 0.01 },
        { on: 'sky', key: 'cloudScale', label: 'Cloud Scale', type: 'number', min: 1e-05, max: 0.001, step: 1e-05 },
        { on: 'sky', key: 'cloudElevation', label: 'Cloud Height', type: 'number', min: 0, max: 1, step: 0.01 },
        { on: 'sky', key: 'cloudSpeed', label: 'Cloud Drift', type: 'number', min: 0, max: 0.001, step: 1e-05 },
      ] },
      { label: 'Fog', fields: [
        { on: 'environment', key: 'fogEnabled', label: 'Enabled' },
        { on: 'environment', key: 'fogColor', label: 'Colour' },
        { on: 'environment', key: 'fogMode', label: 'Mode', type: 'enum', options: [{ value: 'linear', label: 'Linear' }, { value: 'exponential', label: 'Exponential' }] },
        { on: 'environment', key: 'fogNear', label: 'Start', type: 'number', min: 0, step: 1 },
        { on: 'environment', key: 'fogFar', label: 'End', type: 'number', min: 0, step: 1 },
        { on: 'environment', key: 'fogDensity', label: 'Density', type: 'number', min: 0, max: 0.2, step: 0.001 },
      ] },
    ]);
  });

  it('shows the rotation in degrees and stores it in radians', () => {
    const rotation = SCENE_SCHEMA.flatMap((section) => section.fields).find((field) => field.key === 'rotation');

    expect(rotation?.toModel?.(Math.PI)).toBeCloseTo(180);
    expect(rotation?.fromModel?.(90)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps each condition it had, on the sections and the rows that had one', () => {
    const conditioned = SCENE_SCHEMA.map((section) => [
      section.label,
      section.visibleWhen !== undefined,
      section.fields.filter((field) => field.visibleWhen !== undefined).map((field) => field.key),
    ]);

    expect(conditioned).toEqual([
      ['Scene', true, []],
      ['Background', false, ['background', 'backgroundTexture', 'backgroundIntensity', 'backgroundBlur']],
      ['Environment', false, ['environmentTexture', 'environmentIntensity', 'rotation']],
      ['Sky', true, []],
      ['Fog', false, ['fogColor', 'fogMode', 'fogNear', 'fogFar', 'fogDensity']],
    ]);
  });
});
