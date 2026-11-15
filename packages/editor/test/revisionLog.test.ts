import type { Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { revisionLog } from '../src/state/revisionLog';

/*
 * What a patch set touched, read off the paths immer writes. The paths are text,
 * and the entity at the one place that names it is read as the id it has to be.
 */

/** The revision to ask from, so that only what a test notes is answered. */
const now = () => revisionLog.since(0).revision;

const replacing = (...path: (string | number)[]): Patch => ({ op: 'replace', path, value: new Map() });

describe('what the log says a patch set touched', () => {
  it('names the entity a patch writes inside', () => {
    const seen = now();

    revisionLog.note([{ op: 'replace', path: ['entities', 'cube', 'name'], value: 'Cube' }]);

    expect(revisionLog.since(seen).entities).toEqual(new Set(['cube']));
  });

  it('names the entity of a component, which sits one segment further along', () => {
    const seen = now();

    revisionLog.note([{ op: 'replace', path: ['components', 'mesh', 'cube', 'c1', 'castShadow'], value: true }]);

    expect(revisionLog.since(seen).entities).toEqual(new Set(['cube']));
  });

  it('reads a patch that replaces the whole entity table as everything', () => {
    const seen = now();

    revisionLog.note([replacing('entities')]);

    expect(revisionLog.since(seen).entities).toBe('*');
  });

  it('reads a patch that replaces a whole component table as everything', () => {
    const seen = now();

    revisionLog.note([replacing('components', 'mesh')]);

    expect(revisionLog.since(seen).entities).toBe('*');
  });

  it('names the entities of a table added whole, which is how a type\'s first component arrives', () => {
    const seen = now();

    // The document holds a table only for a type it has held a component of, so
    // the first light of a scene adds the lights' table with that light in it.
    // Nothing was drawn for the type before: what the table holds is all of it.
    revisionLog.note([
      { op: 'add', path: ['components', 'light'], value: new Map([['lamp', new Map()], ['torch', new Map()]]) },
    ]);

    expect(revisionLog.since(seen).entities).toEqual(new Set(['lamp', 'torch']));
  });

  it('reads a table taken out whole as everything: the patch does not say what it held', () => {
    const seen = now();

    revisionLog.note([{ op: 'remove', path: ['components', 'light'] }]);

    expect(revisionLog.since(seen).entities).toBe('*');
  });

  it('reads the components of the types this build does not define as it reads the others', () => {
    const seen = now();

    revisionLog.note([{ op: 'remove', path: ['unknownComponents', 'plugin.flicker', 'cube'] }]);

    expect(revisionLog.since(seen).entities).toEqual(new Set(['cube']));
  });

  it('reads one with an entity that is no id as everything, rather than naming nothing', () => {
    const seen = now();

    // An empty segment names no entity, and a binder told nothing changed would
    // go on drawing what is no longer there.
    revisionLog.note([{ op: 'replace', path: ['entities', '', 'name'], value: 'x' }]);

    expect(revisionLog.since(seen).entities).toBe('*');
  });

  it('keeps a whole-table patch from hiding the entities named beside it', () => {
    const seen = now();

    revisionLog.note([
      { op: 'replace', path: ['entities', 'cube', 'name'], value: 'Cube' },
      replacing('entities'),
    ]);

    expect(revisionLog.since(seen).entities).toBe('*');
  });
});
