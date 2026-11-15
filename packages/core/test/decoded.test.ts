import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  checks,
  fixedId,
  formatDiagnostics,
  nullable,
  oneOf,
  RecordReader,
  unwrap,
  versionRefusal,
  type AssetId,
  type Decoded,
  type DecodePath,
  type Diagnostic,
  type EntityId,
  type Vec3,
} from '../src/index';

/*
 * What every decoder shares: the leaf checks, the reader a decoder written by
 * hand reads a record with, and the words a refusal is given. A schema's
 * decoder and a file's shell decoder answer a fault the same way because they
 * read through these.
 */

const sprite = fixedId('asset', 'spark');

/** A record a decoder written by hand might read: a few leaves, a nested record, a record keyed by ids. */
function given(): Record<string, unknown> {
  return {
    name: 'Lamp',
    count: 3,
    on: true,
    tint: '#ffb86b',
    offset: [0, 1, 0],
    mode: 'fast',
    sprite,
    inner: { depth: 2 },
    byId: { a: 1, b: 2 },
  };
}

interface Read {
  name: string;
  count: number;
  on: boolean;
  tint: string;
  offset: Vec3;
  mode: 'fast' | 'slow';
  sprite: AssetId | null;
  depth: number;
  ids: string[];
}

/** Reads `given()`'s shape with every kind of read the reader offers. */
function read(value: unknown, path: DecodePath = []): Decoded<Read> {
  const reader = new RecordReader(value, path);
  const inner = reader.record('inner');
  const byId = reader.record('byId');
  return reader.done({
    name: reader.read('name', checks.string),
    count: reader.read('count', checks.number),
    on: reader.read('on', checks.boolean),
    tint: reader.read('tint', checks.color),
    offset: reader.read('offset', checks.vec3),
    mode: reader.read('mode', oneOf(['fast', 'slow'])),
    sprite: reader.read('sprite', nullable(checks.assetId)),
    depth: inner.read('depth', checks.number),
    ids: byId.keys(),
  });
}

/** The code and the path of each fault, in the order they were found. */
function faults(decoded: Decoded<unknown>): (string | number)[][] {
  return decoded.ok ? [] : decoded.diagnostics.map(({ code, path }) => [code, ...path]);
}

