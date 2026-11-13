import { assertDefined } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

describe('assertDefined', () => {
  it('hands back the value it was given', () => {
    const row = { id: 'a' };

    expect(assertDefined(row, 'the row')).toBe(row);
  });

  it('takes 0, an empty string and false for values: only undefined and null are missing', () => {
    expect(assertDefined(0, 'the count')).toBe(0);
    expect(assertDefined('', 'the name')).toBe('');
    expect(assertDefined(false, 'the flag')).toBe(false);
  });

  it('types the value without undefined or null', () => {
    const rows: string[] = ['a'];
    const parents = new Map<string, string | null>([['child', 'root']]);

    // The annotations are the test: under `noUncheckedIndexedAccess` an index
    // gives `string | undefined`, and the lookup `string | null | undefined`.
    // Neither line compiles unless both are gone from what comes back.
    const first: string = assertDefined(rows[0], 'the first row');
    const parent: string = assertDefined(parents.get('child'), 'the parent of child');

    expect([first, parent]).toEqual(['a', 'root']);
  });

  it('throws on undefined and on null, naming what was missing', () => {
    const rows: string[] = [];

    expect(() => assertDefined(rows[0], 'the first row')).toThrow(
      'Expected the first row to be defined, got undefined',
    );
    expect(() => assertDefined(null, 'the parent')).toThrow('Expected the parent to be defined, got null');
  });
});
