import { formatLogArgs } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * How a console call's arguments are written, in the editor's Console and on a
 * device alike.
 *
 * Plain data reads as `JSON.stringify` writes it, which is how the editor's
 * Console has always read; the rest is what `JSON.stringify` could not be
 * trusted with — a class with a `toJSON` that does real work, a cycle, a value
 * it drops — and what it would write without end.
 */

describe('a console call’s arguments', () => {
  it('joins its arguments with a space', () => {
    expect(formatLogArgs(['a', 'b'])).toBe('a b');
    expect(formatLogArgs([])).toBe('');
  });

  it('keeps a string argument whole, however long', () => {
    const long = 'x'.repeat(5_000);

    expect(formatLogArgs([long])).toBe(long);
  });

  it('writes an error as its name and message', () => {
    expect(formatLogArgs([new Error('boom')])).toBe('Error: boom');
    expect(formatLogArgs([new TypeError('not a function')])).toBe('TypeError: not a function');
  });

  it('writes plain data exactly as JSON.stringify does', () => {
    const data = { a: 1, b: [1, 'x', null, true], c: { d: 'e' } };

    expect(formatLogArgs([data])).toBe(JSON.stringify(data));
    expect(formatLogArgs([[1, 2], 3, false, null])).toBe('[1,2] 3 false null');
    expect(formatLogArgs([Object.assign(Object.create(null), { a: 1 })])).toBe('{"a":1}');
  });

  it('writes out what JSON.stringify loses', () => {
    expect(formatLogArgs([undefined, Number.NaN, -Infinity, 10n])).toBe('undefined NaN -Infinity 10n');
    expect(formatLogArgs([{ a: undefined, b: [Infinity] }])).toBe('{"a":undefined,"b":[Infinity]}');
  });

  it('names a function, and writes a symbol', () => {
    function update() {}

    expect(formatLogArgs([update, Symbol('id')])).toBe('ƒ update Symbol(id)');
  });

  it('names an object’s class, then writes its own fields', () => {
    class Point {
      x = 1;
      y = 2;
    }

    expect(formatLogArgs([new Point()])).toBe('Point {"x":1,"y":2}');
    expect(formatLogArgs([{ at: new Point() }])).toBe('{"at":Point {"x":1,"y":2}}');
  });

  it('never calls toJSON', () => {
    // three's Object3D.toJSON serializes its whole subtree, every texture
    // drawn into a data URL — on each call of a script that logs a transform.
    let calls = 0;
    const heavy = {
      name: 'mesh',
      toJSON() {
        calls += 1;
        return 'serialized';
      },
    };

    const written = formatLogArgs([heavy, { child: heavy }]);

    expect(calls).toBe(0);
    expect(written).toContain('"name":"mesh"');
  });

  it('says where an object holds itself', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node['self'] = node;

    expect(formatLogArgs([node])).toBe('{"name":"root","self":[Circular]}');
  });

  it('writes an object met twice side by side, rather than calling it circular', () => {
    const shared = { a: 1 };

    expect(formatLogArgs([{ left: shared, right: shared }])).toBe(
      '{"left":{"a":1},"right":{"a":1}}',
    );
  });

  it('stops three levels deep', () => {
    expect(formatLogArgs([{ a: { b: { c: { d: 1 } } } }])).toBe('{"a":{"b":{"c":{…}}}}');
    expect(formatLogArgs([[[[[1]]]]])).toBe('[[[[…]]]]');
  });

  it('writes twenty fields or items a level, then an ellipsis', () => {
    const fields = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, i]));
    const items = Array.from({ length: 25 }, (_, i) => i);

    const writtenFields = formatLogArgs([fields]);
    const writtenItems = formatLogArgs([items]);

    expect(writtenFields).toContain('"f19":19,…}');
    expect(writtenFields).not.toContain('"f20"');
    expect(writtenItems).toBe(`[${items.slice(0, 20).join(',')},…]`);
  });

  it('cuts an argument at a thousand characters', () => {
    const written = formatLogArgs([{ text: 'x'.repeat(5_000) }]);

    expect(written).toHaveLength(1_000);
    expect(written.startsWith('{"text":"xxx')).toBe(true);
    expect(written.endsWith('…')).toBe(true);
  });

  it('cuts each argument on its own', () => {
    const written = formatLogArgs([{ a: 'x'.repeat(2_000) }, { b: 'y'.repeat(2_000) }]);

    expect(written).toHaveLength(2_001);
    expect(written).toContain('… {"b":"yyy');
  });

  it('writes a typed array, a buffer, a map and a set by their size', () => {
    expect(formatLogArgs([new Float32Array(3)])).toBe('Float32Array(3)');
    expect(formatLogArgs([new ArrayBuffer(16)])).toBe('ArrayBuffer(16)');
    expect(formatLogArgs([new Map([[1, 2]])])).toBe('Map(1)');
    expect(formatLogArgs([new Set(['a', 'b'])])).toBe('Set(2)');
    expect(formatLogArgs([{ positions: new Float32Array(3_000) }])).toBe(
      '{"positions":Float32Array(3000)}',
    );
  });

  it('writes a date as JSON.stringify does', () => {
    const date = new Date(Date.UTC(2026, 9, 1, 12, 30));

    expect(formatLogArgs([date])).toBe('"2026-10-01T12:30:00.000Z"');
    expect(formatLogArgs([{ at: date }])).toBe(JSON.stringify({ at: date }));
  });

  it('writes an error inside an object as a string of its name and message', () => {
    expect(formatLogArgs([{ error: new RangeError('too far') }])).toBe(
      '{"error":"RangeError: too far"}',
    );
  });

  it('writes a field that throws when read as unprintable, and returns', () => {
    const hostile = {
      ok: 1,
      get broken(): number {
        throw new Error('no');
      },
    };

    expect(formatLogArgs([hostile])).toBe('{"ok":1,"broken":[unprintable]}');
  });

  it('writes an object that cannot be looked into as unprintable', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('no');
        },
      },
    );

    expect(formatLogArgs(['before', hostile, 'after'])).toBe('before [unprintable] after');
  });
});
