import { beforeEach, describe, expect, it } from 'vitest';
import { useConsoleStore, type LogEntry, type LogSource } from '../src/state/consoleStore';

/*
 * The Console's lines, this window's and the devices'. A line says where it
 * was logged, and repeats fold only within one source: the same words from
 * the editor and from a phone are two different facts.
 */

const IPHONE: LogSource = { id: 'phone0001', label: 'iPhone · Safari' };
const ANDROID: LogSource = { id: 'phone0002', label: 'Android · Chrome' };

const store = () => useConsoleStore.getState();
const read = (entries: readonly LogEntry[] = store().entries) =>
  entries.map(({ level, text, count, source }) => ({
    level,
    text,
    count,
    from: source?.label ?? null,
  }));

beforeEach(() => {
  store().clear();
});

describe('the Console', () => {
  it('folds a line logged again right after itself, as it always has', () => {
    store().append('log', 'tick');
    store().append('log', 'tick');
    store().append('warn', 'tick');

    expect(read()).toEqual([
      { level: 'log', text: 'tick', count: 2, from: null },
      { level: 'warn', text: 'tick', count: 1, from: null },
    ]);
  });

  it('keeps the same line apart when it comes from the editor and from a device', () => {
    store().append('log', 'ready');
    store().append('log', 'ready', IPHONE);

    expect(read()).toEqual([
      { level: 'log', text: 'ready', count: 1, from: null },
      { level: 'log', text: 'ready', count: 1, from: 'iPhone · Safari' },
    ]);
  });

  it('keeps the same line apart when it comes from two devices', () => {
    store().append('log', 'ready', IPHONE);
    store().append('log', 'ready', ANDROID);
    store().append('log', 'ready', ANDROID);

    expect(read()).toEqual([
      { level: 'log', text: 'ready', count: 1, from: 'iPhone · Safari' },
      { level: 'log', text: 'ready', count: 2, from: 'Android · Chrome' },
    ]);
  });

  it('takes a device’s batch in one change, folding into the last line from it', () => {
    store().append('warn', 'careful', IPHONE);
    let changes = 0;
    const unsubscribe = useConsoleStore.subscribe(() => {
      changes += 1;
    });

    store().appendMany(IPHONE, [
      { level: 'warn', text: 'careful', count: 2 },
      { level: 'log', text: 'a', count: 1 },
      { level: 'error', text: 'boom', count: 4 },
    ]);
    unsubscribe();

    expect(changes).toBe(1);
    expect(read()).toEqual([
      { level: 'warn', text: 'careful', count: 3, from: 'iPhone · Safari' },
      { level: 'log', text: 'a', count: 1, from: 'iPhone · Safari' },
      { level: 'error', text: 'boom', count: 4, from: 'iPhone · Safari' },
    ]);
  });

  it('keeps the newest 500 lines', () => {
    const lines = Array.from({ length: 600 }, (_, i) => ({
      level: 'log' as const,
      text: `line ${i}`,
      count: 1,
    }));

    store().appendMany(ANDROID, lines);

    expect(store().entries).toHaveLength(500);
    expect(store().entries[0]?.text).toBe('line 100');
    expect(store().entries.at(-1)?.text).toBe('line 599');
    expect(new Set(store().entries.map((entry) => entry.id)).size).toBe(500);
  });

  it('changes nothing for a batch with no line', () => {
    store().append('log', 'kept');
    const before = store().entries;

    store().appendMany(IPHONE, []);

    expect(store().entries).toBe(before);
  });
});
