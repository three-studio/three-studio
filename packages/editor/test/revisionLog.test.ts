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
