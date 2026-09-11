import { FORBIDDEN_FILE_NAME_CHARS, safeFileName } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The one rule, which used to be two.
 *
 * Project folders and scenes went through one character class, asset folders
 * and the material and prefab libraries through another, and they landed in the
 * same tree. Only the first took out the control codes.
 */

describe('a name that has to become a file', () => {
  it('replaces what a path cannot carry', () => {
    expect(safeFileName('a/b')).toBe('a-b');
    expect(safeFileName('Boss: The Return')).toBe('Boss- The Return');
  });

  it('takes out the control codes, which the asset rule did not', () => {
    // Invisible in every UI there is, so a name carrying one reads as identical
    // to a name that does not and is a different file.
    expect(safeFileName('Brick')).toBe('Br-ick');
  });

  it('drops the trailing dots and spaces Windows would drop silently', () => {
    // Silently is the problem: the name on disk then differs from the one that
    // was asked for, and every one of these is read back out of its own path.
    expect(safeFileName('Level 1. ')).toBe('Level 1');
    expect(safeFileName('Props...')).toBe('Props');
  });

  it('keeps single spaces and collapses runs of them', () => {
    expect(safeFileName('My Project')).toBe('My Project');
    expect(safeFileName('My   Project')).toBe('My Project');
  });

  it('answers with nothing when nothing is left', () => {
    // The caller decides what that means: a material called `...` falls back to
    // `Material`, and a scene called `...` is refused.
    expect(safeFileName('...')).toBe('');
    expect(safeFileName('   ')).toBe('');
    // A forbidden character is *replaced*, so a name of nothing but those is a
    // name of dashes rather than no name at all.
    expect(safeFileName('///')).toBe('---');
  });

  it('offers the same rule as a question, for a dialog that must refuse', () => {
    expect(FORBIDDEN_FILE_NAME_CHARS.test('a/b')).toBe(true);
    expect(FORBIDDEN_FILE_NAME_CHARS.test('Props')).toBe(false);
    // Not global, so it does not carry `lastIndex` from one call to the next —
    // which would answer true, then false, then true on the same input.
    expect(FORBIDDEN_FILE_NAME_CHARS.test('a/b')).toBe(true);
  });
});
