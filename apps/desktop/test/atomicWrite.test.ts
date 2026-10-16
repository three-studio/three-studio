import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicWrite } from '../src/main/atomicWrite';

/*
 * The mode a file is written with. One file in the app's data directory holds
 * a private key, and the moment it exists with everyone's read bit is already
 * too late to take it away.
 */

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'studio-atomic-'));
}

const permissions = async (file: string): Promise<number> => (await stat(file)).mode & 0o777;

// Windows has no such bits: the user profile's permissions do that work there.
const posix = it.skipIf(process.platform === 'win32');

describe('the mode', () => {
  posix('is the one asked for', async () => {
    const file = join(await directory(), 'secret.json');

    await atomicWrite(file, 'secret', { mode: 0o600 });

    expect(await permissions(file)).toBe(0o600);
    expect(await readFile(file, 'utf8')).toBe('secret');
  });

  posix('is the one asked for over a file that had another', async () => {
    const file = join(await directory(), 'secret.json');
    await writeFile(file, 'readable', { mode: 0o644 });

    await atomicWrite(file, 'secret', { mode: 0o600 });

    expect(await permissions(file)).toBe(0o600);
  });

  it('is what any new file gets when none is asked for', async () => {
    const dir = await directory();
    const reference = join(dir, 'reference');
    await writeFile(reference, '');
    const file = join(dir, 'plain.json');

    await atomicWrite(file, 'plain');

    expect(await permissions(file)).toBe(await permissions(reference));
  });
});
