import {
  assertDefined,
  componentAssets,
  createEntity,
  decodeScene,
  findComponent,
  fixedId,
  serializeScene,
  type AssetId,
  type Vec3,
  unwrap,
} from '@three-studio/core';
import { particleEmitterType, type ParticleEmitterComponent } from '@three-studio/particles/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { sceneWith } from '../../../packages/core/test/fixtures';
import { registriesWithParticles } from './registries';

const registries = registriesWithParticles();

/*
 * The type is written as a schema: its fields are said once, and its
 * TypeScript type, its blank component, its decoder and the asset it names all
 * come from them. What is pinned here is that none of it moved when it became
 * one, and then a module: the values a new emitter starts with, and a
 * component a file already holds.
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
  assertDefined(particleEmitterType.decode, 'the emitter\'s decoder')(value, ['emitter']);

describe('a new particle emitter', () => {
  it('starts as it always has: a slow plume of warm embers', () => {
    expect(particleEmitterType.create()).toEqual({
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
    const first = particleEmitterType.create();
    const second = particleEmitterType.create();
    first.extents[0] = 9;

    expect(second.id).not.toBe(first.id);
    expect(second.extents).toEqual([1, 1, 1]);
    expect(particleEmitterType.create().extents).toEqual([1, 1, 1]);
  });

  it('is typed by its fields', () => {
    expectTypeOf<ParticleEmitterComponent['shape']>().toEqualTypeOf<'point' | 'sphere' | 'box'>();
    expectTypeOf<ParticleEmitterComponent['extents']>().toEqualTypeOf<Vec3>();
    expectTypeOf<ParticleEmitterComponent['spriteId']>().toEqualTypeOf<AssetId | null>();
    expectTypeOf<ParticleEmitterComponent['type']>().toEqualTypeOf<'particleEmitter'>();
    expectTypeOf(particleEmitterType.create()).toEqualTypeOf<ParticleEmitterComponent>();
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
    const emitter = { ...particleEmitterType.create(), spriteId: fixedId('asset', 'spark') };

    expect(componentAssets(registries, emitter)).toEqual(['spark']);
    expect(componentAssets(registries, particleEmitterType.create())).toEqual([null]);
  });
});

describe('a scene holding a particle emitter', () => {
  /** A scene file holding one emitter, as `edit` leaves the emitter's JSON. */
  function file(edit: (emitter: Record<string, unknown>) => void): string {
    const host = createEntity('Embers', [particleEmitterType.create()]);
    const json = JSON.parse(serializeScene(registries, sceneWith([host])));
    for (const emitter of Object.values<Record<string, unknown>>(json.components.particleEmitter[host.entity.id])) {
      edit(emitter);
    }
    return JSON.stringify(json);
  }

  it('opens with the emitter as the file holds it', () => {
    const scene = unwrap(decodeScene(registries, file((emitter) => (emitter['count'] = 750))), 'Scene file');
    const [entityId] = scene.entities.keys();

    expect(findComponent(scene, assertDefined(entityId, 'the entity'), 'particleEmitter')?.count).toBe(750);
  });

  it('is refused when the emitter is malformed, naming each fault where it sits', () => {
    const malformed = file((emitter) => {
      emitter['radius'] = 'wide';
      emitter['burst'] = 12;
    });

    expect(() => unwrap(decodeScene(registries, malformed), 'Scene file')).toThrow(
      /components\.particleEmitter\.\w+\.\w+\.radius: expected a finite number, found "wide"[\s\S]*\.burst: is no field this build reads/,
    );
  });

  it('is refused when the file was written before one of the emitter\'s fields existed, naming the field', () => {
    // Nothing fills a missing field from the factory: an emitter of another
    // shape is another version of its type.
    const older = file((emitter) => delete emitter['additive']);

    expect(() => unwrap(decodeScene(registries, older), 'Scene file')).toThrow(/components\.particleEmitter\.\w+\.\w+\.additive: is missing/);
  });
});
