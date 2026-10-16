import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AssetError } from './assetFiles';

/*
 * What `npm run build:web` makes, as the app finds it: the player an export
 * copies and the device server serves, and the client the device server adds
 * to its pages. Two folders, never one: the player's is what an export copies,
 * and a published game must not carry the client.
 */

interface Prebuilt {
  /** Its folder in the app's resources, as `electron-builder.yml` ships it. */
  packaged: string;
  /** Its folder in the workspace, from the repository's root. */
  workspace: string;
  /** The file that says the folder holds a build. */
  marker: string;
  /** What to say when no folder does. */
  missing: string;
}

/**
 * Locates something prebuilt.
 *
 * Packaged it sits in the app's resources; in development it is the workspace
 * build, found by walking up from the app path so the answer does not depend on
 * which directory the dev server was started from.
 */
export async function findPrebuilt(
  searchRoots: readonly string[],
  { packaged, workspace, marker, missing }: Prebuilt,
): Promise<string> {
  const candidates = searchRoots.flatMap((root) => [
    join(root, packaged),
    ...ancestors(root).map((dir) => join(dir, workspace)),
  ]);

  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      if (entries.includes(marker)) return candidate;
    } catch {
      // Not here; try the next one.
    }
  }

  throw new AssetError(missing);
}

/** The prebuilt player. The device server serves this same player, so it finds it the same way. */
export function findTemplate(searchRoots: readonly string[]): Promise<string> {
  return findPrebuilt(searchRoots, {
    packaged: 'web-template',
    workspace: join('apps', 'web-template', 'dist'),
    marker: 'index.html',
    missing:
      'The web player has not been built. Run `npm run build --workspace @three-studio/web-template`.',
  });
}

/** The device client, which the device server adds to every page it serves. */
export function findDeviceClient(searchRoots: readonly string[]): Promise<string> {
  return findPrebuilt(searchRoots, {
    packaged: 'device-client',
    workspace: join('apps', 'web-template', 'dist-device'),
    marker: 'client.js',
    missing: 'The device client has not been built. Run `npm run build:web`.',
  });
}

function ancestors(from: string): string[] {
  const list: string[] = [];
  let current = resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    list.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return list;
}
