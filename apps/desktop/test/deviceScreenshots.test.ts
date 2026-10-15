import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readPngSize,
  screenshotFileName,
  screenshotFolder,
  withPngExtension,
} from '../src/main/devices/screenshots';
import { pngOf } from './png';

/*
 * A device's screenshot, as the main process takes it: bytes that came from
 * the network, checked by their header alone, then named and given a folder
 * before the Save dialog opens.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('a PNG’s size', () => {
  it('is read from its header', () => {
    expect(readPngSize(pngOf(3, 2))).toEqual({ width: 3, height: 2 });
  });

  it('is not read from a header cut short', () => {
    expect(readPngSize(pngOf(3, 2).subarray(0, 23))).toBeNull();
  });

  it('is not read from what is not a PNG', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('JFIF\0', 'latin1'),
      Buffer.alloc(20),
    ]);

    expect(readPngSize(jpeg)).toBeNull();
  });

  it.each([
    ['nothing wide', 0, 2],
    ['higher than any canvas', 3, 20_000],
  ])('is not read from a header %s', (_name, width, height) => {
    expect(readPngSize(pngOf(width, height))).toBeNull();
  });

  it('is not read when the first chunk is not the header', () => {
    const png = pngOf(3, 2);
    png.write('tEXt', 12, 'latin1');

    expect(readPngSize(png)).toBeNull();
  });
});

describe('a screenshot’s name', () => {
  const at = new Date(2026, 9, 1, 14, 32, 5);

  it('says the scene, the device and when, the way macOS names its own', () => {
    expect(screenshotFileName({ scene: 'Level 1', device: 'iPhone · Safari', at })).toBe(
      'Level 1 — iPhone · Safari — 2026-10-01 at 14.32.05.png',
    );
  });

  it('holds nothing a file name may not', () => {
    expect(screenshotFileName({ scene: 'a/b:c*d', device: 'x\ny', at })).toBe(
      'a-b-c-d — x-y — 2026-10-01 at 14.32.05.png',
    );
  });

  it('runs white space together', () => {
    expect(screenshotFileName({ scene: '  Level \u00a0 1  ', device: 'iPhone · Safari', at })).toBe(
      'Level 1 — iPhone · Safari — 2026-10-01 at 14.32.05.png',
    );
  });

  it('is never a hidden file', () => {
    expect(screenshotFileName({ scene: '..hidden', device: 'iPhone · Safari', at })).toBe(
      'hidden — iPhone · Safari — 2026-10-01 at 14.32.05.png',
    );
  });

  it('reads an empty part as untitled', () => {
    expect(screenshotFileName({ scene: '', device: ' ', at })).toBe(
      'Untitled — Untitled — 2026-10-01 at 14.32.05.png',
    );
  });

  it('cuts a part to 60 characters', () => {
    expect(screenshotFileName({ scene: 'a'.repeat(100), device: 'iPhone · Safari', at })).toBe(
      `${'a'.repeat(60)} — iPhone · Safari — 2026-10-01 at 14.32.05.png`,
    );
  });
});

describe('the folder a Save dialog opens in', () => {
  async function project(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'studio-shots-'));
  }

  it('is the one remembered, while it is a folder, and nothing is made', async () => {
    const path = await project();
    const remembered = join(path, 'Elsewhere');
    await mkdir(remembered);

    expect(await screenshotFolder(remembered, path)).toBe(remembered);
    expect(await exists(join(path, 'Screenshots'))).toBe(false);
  });

  it('is the project’s own when none is remembered, made as it is named', async () => {
    const path = await project();

    expect(await screenshotFolder(undefined, path)).toBe(join(path, 'Screenshots'));
    expect((await stat(join(path, 'Screenshots'))).isDirectory()).toBe(true);
  });

  it('is the project’s own when the one remembered is gone', async () => {
    const path = await project();
    const gone = join(path, 'Gone');
    await mkdir(gone);
    await rm(gone, { recursive: true });

    expect(await screenshotFolder(gone, path)).toBe(join(path, 'Screenshots'));
    expect((await stat(join(path, 'Screenshots'))).isDirectory()).toBe(true);
  });

  it('is the project’s own when the one remembered is a file', async () => {
    const path = await project();
    const file = join(path, 'notes.txt');
    await writeFile(file, 'x');

    expect(await screenshotFolder(file, path)).toBe(join(path, 'Screenshots'));
    expect((await stat(join(path, 'Screenshots'))).isDirectory()).toBe(true);
  });
});

describe('the path a screenshot is written to', () => {
  it.each([
    ['a.png', 'a.png'],
    ['a.PNG', 'a.PNG'],
    ['a', 'a.png'],
    ['a.jpg', 'a.jpg.png'],
  ])('%s → %s', (given, written) => {
    // A Linux dialog may give back the name as typed.
    expect(withPngExtension(given)).toBe(written);
  });
});
