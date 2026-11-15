import { setFlagsFromString } from 'node:v8';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  conditionHolds,
  fixedId,
  isRecord,
  planFields,
  type AssetId,
  type DecodePath,
  type Decoded,
  type Diagnostic,
  type EntityId,
  type GeometryDef,
  type Infer,
  type MaterialDef,
  type Schema,
  type SchemaField,
  type ShownWhen,
  type Vec2,
  type Vec3,
} from '../src/index';

/*
 * The schema kernel: a type's fields written once, and what is derived from
 * them — the defaults, the decoder, the assets and entities a value names, the
 * TypeScript type. First a flat schema, one field of each leaf kind; then
 * nested data: objects, unions, data something else shapes, and the conditions
 * that reach across them.
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
  /*
   * V8 turns an object grown a computed key at a time past about sixteen
   * fields into a hash table: some 800 bytes more each, held as long as the
   * document. A mesh's material is twenty-six fields, and a scene of 9 000
   * meshes held 7 MB more in the editor than when its file was read whole.
   * Asked of V8 itself, the only one that can say.
   */
  it('builds an object of many fields as V8 keeps a fast one, the first time', () => {
    setFlagsFromString('--allow-natives-syntax');
    const hasFastProperties = new Function('value', 'return %HasFastProperties(value)');
    const fields: Record<string, SchemaField> = {};
    for (let at = 0; at < 26; at += 1) fields[`wide${at}`] = { type: 'number', label: `Wide ${at}`, default: at };
    const wide = planFields(fields);

    const decoded = wide.decode(JSON.parse(JSON.stringify(wide.defaults)), []);

    expect(decoded.ok && hasFastProperties(decoded.value)).toBe(true);
  });

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

// ---------------------------------------------------------------- nested data

/** Data something else shapes: a script's declared properties, say. Strings among them may name an entity. */
type Props = Record<string, number | string | boolean>;

function decodeProps(value: unknown, path: DecodePath): Decoded<Props> {
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [{ code: 'field.invalid', message: 'expected properties', path }] };
  }
  const out: Props = {};
  const diagnostics: Diagnostic[] = [];
  for (const [key, held] of Object.entries(value)) {
    if (typeof held === 'number' || typeof held === 'string' || typeof held === 'boolean') out[key] = held;
    else diagnostics.push({ code: 'field.invalid', message: 'expected a number, a string or true or false', path: [...path, key] });
  }
  return diagnostics.length === 0 ? { ok: true, value: out } : { ok: false, diagnostics };
}

/**
 * Every kind and fact the kernel adds for nested data, in a type shaped like a
 * light with a body: an object whose rows follow a field around it, a union, an
 * entity, data shaped elsewhere.
 */
const lamp = {
  name: { type: 'string', label: 'Name', default: 'Lamp' },
  tiling: { type: 'vec2', label: 'Tiling', default: [1, 1], min: 0, step: 0.1 },
  // Stored in radians, its bounds written in the degrees its row shows.
  angle: { type: 'number', label: 'Angle', default: Math.PI / 4, min: 0, max: 90, unit: 'radians' },
  follow: { type: 'entity', label: 'Follow', emptyLabel: 'World' },
  note: { type: 'string', label: 'Note', default: '', shown: false },
  kind: {
    type: 'enum',
    label: 'Kind',
    default: 'spot',
    options: [
      { value: 'spot', label: 'Spot' },
      { value: 'point', label: 'Point' },
      { value: 'sun', label: 'Sun' },
    ],
  },
  castShadow: { type: 'boolean', label: 'Cast shadow', default: true },
  shadow: {
    type: 'object',
    label: 'Shadow',
    separatorBefore: true,
    shownWhen: { field: 'castShadow', equals: true },
    fields: {
      bias: { type: 'number', label: 'Bias', default: 0 },
      // `kind` is no field of the shadow: it is found in the light around it.
      size: { type: 'number', label: 'Size', default: 10, shownWhen: { field: 'kind', equals: 'sun' } },
      focus: { type: 'number', label: 'Focus', default: 1, shownWhen: { field: 'kind', oneOf: ['spot', 'point'] } },
      map: { type: 'asset', label: 'Map', kind: 'texture', emptyLabel: 'None' },
      strength: { type: 'number', label: 'Strength', default: 1, shownWhen: { field: 'map', notEquals: null } },
    },
  },
  body: {
    type: 'union',
    label: 'Body',
    default: 'box',
    variants: {
      box: { label: 'Box', fields: { size: { type: 'vec3', label: 'Size', default: [1, 1, 1] } } },
      ball: {
        label: 'Ball',
        fields: {
          radius: { type: 'number', label: 'Radius', default: 0.5 },
          skin: { type: 'asset', label: 'Skin', kind: 'texture' },
        },
      },
      tether: { label: 'Tether', fields: { to: { type: 'entity', label: 'To' } } },
    },
  },
  props: { type: 'custom', label: 'Properties', default: {}, decode: decodeProps, candidates: true },
} as const satisfies Schema;