describe('a record reader', () => {
  it('reads each field typed, and answers the value it read', () => {
    expect(read(given())).toEqual({
      ok: true,
      value: {
        name: 'Lamp',
        count: 3,
        on: true,
        tint: '#ffb86b',
        offset: [0, 1, 0],
        mode: 'fast',
        sprite,
        depth: 2,
        ids: ['a', 'b'],
      },
    });
  });

  it('records a missing field at its path, and answers a stand-in so the reading goes on', () => {
    const reader = new RecordReader({ name: 'Lamp' }, ['lamp']);

    expect(reader.read('count', checks.number)).toBe(0);
    expect(reader.read('name', checks.string)).toBe('Lamp');
    expect(faults(reader.done(null))).toEqual([['field.missing', 'lamp', 'count']]);
  });

  it('records a value of the wrong kind with what was expected and what was found', () => {
    const reader = new RecordReader({ ...given(), tint: 'red' }, ['lamp']);

    expect(reader.read('tint', checks.color)).toBe('#000000');
    expect(reader.read('mode', oneOf(['fast', 'slow']))).toBe('fast');
    reader.keys();
    expect(reader.done(null)).toEqual({
      ok: false,
      diagnostics: [{ code: 'field.invalid', message: 'expected a colour written #rrggbb, found "red"', path: ['lamp', 'tint'] }],
    });
  });

  it.each([
    ['count', 'three', checks.number, 'a finite number'],
    ['on', 1, checks.boolean, 'true or false'],
    ['name', 4, checks.string, 'a string'],
    ['offset', [0, 1], checks.vec3, 'three finite numbers'],
    ['offset', [0, Number.NaN, 1], checks.vec3, 'three finite numbers'],
    ['sprite', '', nullable(checks.assetId), 'an asset id or null'],
  ] satisfies [string, unknown, { expected: string }, string][])(
    'refuses %s: %j, expecting %s',
    (key, value, _check, expected) => {
      const decoded = read({ ...given(), [key]: value });

      expect(decoded).toMatchObject({ ok: false, diagnostics: [{ code: 'field.invalid', path: [key] }] });
      expect(decoded.ok ? '' : decoded.diagnostics[0]?.message).toMatch(new RegExp(`^expected ${expected}, found `));
    },
  );

  it('reads a nested record at its own path, and refuses it once when it is none', () => {
    expect(faults(read({ ...given(), inner: { depth: 'deep' } }, ['lamp']))).toEqual([
      ['field.invalid', 'lamp', 'inner', 'depth'],
    ]);
    expect(faults(read({ ...given(), inner: 7 }, ['lamp']))).toEqual([['field.invalid', 'lamp', 'inner']]);

    const missing = given();
    delete missing['inner'];
    expect(faults(read(missing, ['lamp']))).toEqual([['field.missing', 'lamp', 'inner']]);
  });

  it('refuses a value that is no record once, and reads nothing more of it', () => {
    for (const value of [null, [], 'lamp', 3]) {
      expect(read(value, ['lamp'])).toEqual({
        ok: false,
        diagnostics: [{ code: 'field.invalid', message: expect.stringMatching(/^expected an object, found /), path: ['lamp'] }],
      });
    }
  });

  it('refuses, once every field is read, each key nobody read — nested records included', () => {
    const decoded = read({ ...given(), extra: 1, inner: { depth: 2, deeper: true } }, ['lamp']);

    expect(decoded).toEqual({
      ok: false,
      diagnostics: [
        { code: 'field.unexpected', message: 'is no field this build reads', path: ['lamp', 'extra'] },
        { code: 'field.unexpected', message: 'is no field this build reads', path: ['lamp', 'inner', 'deeper'] },
      ],
    });
  });

  it('takes a key named like what every object inherits as a key like any other', () => {
    expect(faults(read({ ...given(), constructor: 1 }))).toEqual([['field.unexpected', 'constructor']]);

    const reader = new RecordReader({ toString: 1 });
    expect(reader.read('valueOf', checks.number)).toBe(0);
    expect(faults(reader.done(null))).toEqual([['field.missing', 'valueOf'], ['field.unexpected', 'toString']]);
  });

  it('hands a field to a decoder of its own at its path, and keeps that decoder\'s faults', () => {
    const even = (value: unknown, path: DecodePath): Decoded<number> =>
      typeof value === 'number' && value % 2 === 0
        ? { ok: true, value }
        : { ok: false, diagnostics: [{ code: 'field.invalid', message: 'expected an even number', path }] };
    const reader = new RecordReader({ a: 4, b: 3 }, ['pair']);

    expect(reader.decode('a', even)).toBe(4);
    expect(reader.decode('b', even)).toBeUndefined();
    expect(reader.decode('c', even)).toBeUndefined();
    expect(reader.done(null)).toEqual({
      ok: false,
      diagnostics: [
        { code: 'field.invalid', message: 'expected an even number', path: ['pair', 'b'] },
        { code: 'field.missing', message: 'is missing', path: ['pair', 'c'] },
      ],
    });
  });

  it('refuses what only the decoder can judge, at the field it names', () => {
    const reader = new RecordReader({ id: 'b' }, ['entities', 'a']);
    reader.read('id', checks.string);
    reader.refuse('id', 'field.invalid', 'expected "a", the key the entity is filed under');

    expect(faults(reader.done(null))).toEqual([['field.invalid', 'entities', 'a', 'id']]);
  });

  it('types each read by its check', () => {
    const reader = new RecordReader({});

    expectTypeOf(reader.read('n', checks.number)).toEqualTypeOf<number>();
    expectTypeOf(reader.read('v', checks.vec2)).toEqualTypeOf<[number, number]>();
    expectTypeOf(reader.read('e', nullable(checks.entityId))).toEqualTypeOf<EntityId | null>();
    expectTypeOf(reader.read('m', oneOf(['a', 'b']))).toEqualTypeOf<'a' | 'b'>();
  });
});

describe('a version refusal', () => {
  it('is one diagnostic: the version found, the version this build reads, and that nothing converts it', () => {
    expect(versionRefusal(3, 4)).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'format.version',
          message: 'written in format 3; this build reads format 4 and does not convert it',
          path: ['version'],
        },
      ],
    });
  });

  it('says so when the file states no version at all', () => {
    expect(versionRefusal(undefined, 4)).toMatchObject({
      diagnostics: [{ message: 'written in no format this build knows (found undefined); this build reads format 4 and does not convert it' }],
    });
  });
});

describe('a refusal, in words', () => {
  const fault = (index: number): Diagnostic => ({
    code: 'field.invalid',
    message: `expected a finite number, found "${index}"`,
    path: ['entities', `e${index}`, 'count'],
  });

  it('names the file, then each fault after its path', () => {
    expect(formatDiagnostics('scenes/main.scene.json', [fault(1), fault(2)])).toBe(
      [
        'scenes/main.scene.json',
        'entities.e1.count: expected a finite number, found "1"',
        'entities.e2.count: expected a finite number, found "2"',
      ].join('\n'),
    );
  });

  it('spells out the first twenty, and says how many more', () => {
    const lines = formatDiagnostics('big.json', Array.from({ length: 25 }, (_, index) => fault(index))).split('\n');

    expect(lines).toHaveLength(22);
    expect(lines.at(-2)).toBe('entities.e19.count: expected a finite number, found "19"');
    expect(lines.at(-1)).toBe('and 5 more');
  });

  it('gives a fault of the whole file its message alone', () => {
    expect(
      formatDiagnostics('project.json', [{ code: 'field.invalid', message: 'expected an object, found 3', path: [] }]),
    ).toBe('project.json\nexpected an object, found 3');
  });
});

describe('unwrap', () => {
  it('answers the value read', () => {
    expect(unwrap({ ok: true, value: 7 }, 'seven.json')).toBe(7);
  });

  it('throws the refusal in words, for a caller that cannot go on without the file', () => {
    expect(() => unwrap(versionRefusal(3, 4), 'project.json')).toThrow(
      'project.json\nversion: written in format 3; this build reads format 4 and does not convert it',
    );
  });
});
