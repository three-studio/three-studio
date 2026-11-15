import {
  assertDefined,
  audioListenerType,
  createCamera,
  createLight,
  playerControllerType,
  rigidbodyType,
  type ComponentDoc,
  type LightKind,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { isSeparator, type FieldSpec } from '../src/inspector/fields';
import { paneEntriesFor } from '../src/inspector/panes';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The panes of the kernel's types described by their fields, derived, row for
 * row what was written by hand in each type's `inspector.ts` — labels, ranges,
 * order, rules — and showing the same rows for each kind or mode that changed
 * them. Taken from the hand-written panes before they went, through JSON,
 * which keeps what a row declares and drops its functions.
 *
 * One change, the format's: a rigid body's locks are named axes, so their rows
 * are read at `x`, `y`, `z` where they were read at `0`, `1`, `2`.
 */

/** The rows a component's pane declares, without their functions. */
function rows(component: ComponentDoc): unknown {
  return JSON.parse(JSON.stringify(paneEntriesFor(registries, component).entries));
}

/** The labels of the rows a component shows, a rule as `—`. */
function shown(component: ComponentDoc): string[] {
  return paneEntriesFor(registries, component).entries.flatMap((entry) => {
    if (isSeparator(entry)) return ['—'];
    if (entry.visibleWhen && !entry.visibleWhen(component)) return [];
    return ['path' in entry ? entry.label : entry.title];
  });
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

  it('tunes the running game during Play, as it did', () => {
    expect(paneEntriesFor(registries, rigidbodyType.create()).live).toBe(true);
    expect(paneEntriesFor(registries, createCamera()).live).toBe(false);
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
  it('are derived: no pane is registered for them, and only the rigid body extends its own', () => {
    expect((['camera', 'audioListener', 'playerController', 'light'] as const).map((type) => registries.panes.get(type))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(registries.panes.get('rigidbody')).toEqual({ id: 'rigidbody', live: true });
  });
});