const lampPlan = planFields(lamp);
const target = fixedId('entity', 'target');
const other = fixedId('entity', 'other');
const skin = fixedId('asset', 'skin');

/** A lamp every field accepts, most of them away from their defaults. */
function storedLamp(): Record<string, unknown> {
  return {
    name: 'Desk lamp',
    tiling: [2, 0.5],
    angle: 1.2,
    follow: target,
    note: 'hidden, and kept',
    kind: 'point',
    castShadow: false,
    shadow: { bias: 0.01, size: 20, focus: 2, map: sprite, strength: 0.5 },
    body: { kind: 'ball', radius: 2, skin },
    props: { speed: 3, aim: other, label: 'hello', loud: true },
  };
}

/** The code and the path of each fault of a decoded value. */
function faults(decoded: Decoded<unknown>): (string | number)[][] {
  return decoded.ok ? [] : decoded.diagnostics.map(({ code, path }) => [code, ...path]);
}

describe('nested data', () => {
  it('gives each field its default: an object its fields\', a union its default variant\'s, data shaped elsewhere its own', () => {
    expect(lampPlan.defaults).toEqual({
      name: 'Lamp',
      tiling: [1, 1],
      angle: Math.PI / 4,
      follow: null,
      note: '',
      kind: 'spot',
      castShadow: true,
      shadow: { bias: 0, size: 10, focus: 1, map: null, strength: 1 },
      body: { kind: 'box', size: [1, 1, 1] },
      props: {},
    });
  });

  it('decodes a value of every kind, the active variant\'s fields alone', () => {
    const given = storedLamp();

    expect(lampPlan.decode(given, ['lamp'])).toEqual({ ok: true, value: given });
    expect(lampPlan.decode({ ...given, body: { kind: 'tether', to: null } }, [])).toMatchObject({ ok: true });
  });

  it('keeps the facts that are only the editor\'s out of the data: a hidden field, a unit, an empty choice\'s name', () => {
    const decoded = lampPlan.decode({ ...storedLamp(), angle: 100, follow: null }, []);

    expect(decoded).toMatchObject({ ok: true, value: { angle: 100, note: 'hidden, and kept', follow: null } });
  });

  it.each([
    [{ tiling: [1] }, ['field.invalid', 'lamp', 'tiling']],
    [{ tiling: [1, '2'] }, ['field.invalid', 'lamp', 'tiling']],
    [{ name: 3 }, ['field.invalid', 'lamp', 'name']],
    [{ follow: '' }, ['field.invalid', 'lamp', 'follow']],
    [{ follow: 7 }, ['field.invalid', 'lamp', 'follow']],
    [{ shadow: 3 }, ['field.invalid', 'lamp', 'shadow']],
    [{ shadow: { bias: 'x', size: 1, focus: 1, map: null, strength: 1 } }, ['field.invalid', 'lamp', 'shadow', 'bias']],
    [{ shadow: { bias: 0, focus: 1, map: null, strength: 1 } }, ['field.missing', 'lamp', 'shadow', 'size']],
    [{ shadow: { bias: 0, size: 1, focus: 1, map: null, strength: 1, blur: 2 } }, ['field.unexpected', 'lamp', 'shadow', 'blur']],
    [{ body: { kind: 'cone', radius: 1 } }, ['variant.unknown', 'lamp', 'body', 'kind']],
    [{ body: { size: [1, 1, 1] } }, ['variant.unknown', 'lamp', 'body', 'kind']],
    [{ body: 'box' }, ['field.invalid', 'lamp', 'body']],
    [{ body: { kind: 'ball', radius: 1 } }, ['field.missing', 'lamp', 'body', 'skin']],
    [{ body: { kind: 'box', size: [1, 1, 1], radius: 1 } }, ['field.unexpected', 'lamp', 'body', 'radius']],
    [{ body: { kind: 'tether', to: '' } }, ['field.invalid', 'lamp', 'body', 'to']],
    [{ props: { speed: [] } }, ['field.invalid', 'lamp', 'props', 'speed']],
    [{ props: 'fast' }, ['field.invalid', 'lamp', 'props']],
  ])('refuses %j, naming where the fault sits', (change, fault) => {
    expect(faults(lampPlan.decode({ ...storedLamp(), ...change }, ['lamp']))).toEqual([fault]);
  });

  it('says which variants a union knows when its key names none', () => {
    const decoded = lampPlan.decode({ ...storedLamp(), body: { kind: 'cone' } }, []);

    expect(decoded).toMatchObject({
      diagnostics: [{ code: 'variant.unknown', message: 'expected one of "box", "ball", "tether", found "cone"' }],
    });
  });

  it('collects the faults of every level at once', () => {
    const decoded = lampPlan.decode(
      { ...storedLamp(), name: 1, shadow: { bias: 'x', size: 1, focus: 1, map: '', strength: 1 }, props: { a: null } },
      [],
    );

    expect(faults(decoded)).toEqual([
      ['field.invalid', 'name'],
      ['field.invalid', 'shadow', 'bias'],
      ['field.invalid', 'shadow', 'map'],
      ['field.invalid', 'props', 'a'],
    ]);
  });
});

