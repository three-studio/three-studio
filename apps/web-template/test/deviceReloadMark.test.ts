import { describe, expect, it } from 'vitest';
import { clearAlive, markAlive, readReload, type MarkStorage } from '../src/device/reloadMark';

/*
 * The mark a player page leaves in its tab's `sessionStorage`, which outlives
 * the page's own process: how the next page tells that the one before it was
 * ended in the foreground — on iOS, a page that used too much memory, ended
 * without any event and loaded again.
 */

const KEY = 'three-studio.device.alive';

function storage(entries: Record<string, string> = {}): MarkStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const refusing: MarkStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the page before this one', () => {
  it('died in the foreground when its mark says it was seen, and nobody asked for this load', () => {
    const store = storage({ [KEY]: 'visible' });

    expect(readReload(store, false)).toBe(true);
    expect(store.map.has(KEY)).toBe(false);
  });

  it.each([
    ['the editor asked for this load', { [KEY]: 'visible' }, true],
    ['it was hidden: a tab ended in the background, as any can be', { [KEY]: 'hidden' }, false],
    ['it left no mark: it went the way a page goes', {}, false],
  ])('did not, when %s', (_name, entries: Record<string, string>, asked: boolean) => {
    const store = storage(entries);

    expect(readReload(store, asked)).toBe(false);
    expect(store.map.has(KEY)).toBe(false);
  });

  it('is never known from a storage that refuses, which is no error', () => {
    expect(readReload(refusing, false)).toBe(false);
    expect(() => markAlive(refusing, true)).not.toThrow();
    expect(() => clearAlive(refusing)).not.toThrow();
  });
});

describe('this page', () => {
  it('marks itself alive, seen or hidden, and takes its mark as it goes', () => {
    const store = storage();

    markAlive(store, true);
    expect(store.map.get(KEY)).toBe('visible');
    markAlive(store, false);
    expect(store.map.get(KEY)).toBe('hidden');
    clearAlive(store);
    expect(store.map.has(KEY)).toBe(false);
  });
});
