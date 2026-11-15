import {
  assertDefined,
  createEntity,
  createLight,
  createLightEntity,
  createMeshEntity,
  deserializeScene,
  serializeScene,
  stableJson,
  type ComponentDoc,
  type Schema,
} from '@three-studio/core';
import { Boxes, Camera, Lightbulb, Volume2, Waves } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { activateEditor } from '../src/activate';
import { inspectorSignature } from '../src/inspector/buildInspector';
import { derivedPane } from '../src/inspector/derivePane';
import { paneEntriesFor, unknownTypesOn } from '../src/inspector/panes';
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
  it('registers what each kernel type adds to its pane: the panes still written by hand, and the extensions', () => {
    expect(registries.panes.values().map((pane) => pane.id)).toEqual([
      'mesh',
      'model',
      'rigidbody',
      'collider',
      'joint',
      'audioSource',
      'script',
      'prefabInstance',
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

    expect(own.panes.values()).toHaveLength(9);
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
    ]);
  });
});

describe('the viewport\'s markers and helpers', () => {
  const rules = markerRules(registries.overlays);

  it('rank the marked types as they were: camera, light, then the two audio types', () => {
    expect(rules.markedTypes).toEqual(['camera', 'light', 'audioSource', 'audioListener']);
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
    });
  });

  it('mark nothing on what draws geometry of its own: a mesh, a model, a water surface', () => {
    expect(registries.overlays.values().filter((overlay) => overlay.drawsGeometry).map((overlay) => overlay.id)).toEqual([
      'mesh',
      'model',
      'water',
    ]);

    const cube = createMeshEntity('box');
    const lamp = createLightEntity('point');
    const both = createMeshEntity('box');
    both.components.push(createLight('point'));
    const scene = sceneWith([cube, lamp, both, createEntity('Empty')]);

    expect(rules.markerStyleFor(scene, cube.entity.id)).toBeUndefined();
    expect(rules.markerStyleFor(scene, both.entity.id)).toBeUndefined();
    expect(rules.markerStyleFor(scene, lamp.entity.id)).toEqual({ color: 0xffd25e, pixels: 11, priority: 2 });
    expect(rules.drawsNothing(scene, lamp.entity.id)).toBe(true);
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
  it('rank the six kernel types that decide a row, each with the icon it had', () => {
    const ranked = [...registries.icons.values()].sort((a, b) => a.priority - b.priority);

    expect(ranked.map(({ id, icon }) => [id, icon])).toEqual([
      ['prefabInstance', Boxes],
      ['light', Lightbulb],
      ['camera', Camera],
      ['audioSource', Volume2],
      ['audioListener', Volume2],
      ['water', Waves],
    ]);
  });
});

describe('the pane of a type written as a schema', () => {
  const schema = {
    kind: { type: 'enum', label: 'Kind', default: 'point', options: [{ value: 'point', label: 'Point' }, { value: 'spot', label: 'Spot' }] },
    reach: { type: 'number', label: 'Reach', default: 1, min: 0, step: 0.5, shownWhen: { field: 'kind', equals: 'spot' } },
    aim: { type: 'vec3', label: 'Aim', default: [0, 1, 0], separatorBefore: true },
    image: { type: 'asset', label: 'Image', kind: 'texture' },
    tint: { type: 'color', label: 'Tint', default: '#ffffff' },
    on: { type: 'boolean', label: 'On', default: true },
  } as const satisfies Schema;

  it('is a row per field in their order, a rule where a field asks for one, and only the bounds a field gives', () => {
    const pane = derivedPane('light', schema, undefined, createLight('point'));

    // Through JSON, which drops the functions: the conditions are checked below.
    expect(pane.key).toBe('light');
    expect(JSON.parse(JSON.stringify(pane.entries))).toEqual([
      { path: ['kind'], label: 'Kind', type: 'enum', options: [{ value: 'point', label: 'Point' }, { value: 'spot', label: 'Spot' }] },
      { path: ['reach'], label: 'Reach', type: 'number', min: 0, step: 0.5 },
      { kind: 'separator' },
      { path: ['aim'], label: 'Aim', type: 'vec3' },
      { params: { view: 'asset', assetKind: 'texture' }, path: ['image'], label: 'Image' },
      { path: ['tint'], label: 'Tint' },
      { path: ['on'], label: 'On' },
    ]);
  });

  it('shows a conditional row only while the field it names holds the value', () => {
    const [, reach] = derivedPane('light', schema, undefined, createLight('point')).entries;
    // Asked of a light, which holds a `kind`: the pane reads any component by the key the condition names.
    const shown = (component: ComponentDoc): boolean | undefined =>
      reach !== undefined && 'path' in reach ? reach.visibleWhen?.(component) : undefined;

    expect(shown(createLight('spot'))).toBe(true);
    expect(shown(createLight('point'))).toBe(false);
  });

  it('is none for a type nobody registered', () => {
    expect(paneEntriesFor(createEditorRegistries(), createLight('point')).entries).toEqual([]);
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
