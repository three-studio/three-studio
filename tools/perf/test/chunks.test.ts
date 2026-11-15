import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkTable } from '../scenarios/player';

/*
 * The player's chunks, named without their hash: the hash changes with every
 * edit, and a metric named after it would be a new metric each time — never
 * compared with anything.
 */

describe('the chunk table', () => {
  let root = '';
  const main = 'export const a = 1;\n'.repeat(50);
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'perf-chunks-'));
    await mkdir(join(root, 'player'));
    await mkdir(join(root, 'device'));
    await writeFile(join(root, 'player', 'main.023189e1.js'), main);
    await writeFile(join(root, 'player', 'touch.9a94becf.js'), 'export {};');
    await writeFile(join(root, 'player', 'notes.txt'), 'not a chunk');
    await writeFile(join(root, 'device', 'client.js'), 'void 0;');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('names each chunk without its hash, with its raw and gzipped bytes', async () => {
    expect(await chunkTable([join(root, 'player'), join(root, 'device')])).toEqual(
      new Map([
        ['client', { bytes: 7, gzipBytes: gzipSync('void 0;', { level: 9 }).length }],
        ['main', { bytes: main.length, gzipBytes: gzipSync(main, { level: 9 }).length }],
        ['touch', { bytes: 10, gzipBytes: gzipSync('export {};', { level: 9 }).length }],
      ]),
    );
  });

  it('refuses two chunks that would carry one name', async () => {
    await writeFile(join(root, 'player', 'main.11111111.js'), 'export {};');
    await expect(chunkTable([join(root, 'player')])).rejects.toThrow(/main/);
  });
});
