import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/json';

describe('deepFreeze', () => {
  it('freezes a value and every object and array under it, and hands it back', () => {
    const value = { a: 1, nested: { list: [1, [2, 3]], deeper: { b: 'b' } } };

    expect(deepFreeze(value)).toBe(value);

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.nested.list)).toBe(true);
    expect(Object.isFrozen(value.nested.list[1])).toBe(true);
    expect(Object.isFrozen(value.nested.deeper)).toBe(true);
    expect(() => Object.assign(value.nested.deeper, { b: 'c' })).toThrow(TypeError);
  });

  it('hands a frozen value back as it is, without walking it again', () => {
    const inner = { b: 1 };
    const frozen = Object.freeze({ inner });

    expect(deepFreeze(frozen)).toBe(frozen);
    // Frozen whole is taken to be frozen all through, as immer freezes: not walked.
    expect(Object.isFrozen(inner)).toBe(false);
  });

  it('leaves what holds no field alone', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze('text')).toBe('text');
  });
});
