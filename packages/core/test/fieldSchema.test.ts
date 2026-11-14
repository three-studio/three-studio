import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  fixedId,
  planFields,
  type AssetId,
  type Infer,
  type Schema,
  type Vec3,
} from '../src/index';

/*
 * The schema kernel: a type's fields written once, and what is derived from
 * them — the defaults, the decoder, the assets a value names, the TypeScript
 * type. One field of each kind, and the two layout facts a field may carry.
 */
const schema = {
  count: { type: 'number', label: 'Count', default: 3, min: 0, max: 10, step: 1 },
  enabled: { type: 'boolean', label: 'Enabled', default: true },
  tint: { type: 'color', label: 'Tint', default: '#ffb86b' },
  offset: { type: 'vec3', label: 'Offset', default: [0, 1, 0], step: 0.1 },
  shape: {
    type: 'enum',
    label: 'Shape',
    default: 'ball',
    options: [
      { value: 'ball', label: 'Ball' },
      { value: 'box', label: 'Box' },
    ],
  },
  radius: { type: 'number', label: 'Radius', default: 0.5, shownWhen: { field: 'shape', equals: 'ball' } },
  sprite: { type: 'asset', label: 'Sprite', kind: 'texture', separatorBefore: true },
} as const satisfies Schema;

const plan = planFields(schema);
const sprite = fixedId('asset', 'spark');

/** A value every field accepts, none of them at its default. */
function stored(): Record<string, unknown> {
  return {
    count: 7,
    enabled: false,
    tint: '#0A0b0C',
    offset: [1, 2, 3],
    shape: 'box',
    radius: 2,
    sprite,
  };
}

describe('planFields', () => {
  it('gives the defaults the fields declare, and no asset where one is picked', () => {
    expect(plan.defaults).toEqual({
      count: 3,
      enabled: true,
      tint: '#ffb86b',
      offset: [0, 1, 0],
      shape: 'ball',
      radius: 0.5,
      sprite: null,
    });
  });

  it('reads the assets a value names, one per asset field, and `null` where none is picked', () => {
    expect(plan.assets({ ...plan.defaults, sprite })).toEqual([sprite]);
    expect(plan.assets(plan.defaults)).toEqual([null]);
  });

  it.each([
    ['a number that is not finite', { count: { type: 'number', label: 'Count', default: Number.NaN } }, 'count'],
    ['a colour that is not #rrggbb', { tint: { type: 'color', label: 'Tint', default: 'red' } }, 'tint'],
    [
      'a choice that is no option',
      { shape: { type: 'enum', label: 'Shape', default: 'cone', options: [{ value: 'ball', label: 'Ball' }] } },
      'shape',
    ],
  ] satisfies [string, Schema, string][])('refuses a default that is %s', (_what, bad, key) => {
    expect(() => planFields(bad)).toThrow(`${key}: `);
  });

  it('refuses a condition on a field the schema does not have', () => {
    const bad = {
      radius: { type: 'number', label: 'Radius', default: 1, shownWhen: { field: 'shape', equals: 'ball' } },
    } satisfies Schema;

    expect(() => planFields(bad)).toThrow('radius: shown when "shape"');
  });

  it('refuses a condition on a value its field cannot hold', () => {
    const bad = {
      shape: { type: 'enum', label: 'Shape', default: 'ball', options: [{ value: 'ball', label: 'Ball' }] },
      radius: { type: 'number', label: 'Radius', default: 1, shownWhen: { field: 'shape', equals: 'cone' } },
    } satisfies Schema;

    expect(() => planFields(bad)).toThrow('radius: shown when "shape" equals "cone"');
  });

  it('takes a condition on any kind of field, held to that field', () => {
    const good = {
      glow: { type: 'boolean', label: 'Glow', default: false },
      strength: { type: 'number', label: 'Strength', default: 1, shownWhen: { field: 'glow', equals: true } },
    } satisfies Schema;
    const bad = { ...good, strength: { ...good.strength, shownWhen: { field: 'glow', equals: 'yes' } } } satisfies Schema;

    expect(planFields(good).defaults).toEqual({ glow: false, strength: 1 });
    expect(() => planFields(bad)).toThrow('strength: shown when "glow" equals "yes"');
  });
});

