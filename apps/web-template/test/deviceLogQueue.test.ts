import {
  DEVICE_LOG_BYTES,
  DEVICE_LOG_LINES,
  DEVICE_LOG_PENDING,
  DEVICE_LOG_TEXT,
} from '@three-studio/core/devices/protocol';
import { describe, expect, it } from 'vitest';
import { createLogQueue } from '../src/device/logQueue';

/*
 * The lines a page logged and has not sent yet: folded, bounded, and taken a
 * batch at a time, in the order they were logged.
 */

const texts = (count: number, prefix = 'line'): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i}`);

describe('the lines waiting', () => {
  it('fold a line logged again right after itself', () => {
    const queue = createLogQueue();

    queue.push('log', 'tick');
    queue.push('log', 'tick');
    queue.push('log', 'tick');
    queue.push('warn', 'tick');
    queue.push('log', 'tick');

    expect(queue.take()?.lines).toEqual([
      { level: 'log', text: 'tick', count: 3 },
      { level: 'warn', text: 'tick', count: 1 },
      { level: 'log', text: 'tick', count: 1 },
    ]);
  });

  it('keep the first 500, and count the rest as dropped', () => {
    const queue = createLogQueue();
    for (const text of texts(DEVICE_LOG_PENDING + 1)) queue.push('log', text);

    expect(queue.size).toBe(DEVICE_LOG_PENDING);
    const first = queue.take();
    expect(first?.dropped).toBe(1);
    expect(first?.lines[0]?.text).toBe('line 0');

    const taken = [...(first?.lines ?? [])];
    for (let batch = queue.take(); batch !== null; batch = queue.take()) {
      expect(batch.dropped).toBe(0);
      taken.push(...batch.lines);
    }
    expect(taken.map((line) => line.text)).toEqual(texts(DEVICE_LOG_PENDING));
  });

  it('still fold into the last one kept once full', () => {
    const queue = createLogQueue();
    for (const text of texts(DEVICE_LOG_PENDING)) queue.push('log', text);

    queue.push('log', `line ${DEVICE_LOG_PENDING - 1}`);

    expect(queue.size).toBe(DEVICE_LOG_PENDING);
    const lines = [];
    for (let batch = queue.take(); batch !== null; batch = queue.take()) lines.push(...batch.lines);
    expect(lines.at(-1)).toEqual({ level: 'log', text: 'line 499', count: 2 });
  });

  it('cut a line to 4 000 characters', () => {
    const queue = createLogQueue();

    queue.push('error', 'x'.repeat(5_000));

    const text = queue.take()?.lines[0]?.text ?? '';
    expect(text).toHaveLength(DEVICE_LOG_TEXT);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('a batch', () => {
  it('holds a hundred lines at most', () => {
    const queue = createLogQueue();
    for (const text of texts(150)) queue.push('log', text);

    expect(queue.take()?.lines).toHaveLength(DEVICE_LOG_LINES);
    expect(queue.take()?.lines.map((line) => line.text)).toEqual(texts(150).slice(100));
    expect(queue.take()).toBeNull();
  });

  it('holds fewer when their JSON passes 48 KB, and leaves the rest for the next', () => {
    const queue = createLogQueue();
    // Two bytes a character in UTF-8: about 4 KB a line.
    const heavy = texts(40).map((text) => `${text} ${'é'.repeat(2_000)}`);
    for (const text of heavy) queue.push('log', text);

    const first = queue.take()?.lines ?? [];
    const bytes = new TextEncoder().encode(JSON.stringify(first)).length;

    expect(first.length).toBeGreaterThan(1);
    expect(first.length).toBeLessThan(40);
    expect(bytes).toBeLessThanOrEqual(DEVICE_LOG_BYTES);
    expect(queue.take()?.lines[0]?.text).toBe(heavy[first.length]);
  });

  it('is nothing when nothing waits and nothing was dropped', () => {
    expect(createLogQueue().take()).toBeNull();
  });

  it('counts a refused batch’s lines as dropped, with what it already counted', () => {
    const queue = createLogQueue();
    queue.push('log', 'a');
    queue.push('log', 'a');
    queue.push('warn', 'b');
    const refused = queue.take()!;

    queue.lose({ ...refused, dropped: 4 });
    queue.push('log', 'c');

    expect(queue.take()).toEqual({ lines: [{ level: 'log', text: 'c', count: 1 }], dropped: 7 });
  });

  it('goes back in front when it was lost on the way, with its count', () => {
    const queue = createLogQueue();
    for (const text of texts(DEVICE_LOG_PENDING + 2)) queue.push('log', text);
    const lost = queue.take()!;
    queue.push('error', 'after');

    queue.putBack(lost);

    const again = queue.take()!;
    expect(again.dropped).toBe(2);
    expect(again.lines).toEqual(lost.lines);
  });

  it('carries the dropped count alone when no line waits', () => {
    const queue = createLogQueue();
    queue.push('log', 'a');
    queue.lose(queue.take()!);

    expect(queue.take()).toEqual({ lines: [], dropped: 1 });
    expect(queue.take()).toBeNull();
  });
});
