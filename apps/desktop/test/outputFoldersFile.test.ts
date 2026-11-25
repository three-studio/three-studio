import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OUTPUT_FOLDERS_FILE_NAME,
  readOutputFolders,
  rememberOutputFolder,
} from '../src/main/build/outputFoldersFile';

async function folderFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'studio-output-folders-')), OUTPUT_FOLDERS_FILE_NAME);
}

describe('the output folders file', () => {
  it('holds nothing until a folder is chosen', async () => {
    expect(await readOutputFolders(await folderFile(), '/games/Races')).toEqual({});
  });

  it('remembers a folder per profile, and leaves every other project as found', async () => {
    const file = await folderFile();
    await rememberOutputFolder(file, '/games/Races', 'web', '/builds/races');
    await rememberOutputFolder(file, '/games/Races', 'itch', '/builds/itch');
    await rememberOutputFolder(file, '/games/Golf', 'web', '/builds/golf');
    await rememberOutputFolder(file, '/games/Races', 'web', '/builds/races-2');

    expect(await readOutputFolders(file, '/games/Races')).toEqual({
      web: '/builds/races-2',
      itch: '/builds/itch',
    });
    expect(await readOutputFolders(file, '/games/Golf')).toEqual({ web: '/builds/golf' });
  });

  it('reads nothing from a file of another version, and the next choice starts it over', async () => {
    const file = await folderFile();
    await writeFile(file, JSON.stringify({ version: 2, projects: { '/games/Races': { web: '/x' } } }), 'utf8');

    expect(await readOutputFolders(file, '/games/Races')).toEqual({});

    await rememberOutputFolder(file, '/games/Races', 'itch', '/builds/itch');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      projects: { '/games/Races': { itch: '/builds/itch' } },
    });
  });

  it('skips an entry that is not a folder', async () => {
    const file = await folderFile();
    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: { '/games/Races': { web: '/builds/races', itch: 7, demo: '' } } }),
      'utf8',
    );

    expect(await readOutputFolders(file, '/games/Races')).toEqual({ web: '/builds/races' });
  });
});