describe('a planned decoder', () => {
  it('accepts a value every field accepts, as a value of its own', () => {
    const given = stored();
    const decoded = plan.decode(given, []);

    expect(decoded).toEqual({ ok: true, value: given });
    expect(decoded.ok && decoded.value).not.toBe(given);
  });

  it('accepts no asset where one may be picked', () => {
    expect(plan.decode({ ...stored(), sprite: null }, [])).toMatchObject({ ok: true });
  });

  it('checks no range: a bound is what a slider offers, not what a file may hold', () => {
    expect(plan.decode({ ...stored(), count: 5000 }, [])).toMatchObject({ ok: true });
  });

  it.each([
    ['count', 'seven'],
    ['count', Number.NaN],
    ['count', null],
    ['enabled', 1],
    ['tint', 'red'],
    ['tint', '#fff'],
    ['tint', 0xffb86b],
    ['offset', [1, 2]],
    ['offset', [1, 2, 'three']],
    ['offset', [1, 2, Number.POSITIVE_INFINITY]],
    ['offset', { x: 1, y: 2, z: 3 }],
    ['shape', 'cone'],
    ['shape', 0],
    ['sprite', ''],
    ['sprite', 12],
  ])('refuses %s: %j, naming where it is', (key, value) => {
    expect(plan.decode({ ...stored(), [key]: value }, ['emitter'])).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.invalid', message: expect.any(String), path: ['emitter', key] }],
    });
  });

  it('says what a field expected and what it found', () => {
    const decoded = plan.decode({ ...stored(), shape: 'cone' }, []);

    expect(decoded).toMatchObject({ diagnostics: [{ message: 'expected one of "ball", "box", found "cone"' }] });
  });

  it('refuses a missing field', () => {
    const { radius: _radius, ...rest } = stored();

    expect(plan.decode(rest, ['emitter'])).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.missing', message: expect.any(String), path: ['emitter', 'radius'] }],
    });
  });

  it('refuses a key that is no field', () => {
    expect(plan.decode({ ...stored(), mass: 1 }, ['emitter'])).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.unexpected', message: expect.any(String), path: ['emitter', 'mass'] }],
    });
  });

  it('collects every refusal of a value, the fields in their order and then the keys that are none', () => {
    const { enabled: _enabled, ...rest } = stored();
    const decoded = plan.decode({ ...rest, mass: 1, count: 'seven', sprite: '' }, [3]);

    expect(decoded.ok ? [] : decoded.diagnostics.map(({ code, path }) => [code, ...path])).toEqual([
      ['field.invalid', 3, 'count'],
      ['field.missing', 3, 'enabled'],
      ['field.invalid', 3, 'sprite'],
      ['field.unexpected', 3, 'mass'],
    ]);
  });

  it.each([[null], [[]], ['emitter'], [undefined]])('refuses %j, which holds no field at all', (value) => {
    expect(plan.decode(value, ['emitter'])).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.invalid', message: expect.any(String), path: ['emitter'] }],
    });
  });

  it('refuses a key named like something every object inherits: it is no field either', () => {
    expect(plan.decode({ ...stored(), constructor: 1 }, [])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'field.unexpected', path: ['constructor'] }],
    });
  });
});

describe('the types', () => {
  it('infer a value from its fields', () => {
    expectTypeOf<Infer<typeof schema>>().toEqualTypeOf<{
      count: number;
      enabled: boolean;
      tint: string;
      offset: Vec3;
      shape: 'ball' | 'box';
      radius: number;
      sprite: AssetId | null;
    }>();
    expectTypeOf(plan.defaults).toEqualTypeOf<Infer<typeof schema>>();
  });
});
