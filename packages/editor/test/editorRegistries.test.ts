import {
  assertDefined,
  createEntity,
  createMeshEntity,
  deserializeScene,
  particleEmitterComponent,
  serializeScene,
  stableJson,
  type ComponentDoc,
} from '@three-studio/core';
import { Boxes, Camera, Lightbulb, Sparkles, Volume2, Waves } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { activateEditor } from '../src/activate';
import { inspectorSignature } from '../src/inspector/buildInspector';
import { isSeparator } from '../src/inspector/fields';
import { paneEntriesFor, paneFor, unknownTypesOn } from '../src/inspector/panes';
import { createEditorRegistries } from '../src/registries';
import { addMenuGroups } from '../src/shell/addMenu';
import { useDocumentStore } from '../src/state/documentStore';
import { markerRules } from '../src/viewport/overlay/markerStyles';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * What each component type shows in the editor is registered, where it was four
 * tables written out type by type. Each case below is what one of those tables
 * said the day it went: the registries have to say the same.
 */

describe('activating the editor', () => {
  it('registers a pane for each type still written by hand, and none for a type written as a schema', () => {
    expect(registries.panes.values().map((pane) => pane.id)).toEqual([
      'mesh',
      'model',
      'light',
      'camera',
      'rigidbody',
      'collider',
      'joint',
      'audioSource',
      'audioListener',
      'script',
      'prefabInstance',
      'playerController',
      'water',
    ]);
  });

  it('registers what every type draws in the viewport, in the order core registers the types', () => {
    expect(registries.overlays.values().map((overlay) => overlay.id)).toEqual(
      registries.components.values().map((definition) => definition.id),
    );
  });

  it('registers into registries of its own, and takes it all out again when disposed', () => {
    const own = createEditorRegistries();
    const activation = activateEditor(own);

    expect(own.panes.values()).toHaveLength(13);
    expect(() => activateEditor(own)).toThrow('The pane "mesh" is already registered.');

    activation.dispose();
    expect([own.panes, own.addMenu, own.overlays, own.icons].map((registry) => registry.values().length)).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe('a type\'s name', () => {
  it('is its definition\'s label, as each pane used to head itself', () => {
    expect(Object.fromEntries(registries.components.values().map(({ id, label }) => [id, label]))).toEqual({
      mesh: 'Mesh',
      model: 'Model',
      water: 'Water',
      particleEmitter: 'Particles',
      light: 'Light',
      camera: 'Camera',
      rigidbody: 'Rigid Body',
      collider: 'Collider',
      joint: 'Joint',
      audioSource: 'Audio Source',
      audioListener: 'Audio Listener',
      script: 'Script',
      prefabInstance: 'Prefab',
      playerController: 'Player Controller',
    });
  });
});

describe('the Add menu', () => {
  it('lists the same submenus and entries, in the same order', () => {
    const listed = addMenuGroups(registries.addMenu).map((group) => ({
      label: group.label,
      entries: group.entries.map((entry) => (entry === null ? null : entry.label)),
    }));

    expect(listed).toEqual([
      {
        label: 'Mesh',
        entries: [
          'Cube', 'Sphere', 'Plane', 'Capsule', 'Cylinder', null,
          'Circle', 'Ring', 'Torus', 'Torus Knot', null,
          'Tetrahedron', 'Octahedron', 'Dodecahedron', 'Icosahedron',
        ],
      },
      { label: 'Light', entries: ['Directional', 'Point', 'Spot', 'Area', 'Projector', 'Ambient', 'Hemisphere'] },
      { label: 'Camera', entries: ['Perspective', 'Orthographic'] },
      // Two types under one heading, the source above the listener.
      { label: 'Audio', entries: ['Audio Source', 'Audio Listener'] },
      { label: 'Environment', entries: ['Water'] },
      { label: 'Effects', entries: ['Particles'] },
    ]);
  });
});

describe('the viewport\'s markers and helpers', () => {
  const rules = markerRules(registries.overlays);

  it('rank the marked types as they were: camera, light, the two audio types, particles', () => {
    expect(rules.markedTypes).toEqual(['camera', 'light', 'audioSource', 'audioListener', 'particleEmitter']);
  });

  it('give each type the marker it had', () => {
    expect(Object.fromEntries(registries.overlays.values().map(({ id, marker }) => [id, marker]))).toEqual({
      mesh: null,
      model: null,
      light: { color: 0xffd25e, pixels: 11, priority: 2 },
      camera: { color: 0x5eb0ff, pixels: 11, priority: 1 },
      rigidbody: null,
      collider: null,
      joint: null,
      audioSource: { color: 0x6ee7a8, pixels: 9, priority: 3 },
      audioListener: { color: 0x6ee7a8, pixels: 9, priority: 4 },
      script: null,
      prefabInstance: null,
      playerController: null,
      water: null,
      particleEmitter: { color: 0xffb86b, pixels: 9, priority: 5 },
    });
  });

  it('mark nothing on what draws geometry of its own: a mesh, a model, a water surface', () => {
    expect(registries.overlays.values().filter((overlay) => overlay.drawsGeometry).map((overlay) => overlay.id)).toEqual([
      'mesh',
      'model',
      'water',
    ]);

    const cube = createMeshEntity('box');
    const emitter = createEntity('Embers', [particleEmitterComponent.create()]);
    const both = createMeshEntity('box');
    both.components.push(particleEmitterComponent.create());
    const scene = sceneWith([cube, emitter, both, createEntity('Empty')]);

    expect(rules.markerStyleFor(scene, cube.entity.id)).toBeUndefined();
    expect(rules.markerStyleFor(scene, both.entity.id)).toBeUndefined();
    expect(rules.markerStyleFor(scene, emitter.entity.id)).toEqual({ color: 0xffb86b, pixels: 9, priority: 5 });
    expect(rules.drawsNothing(scene, emitter.entity.id)).toBe(true);
  });

  it('give a helper to the five types that annotate, made anew for whoever mounts it', () => {
    const made = registries.overlays
      .values()
      .flatMap(({ id, helper }) => (helper === null ? [] : [[id, helper().constructor.name]]));

    expect(made).toEqual([
      ['light', 'LightShape'],
      ['camera', 'CameraFrustum'],
      ['collider', 'ColliderOutline'],
      ['joint', 'JointShape'],
      ['audioSource', 'AudioShape'],
    ]);
    const light = assertDefined(registries.overlays.get('light')?.helper, 'the light\'s helper');
    expect(light()).not.toBe(light());
  });
});

describe('the Hierarchy\'s icons', () => {
  it('rank the seven types that decide a row, each with the icon it had', () => {
    const ranked = [...registries.icons.values()].sort((a, b) => a.priority - b.priority);

    expect(ranked.map(({ id, icon }) => [id, icon])).toEqual([
      ['prefabInstance', Boxes],
      ['light', Lightbulb],
      ['camera', Camera],
      ['audioSource', Volume2],
      ['audioListener', Volume2],
      ['water', Waves],
      ['particleEmitter', Sparkles],
    ]);
  });
});

describe('the pane of a type written as a schema', () => {
  /** The hand-written pane, as it stood: its rows without their conditions, which are checked apart. */
  const WRITTEN_BY_HAND = [
    { path: ['shape'], label: 'Emit from', type: 'enum', options: [{ value: 'point', label: 'Point' }, { value: 'sphere', label: 'Sphere' }, { value: 'box', label: 'Box' }] },
    { path: ['radius'], label: 'Radius', type: 'number', min: 0, max: 50, step: 0.05 },
    { path: ['extents'], label: 'Box size', type: 'vec3', min: 0, step: 0.1 },
    { kind: 'separator' },
    { path: ['count'], label: 'Particles', type: 'number', min: 0, max: 5000, step: 1 },
    { path: ['lifetime'], label: 'Lifetime (s)', type: 'number', min: 0.1, max: 30, step: 0.1 },
    { kind: 'separator' },
    { path: ['velocity'], label: 'Velocity', type: 'vec3', step: 0.1 },
    { path: ['spread'], label: 'Spread', type: 'vec3', min: 0, step: 0.1 },
    { path: ['gravity'], label: 'Gravity', type: 'number', min: -20, max: 20, step: 0.1 },
    { kind: 'separator' },
    { params: { view: 'asset', assetKind: 'texture' }, path: ['spriteId'], label: 'Sprite' },
    { path: ['color'], label: 'Colour' },
    { path: ['size'], label: 'Size', type: 'number', min: 0.001, max: 10, step: 0.01 },
    { path: ['opacity'], label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['additive'], label: 'Additive' },
  ];

  const emitter = (shape: 'point' | 'sphere' | 'box'): ComponentDoc => ({ ...particleEmitterComponent.create(), shape });

  it('is derived from its fields, row for row what was written by hand', () => {
    const pane = assertDefined(paneFor(registries, 'particleEmitter'), 'the emitter\'s pane');

    // Through JSON, as the reference was taken: it drops the functions, which
    // are the conditions, and keeps every key a row declares.
    expect(JSON.parse(JSON.stringify(pane.fields))).toEqual(WRITTEN_BY_HAND);
    expect(registries.panes.get('particleEmitter')).toBeUndefined();
  });

  it('shows the radius for a sphere, the box size for a box, and every other row always', () => {
    const shown = (shape: 'point' | 'sphere' | 'box'): string[] => {
      const component = emitter(shape);
      return paneEntriesFor(registries, component).entries.flatMap((entry) =>
        isSeparator(entry) || 'kind' in entry || (entry.visibleWhen && !entry.visibleWhen(component)) ? [] : [entry.label],
      );
    };
    const always = ['Particles', 'Lifetime (s)', 'Velocity', 'Spread', 'Gravity', 'Sprite', 'Colour', 'Size', 'Opacity', 'Additive'];

    expect(shown('point')).toEqual(['Emit from', ...always]);
    expect(shown('sphere')).toEqual(['Emit from', 'Radius', ...always]);
    expect(shown('box')).toEqual(['Emit from', 'Box size', ...always]);
  });

  it('is derived once: asked again, it is the same pane', () => {
    expect(paneFor(registries, 'particleEmitter')).toBe(paneFor(registries, 'particleEmitter'));
  });

  it('is none for a type nobody registered', () => {
    const empty = createEditorRegistries();

    expect(paneFor(empty, 'particleEmitter')).toBeUndefined();
    expect(paneEntriesFor(empty, emitter('box'))).toEqual({ key: 'particleEmitter', entries: [] });
  });
});

describe('a component of a type this editor does not define', () => {
  it('is named on the entity that carries it, and on no other', () => {
    const cube = createMeshEntity('box');
    const other = createMeshEntity('sphere');
    const file = JSON.parse(serializeScene(registries, sceneWith([cube, other])));
    file.components['plugin.flicker'] = { [cube.entity.id]: { f1: { id: 'f1', type: 'plugin.flicker', rate: 3 } } };
    file.components['acme.trail'] = { [cube.entity.id]: { t1: { id: 't1', type: 'acme.trail' } } };
    const scene = deserializeScene(registries, stableJson(file));

    expect(unknownTypesOn(scene, cube.entity.id)).toEqual(['acme.trail', 'plugin.flicker']);
    expect(unknownTypesOn(scene, other.entity.id)).toEqual([]);
  });

  it('is a folder of the Inspector, so the pane is rebuilt when the entity gains or loses one', () => {
    const cube = createMeshEntity('box');
    const file = JSON.parse(serializeScene(registries, sceneWith([cube])));
    const plain = deserializeScene(registries, stableJson(file));
    file.components['plugin.flicker'] = { [cube.entity.id]: { f1: { id: 'f1', type: 'plugin.flicker' } } };
    const carrying = deserializeScene(registries, stableJson(file));

    useDocumentStore.getState().replaceScene(plain);
    const without = inspectorSignature(registries, cube.entity.id);
    useDocumentStore.getState().replaceScene(carrying);
    const withOne = inspectorSignature(registries, cube.entity.id);

    expect(withOne).toBe(`${without},?plugin.flicker`);
  });
});
