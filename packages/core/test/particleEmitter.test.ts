import {
  assertDefined,
  componentAssets,
  createEntity,
  deserializeScene,
  findComponent,
  fixedId,
  particleEmitterComponent,
  serializeScene,
  type AssetId,
  type ParticleEmitterComponent,
  type Vec3,
} from '@three-studio/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { sceneWith } from './fixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The first type written as a schema: its fields are said once, and its
 * TypeScript type, its blank component, its decoder and the asset it names all
 * come from them. What is pinned here is that none of it moved: the values a
 * new emitter starts with, and a component a file already holds.
 */

/** An emitter as a scene file written before the schema holds it, no field at its default. */
function stored(): Record<string, unknown> {
  return {
    id: 'p1',
    type: 'particleEmitter',
    count: 1200,
    shape: 'box',
    radius: 2,
    extents: [2, 3, 4],
    lifetime: 5,
    velocity: [1, 0, -1],
    spread: [0, 0.5, 0],
    gravity: 9.81,
    size: 0.4,
    color: '#12AbEf',
    opacity: 0.5,
    spriteId: 'spark',
    additive: false,
  };
}

const decode = (value: unknown) =>
  assertDefined(particleEmitterComponent.decode, 'the emitter\'s decoder')(value, ['emitter']);

describe('a new particle emitter', () => {
  it('starts as it always has: a slow plume of warm embers', () => {
    expect(particleEmitterComponent.create()).toEqual({
      id: expect.any(String),
      type: 'particleEmitter',
      count: 200,
      shape: 'sphere',
      radius: 0.25,
      extents: [1, 1, 1],
      lifetime: 2,
      velocity: [0, 1.5, 0],
      spread: [0.4, 0.4, 0.4],
      gravity: 0,
      size: 0.15,
      color: '#ffb86b',
      opacity: 1,
      spriteId: null,
      additive: true,
    });
  });

  it('is its own: an id of its own, and vectors no other emitter holds', () => {
    const first = particleEmitterComponent.create();
    const second = particleEmitterComponent.create();
    first.extents[0] = 9;

    expect(second.id).not.toBe(first.id);
    expect(second.extents).toEqual([1, 1, 1]);
    expect(particleEmitterComponent.create().extents).toEqual([1, 1, 1]);
  });

  it('is typed by its fields', () => {
    expectTypeOf<ParticleEmitterComponent['shape']>().toEqualTypeOf<'point' | 'sphere' | 'box'>();
    expectTypeOf<ParticleEmitterComponent['extents']>().toEqualTypeOf<Vec3>();
    expectTypeOf<ParticleEmitterComponent['spriteId']>().toEqualTypeOf<AssetId | null>();
    expectTypeOf<ParticleEmitterComponent['type']>().toEqualTypeOf<'particleEmitter'>();
    expectTypeOf(particleEmitterComponent.create()).toEqualTypeOf<ParticleEmitterComponent>();
  });
});

describe('a stored particle emitter', () => {
  it('decodes to what the file holds', () => {
    expect(decode(stored())).toEqual({ ok: true, value: stored() });
  });

  it.each([
    ['count', '200'],
    ['shape', 'cone'],
    ['radius', null],
    ['extents', [1, 1]],
    ['lifetime', Number.NaN],
    ['velocity', 'up'],
    ['spread', [0, 0, '0']],
    ['gravity', true],
    ['size', undefined],
    ['color', 'orange'],
    ['opacity', '1'],
    ['spriteId', ''],
    ['additive', 1],
  ])('is refused for a %s of %j, which is named', (key, value) => {
    expect(decode({ ...stored(), [key]: value })).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.invalid', message: expect.any(String), path: ['emitter', key] }],
    });
  });

  it('is refused under another type\'s name, or under no id', () => {
    expect(decode({ ...stored(), type: 'mesh' })).toMatchObject({ ok: false, diagnostics: [{ path: ['emitter', 'type'] }] });
    expect(decode({ ...stored(), id: '' })).toMatchObject({ ok: false, diagnostics: [{ path: ['emitter', 'id'] }] });
  });

  it('is refused for a field the type does not have', () => {
    expect(decode({ ...stored(), burst: 12 })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'field.unexpected', path: ['emitter', 'burst'] }],
    });
  });

  it('names the sprite it draws, so that a build ships it and deleting it is not called safe', () => {
    const emitter = { ...particleEmitterComponent.create(), spriteId: fixedId('asset', 'spark') };

    expect(componentAssets(registries, emitter)).toEqual(['spark']);
    expect(componentAssets(registries, particleEmitterComponent.create())).toEqual([null]);
  });
});

describe('a scene holding a particle emitter', () => {
  /** A scene file holding one emitter, as `edit` leaves the emitter's JSON. */
  function file(edit: (emitter: Record<string, unknown>) => void): string {
    const host = createEntity('Embers', [particleEmitterComponent.create()]);
    const json = JSON.parse(serializeScene(registries, sceneWith([host])));
    for (const emitter of Object.values<Record<string, unknown>>(json.components.particleEmitter[host.entity.id])) {
      edit(emitter);
    }
    return JSON.stringify(json);
  }

  it('opens with the emitter as the file holds it', () => {
    const scene = deserializeScene(registries, file((emitter) => (emitter['count'] = 750)));
    const [entityId] = scene.entities.keys();

    expect(findComponent(scene, assertDefined(entityId, 'the entity'), 'particleEmitter')?.count).toBe(750);
  });

  it('is refused when the emitter is malformed, naming each fault where it sits', () => {
    const malformed = file((emitter) => {
      emitter['radius'] = 'wide';
      emitter['burst'] = 12;
    });

    expect(() => deserializeScene(registries, malformed)).toThrow(
      /components\.particleEmitter\.\w+\.\w+\.radius: expected a finite number, found "wide"[\s\S]*\.burst: is no field of this type/,
    );
  });

  it('still opens when the file was written before one of the emitter\'s fields existed', () => {
    // An older file is read through each type's factory until the formats stop
    // being converted: a missing field is filled, not refused.
    const older = file((emitter) => delete emitter['additive']);
    const scene = deserializeScene(registries, older);
    const [entityId] = scene.entities.keys();

    expect(findComponent(scene, assertDefined(entityId, 'the entity'), 'particleEmitter')?.additive).toBe(true);
  });
});