describe('conditions', () => {
  /** A schema `lamp`'s shadow, with one of its fields' conditions replaced. */
  function shadowWhen(field: SchemaField): Schema {
    return { ...lamp, shadow: { ...lamp.shadow, fields: { ...lamp.shadow.fields, size: field } } };
  }

  it('are found in the object a field sits in, else in the ones around it, the nearest first', () => {
    const nearest = {
      kind: { type: 'enum', label: 'Kind', default: 'a', options: [{ value: 'a', label: 'A' }] },
      inner: {
        type: 'object',
        label: 'Inner',
        fields: {
          kind: { type: 'enum', label: 'Kind', default: 'b', options: [{ value: 'b', label: 'B' }] },
          // The inner `kind` holds no "a": found first, it is the one this reads.
          size: { type: 'number', label: 'Size', default: 1, shownWhen: { field: 'kind', equals: 'a' } },
        },
      },
    } satisfies Schema;

    expect(() => planFields(lamp)).not.toThrow();
    expect(() => planFields(nearest)).toThrow('inner.size: shown when "kind" equals "a"');
  });

  it('are refused at once when the field they read is found nowhere around them', () => {
    expect(() =>
      planFields(shadowWhen({ type: 'number', label: 'Size', default: 1, shownWhen: { field: 'mode', equals: 'sun' } })),
    ).toThrow('shadow.size: shown when "mode", which is no field of its object nor of one around it');
  });

  it('do not reach into a sibling: a variant cannot read the shadow\'s bias', () => {
    const bad = {
      ...lamp,
      body: {
        ...lamp.body,
        variants: {
          ...lamp.body.variants,
          box: {
            label: 'Box',
            fields: { size: { type: 'vec3', label: 'Size', default: [1, 1, 1], shownWhen: { field: 'bias', equals: 0 } } },
          },
        },
      },
    } satisfies Schema;

    expect(() => planFields(bad)).toThrow('body.box.size: shown when "bias", which is no field');
  });

  it.each([
    [{ field: 'kind', oneOf: ['spot', 'cone'] }, 'is one of "spot", "cone"'],
    [{ field: 'castShadow', notEquals: 'yes' }, 'differs from "yes"'],
    [{ field: 'shadow', equals: true }, 'equals true'],
  ] satisfies [ShownWhen, string][])('refuses %j, a value its field cannot hold', (shownWhen, said) => {
    expect(() => planFields(shadowWhen({ type: 'number', label: 'Size', default: 1, shownWhen }))).toThrow(
      `shadow.size: shown when "${shownWhen.field}" ${said}, which that field cannot hold`,
    );
  });

  it('hold as each form says', () => {
    expect(conditionHolds({ field: 'kind', equals: 'sun' }, 'sun')).toBe(true);
    expect(conditionHolds({ field: 'kind', equals: 'sun' }, 'spot')).toBe(false);
    expect(conditionHolds({ field: 'kind', oneOf: ['spot', 'point'] }, 'point')).toBe(true);
    expect(conditionHolds({ field: 'kind', oneOf: ['spot', 'point'] }, 'sun')).toBe(false);
    expect(conditionHolds({ field: 'map', notEquals: null }, sprite)).toBe(true);
    expect(conditionHolds({ field: 'map', notEquals: null }, null)).toBe(false);
  });
});

