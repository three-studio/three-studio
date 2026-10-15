import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDeviceClient, findTemplate } from '../src/main/prebuilt';

/*
 * Where the app finds what `npm run build:web` made: the player an export
 * copies and the device server serves, and the client the device server adds
 * to its pages. Packaged, both sit in the app's resources; in development,
 * in the workspace, found by walking up from wherever the app runs.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'prebuilt-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '', 'utf8');
}

describe('packaged', () => {
  it('finds each one in the app’s resources', async () => {
    await touch(join(root, 'device-client', 'client.js'));
    await touch(join(root, 'web-template', 'index.html'));

    expect(await findDeviceClient([root])).toBe(join(root, 'device-client'));
    expect(await findTemplate([root])).toBe(join(root, 'web-template'));
  });
});

describe('in the workspace', () => {
  it('finds the client by walking up from the app', async () => {
    await touch(join(root, 'apps', 'web-template', 'dist-device', 'client.js'));
    const app = join(root, 'apps', 'desktop', 'out', 'main');
    await mkdir(app, { recursive: true });

    expect(await findDeviceClient([app])).toBe(join(root, 'apps', 'web-template', 'dist-device'));
  });

  it('never takes one’s folder for the other’s', async () => {
    await touch(join(root, 'apps', 'web-template', 'dist', 'index.html'));
    await touch(join(root, 'apps', 'web-template', 'dist', 'client.js'));
    await touch(join(root, 'apps', 'web-template', 'dist-device', 'index.html'));
    const app = join(root, 'apps', 'desktop', 'out', 'main');
    await mkdir(app, { recursive: true });

    await expect(findDeviceClient([app])).rejects.toThrow('npm run build:web');
    expect(await findTemplate([app])).toBe(join(root, 'apps', 'web-template', 'dist'));
  });
});

describe('nothing built', () => {
  it('says which command builds the client', async () => {
    await expect(findDeviceClient([root])).rejects.toThrow(
      'The device client has not been built. Run `npm run build:web`.',
    );
  });

  it('says which command builds the player', async () => {
    await expect(findTemplate([root])).rejects.toThrow('The web player has not been built.');
  });
});
