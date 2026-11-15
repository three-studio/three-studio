import { assertDefined, createEntity, createLight, createMeshEntity, type ComponentDoc } from '@three-studio/core';
import { particleEmitterType } from '@three-studio/particles/core';
import { Sparkles } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../../packages/core/test/fixtures';
import { isSeparator } from '../../../packages/editor/src/inspector/fields';
import { paneEntriesFor } from '../../../packages/editor/src/inspector/panes';
import { addMenuGroups } from '../../../packages/editor/src/shell/addMenu';
import { markerRules } from '../../../packages/editor/src/viewport/overlay/markerStyles';
import { registriesWithParticles } from './registries';

const registries = registriesWithParticles();

/*
 * What the editor shows of a particle emitter, each as it stood when particles
 * was a type of the kernel: the pane, now derived from the schema; its place in
 * the Add menu, among the markers and among the Hierarchy's icons, now
 * registered from here.
 */

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

  const emitter = (shape: 'point' | 'sphere' | 'box'): ComponentDoc => ({ ...particleEmitterType.create(), shape });

  it('is derived from its fields, row for row what was written by hand', () => {
    const pane = paneEntriesFor(registries, emitter('sphere'));

    // Through JSON, as the reference was taken: it drops the functions, which
    // are the conditions, and keeps every key a row declares.
    expect(JSON.parse(JSON.stringify(pane.entries))).toEqual(WRITTEN_BY_HAND);
    expect(pane.key).toBe('particleEmitter');
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

  it('is derived once: asked again, whatever the shape, it is the same pane', () => {
    expect(paneEntriesFor(registries, emitter('box'))).toBe(paneEntriesFor(registries, emitter('point')));
  });
});

describe('particles among the types the editor knows', () => {
  it('comes after the types of the kernel, which is where an entity lists it', () => {
    expect(registries.components.values().at(-1)?.id).toBe('particleEmitter');
    expect(registries.systems.get('particleEmitter')).toBeDefined();
  });

  it('is the last submenu of Add: Effects, holding Particles', () => {
    const groups = addMenuGroups(registries.addMenu);

    expect(groups.map((group) => group.label)).toEqual(['Mesh', 'Light', 'Camera', 'Audio', 'Environment', 'Effects']);
    expect(groups.at(-1)?.entries.map((entry) => entry?.label)).toEqual(['Particles']);
    const [placed] = assertDefined(groups.at(-1)?.entries[0], 'the Particles entry').create().components;
    expect(placed).toMatchObject({ type: 'particleEmitter', count: 200 });
  });

  it('is marked after the camera, the light and the two audio types, and yields to any of them', () => {
    const rules = markerRules(registries.overlays);
    const emitter = createEntity('Embers', [particleEmitterType.create()]);
    const lit = createEntity('Torch', [particleEmitterType.create(), createLight('point')]);
    const drawn = createMeshEntity('box');
    drawn.components.push(particleEmitterType.create());
    const scene = sceneWith([emitter, lit, drawn]);

    expect(rules.markedTypes).toEqual(['camera', 'light', 'audioSource', 'audioListener', 'particleEmitter']);
    expect(rules.markerStyleFor(scene, emitter.entity.id)).toEqual({ color: 0xffb86b, pixels: 9, priority: 5 });
    expect(rules.markerStyleFor(scene, lit.entity.id)).toEqual({ color: 0xffd25e, pixels: 11, priority: 2 });
    // On a mesh there is already something to click.
    expect(rules.markerStyleFor(scene, drawn.entity.id)).toBeUndefined();
    expect(registries.overlays.get('particleEmitter')?.helper).toBeNull();
  });

  it('gives its row the sparkles, ranked last of the icons that decide', () => {
    const ranked = [...registries.icons.values()].sort((a, b) => a.priority - b.priority);

    expect(ranked.at(-1)).toEqual({ id: 'particleEmitter', icon: Sparkles, priority: 7 });
    expect(ranked.map(({ id }) => id)).toEqual([
      'prefabInstance',
      'light',
      'camera',
      'audioSource',
      'audioListener',
      'water',
      'particleEmitter',
    ]);
  });
});