describe('a union', () => {
  it('is refused when its default names no variant', () => {
    const bad = { body: { ...lamp.body, default: 'cone' } } satisfies Schema;

    expect(() => planFields(bad)).toThrow('body.kind: its default');
  });

  it('is refused when a variant\'s field is refused, though that variant is not the default', () => {
    const bad = {
      body: {
        ...lamp.body,
        variants: { ...lamp.body.variants, ball: { label: 'Ball', fields: { radius: { type: 'number', label: 'Radius', default: Number.NaN } } } },
      },
    } satisfies Schema;

    expect(() => planFields(bad)).toThrow('body.radius: its default');
  });

  it('is refused when a variant names a field `kind`, the key that names the variant', () => {
    const bad = {
      body: {
        ...lamp.body,
        variants: { box: { label: 'Box', fields: { kind: { type: 'string', label: 'Kind', default: '' } } } },
      },
    } satisfies Schema;

    expect(() => planFields(bad)).toThrow('body.box.kind: ');
  });

  it('makes a variant at its defaults, a fresh one each time', () => {
    const ball = lampPlan.createVariant('body', 'ball');
    const box = lampPlan.createVariant('body', 'box');

    expect(ball).toEqual({ kind: 'ball', radius: 0.5, skin: null });
    expect(box).toEqual({ kind: 'box', size: [1, 1, 1] });
    expect(box).not.toBe(lampPlan.createVariant('body', 'box'));
    expect(box.kind === 'box' && box.size).not.toBe(lampPlan.defaults.body.kind === 'box' && lampPlan.defaults.body.size);
  });
});

describe('the references of nested data', () => {
  it('are read through objects and the active variant alone, in the schema\'s order', () => {
    const value = { ...lampPlan.defaults, shadow: { ...lampPlan.defaults.shadow, map: sprite } };

    expect(lampPlan.assets(value)).toEqual([sprite]);
    expect(lampPlan.assets({ ...value, body: { kind: 'ball', radius: 1, skin } })).toEqual([sprite, skin]);
    expect(lampPlan.entities({ ...value, follow: target })).toEqual([target]);
    expect(lampPlan.entities({ ...value, body: { kind: 'tether', to: other } })).toEqual([null, other]);
  });

  it('count every string of data shaped elsewhere as a candidate, where a field declares it may name one', () => {
    const value = { ...lampPlan.defaults, props: { speed: 3, aim: other, label: 'hello', loud: true } };

    expect(lampPlan.candidates(value)).toEqual([other, 'hello']);
    expect(lampPlan.candidates(lampPlan.defaults)).toEqual([]);
  });

  it('are renamed where they name an entity — its fields, and the candidates equal to an id — in a value of their own', () => {
    const given = {
      ...lampPlan.defaults,
      follow: target,
      body: { kind: 'tether', to: other },
      props: { aim: target, label: 'hello', count: 2 },
    } satisfies Infer<typeof lamp>;
    const copy = fixedId('entity', 'copy');
    const renamed = lampPlan.renameEntities(given, (id) => (id === target ? copy : undefined));

    expect(renamed).toEqual({ ...given, follow: copy, props: { aim: copy, label: 'hello', count: 2 } });
    expect(given.follow).toBe(target);
    expect(lampPlan.renameEntities(given, () => undefined)).toEqual(given);
  });
});

describe('the types of nested data', () => {
  type Lamp = Infer<typeof lamp>;

  it('infer each kind\'s value', () => {
    expectTypeOf<Lamp['name']>().toEqualTypeOf<string>();
    expectTypeOf<Lamp['tiling']>().toEqualTypeOf<Vec2>();
    expectTypeOf<Lamp['angle']>().toEqualTypeOf<number>();
    expectTypeOf<Lamp['follow']>().toEqualTypeOf<EntityId | null>();
    expectTypeOf<Lamp['shadow']>().toEqualTypeOf<{
      bias: number;
      size: number;
      focus: number;
      map: AssetId | null;
      strength: number;
    }>();
    expectTypeOf<Lamp['props']>().toEqualTypeOf<Props>();
  });

  it('infer a union discriminated by `kind`, narrowed by it', () => {
    expectTypeOf<Lamp['body']>().toEqualTypeOf<
      | { kind: 'box'; size: Vec3 }
      | { kind: 'ball'; radius: number; skin: AssetId | null }
      | { kind: 'tether'; to: EntityId | null }
    >();
    expectTypeOf<Extract<Lamp['body'], { kind: 'ball' }>>().toEqualTypeOf<{
      kind: 'ball';
      radius: number;
      skin: AssetId | null;
    }>();
    expectTypeOf(lampPlan.createVariant('body', 'ball')).toEqualTypeOf<Lamp['body']>();
    expectTypeOf<Parameters<typeof lampPlan.createVariant<'body'>>[1]>().toEqualTypeOf<'box' | 'ball' | 'tether'>();
  });

  /*
   * A schema the size of a mesh's — thirteen primitives, a 26-field material —
   * inferring exactly the types the mesh is written with today. It pins the
   * compiler's cost on the largest schema the kernel types are expected to
   * describe: `npm run typecheck` is timed with it.
   */
  const radiusDetail = {
    radius: { type: 'number', label: 'Radius', default: 0.5, min: 0, step: 0.05 },
    detail: { type: 'number', label: 'Detail', default: 0, min: 0, max: 5, step: 1 },
  } as const;
  const map = (label: string) => ({ type: 'asset', label, kind: 'texture' }) as const;
  const meshLike = {
    geometry: {
      type: 'union',
      label: 'Primitive',
      default: 'box',
      shown: false,
      variants: {
        box: {
          label: 'Cube',
          fields: {
            width: { type: 'number', label: 'Width', default: 1 },
            height: { type: 'number', label: 'Height', default: 1 },
            depth: { type: 'number', label: 'Depth', default: 1 },
            widthSegments: { type: 'number', label: 'Width segments', default: 1 },
            heightSegments: { type: 'number', label: 'Height segments', default: 1 },
            depthSegments: { type: 'number', label: 'Depth segments', default: 1 },
          },
        },
        sphere: {
          label: 'Sphere',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.5 },
            widthSegments: { type: 'number', label: 'Width segments', default: 32 },
            heightSegments: { type: 'number', label: 'Height segments', default: 16 },
          },
        },
        plane: {
          label: 'Plane',
          fields: {
            width: { type: 'number', label: 'Width', default: 10 },
            height: { type: 'number', label: 'Height', default: 10 },
            widthSegments: { type: 'number', label: 'Width segments', default: 1 },
            heightSegments: { type: 'number', label: 'Height segments', default: 1 },
          },
        },
        capsule: {
          label: 'Capsule',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.5 },
            height: { type: 'number', label: 'Height', default: 1 },
            capSegments: { type: 'number', label: 'Cap segments', default: 8 },
            radialSegments: { type: 'number', label: 'Radial segments', default: 16 },
          },
        },
        cylinder: {
          label: 'Cylinder',
          fields: {
            radiusTop: { type: 'number', label: 'Radius top', default: 0.5 },
            radiusBottom: { type: 'number', label: 'Radius bottom', default: 0.5 },
            height: { type: 'number', label: 'Height', default: 1 },
            radialSegments: { type: 'number', label: 'Radial segments', default: 24 },
          },
        },
        circle: {
          label: 'Circle',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.5 },
            segments: { type: 'number', label: 'Segments', default: 32 },
          },
        },
        ring: {
          label: 'Ring',
          fields: {
            innerRadius: { type: 'number', label: 'Inner radius', default: 0.25 },
            outerRadius: { type: 'number', label: 'Outer radius', default: 0.5 },
            thetaSegments: { type: 'number', label: 'Segments', default: 32 },
          },
        },
        torus: {
          label: 'Torus',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.4 },
            tube: { type: 'number', label: 'Tube', default: 0.15 },
            radialSegments: { type: 'number', label: 'Radial segments', default: 16 },
            tubularSegments: { type: 'number', label: 'Tubular segments', default: 48 },
          },
        },
        torusKnot: {
          label: 'Torus Knot',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.4 },
            tube: { type: 'number', label: 'Tube', default: 0.12 },
            tubularSegments: { type: 'number', label: 'Tubular segments', default: 96 },
            radialSegments: { type: 'number', label: 'Radial segments', default: 16 },
            p: { type: 'number', label: 'P', default: 2 },
            q: { type: 'number', label: 'Q', default: 3 },
          },
        },
        tetrahedron: { label: 'Tetrahedron', fields: radiusDetail },
        octahedron: { label: 'Octahedron', fields: radiusDetail },
        dodecahedron: { label: 'Dodecahedron', fields: radiusDetail },
        icosahedron: { label: 'Icosahedron', fields: radiusDetail },
      },
    },
    material: {
      type: 'object',
      label: 'Material',
      fields: {
        color: { type: 'color', label: 'Color', default: '#b7b7b7' },
        roughness: { type: 'number', label: 'Roughness', default: 0.75, min: 0, max: 1 },
        metalness: { type: 'number', label: 'Metalness', default: 0, min: 0, max: 1 },
        emissive: { type: 'color', label: 'Emissive', default: '#000000' },
        emissiveIntensity: { type: 'number', label: 'Emissive intensity', default: 1 },
        opacity: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1 },
        transparent: { type: 'boolean', label: 'Transparent', default: false },
        wireframe: { type: 'boolean', label: 'Wireframe', default: false },
        side: {
          type: 'enum',
          label: 'Side',
          default: 'front',
          options: [
            { value: 'front', label: 'Front' },
            { value: 'back', label: 'Back' },
            { value: 'double', label: 'Double' },
          ],
        },
        colorMap: map('Color map'),
        normalMap: map('Normal map'),
        normalScale: { type: 'number', label: 'Normal scale', default: 1, shownWhen: { field: 'normalMap', notEquals: null } },
        bumpMap: map('Bump map'),
        bumpScale: { type: 'number', label: 'Bump scale', default: 1, shownWhen: { field: 'bumpMap', notEquals: null } },
        roughnessMap: map('Roughness map'),
        metalnessMap: map('Metalness map'),
        emissiveMap: map('Emissive map'),
        aoMap: map('AO map'),
        aoIntensity: { type: 'number', label: 'AO intensity', default: 1, shownWhen: { field: 'aoMap', notEquals: null } },
        alphaMap: map('Alpha map'),
        displacementMap: map('Displacement map'),
        displacementScale: { type: 'number', label: 'Displacement scale', default: 0.1 },
        displacementBias: { type: 'number', label: 'Displacement bias', default: 0 },
        tiling: { type: 'vec2', label: 'Tiling', default: [1, 1] },
        offset: { type: 'vec2', label: 'Offset', default: [0, 0] },
        wrap: {
          type: 'enum',
          label: 'Wrap',
          default: 'repeat',
          options: [
            { value: 'repeat', label: 'Repeat' },
            { value: 'clamp', label: 'Clamp' },
            { value: 'mirror', label: 'Mirror' },
          ],
        },
      },
    },
  } as const satisfies Schema;

  it('infer, for a schema the size of a mesh\'s, the types written by hand today', () => {
    const meshPlan = planFields(meshLike);

    expectTypeOf<Infer<typeof meshLike>['geometry']>().toEqualTypeOf<GeometryDef>();
    expectTypeOf<Infer<typeof meshLike>['material']>().toEqualTypeOf<MaterialDef>();
    expect(meshPlan.createVariant('geometry', 'torusKnot')).toEqual({
      kind: 'torusKnot',
      radius: 0.4,
      tube: 0.12,
      tubularSegments: 96,
      radialSegments: 16,
      p: 2,
      q: 3,
    });
    expect(Object.keys(meshPlan.defaults.material)).toHaveLength(26);
  });
});
