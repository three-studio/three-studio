import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  LAUNCH_SNAPSHOT_VERSION,
  conformLaunchSnapshot,
  createMeshEntity,
  deserializeScene,
  encodeLaunchSnapshot,
  fixedId,
  insertEntity,
  type ReceivedLaunch,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { scanAssets } from '../src/main/assetScan';
import { prepareLaunch } from '../src/main/devices/launch';
import { launchManifest } from '../src/main/devices/launchManifest';
import { createProject, discoverScenes, readProject } from '../src/main/project';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * A launch, prepared from what is on screen: the editor's snapshot for the
 * scene, the project's files for everything else. Nothing is saved, and the
 * scene's own file is never touched — that is the whole point of launching
 * from memory.
 */

const SCRIPT = `import { Behaviour } from '@three-studio/runtime';

export default class Spin extends Behaviour {
  onUpdate(): void {}
}
`;

const TEX_BRICK = fixedId('asset', 'tex-brick');

/** A project with a texture and, unless asked otherwise, a script. */
async function project(script: string | null = SCRIPT): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-launch-'));
  const root = (await createProject(registries, 'Races', parent)).summary.path;
  const texture = join(root, ASSETS_DIR, 'textures', 'brick.png');
  await writeFile(texture, 'x', 'utf8');
  await writeFile(
    `${texture}.meta.json`,
    JSON.stringify({
      version: 1,
      id: TEX_BRICK,
      kind: 'texture',
      importedAt: 1,
      hash: 'h',
      settings: { kind: 'texture' },
    }),
    'utf8',
  );
  if (script !== null) {
    await mkdir(join(root, ASSETS_DIR, 'scripts'), { recursive: true });
    await writeFile(join(root, ASSETS_DIR, 'scripts', 'Spin.ts'), script, 'utf8');
  }
  return root;
}

/**
 * The window's scene as the editor holds it: the scene on disk, with an entity
 * nobody has saved yet. As the main process has it once the window has sent it:
 * written, then read back.
 */
async function snapshot(root: string): Promise<ReceivedLaunch> {
  const [entry] = await discoverScenes(root);
  const scene = deserializeScene(registries, await readFile(join(root, entry!.path), 'utf8'));
  const crate = createMeshEntity('box');
  crate.entity.name = 'Unsaved Crate';
  insertEntity(scene, crate);
  const { settings } = await readProject(root);
  return conformLaunchSnapshot(
    registries,
    encodeLaunchSnapshot({
      version: LAUNCH_SNAPSHOT_VERSION,
      entry: { id: entry!.id, name: entry!.name, scene },
      materials: new Map(),
      physicsMaterials: new Map(),
      prefabs: new Map(),
      rendering: settings.rendering,
      physics: settings.physics,
      loadingScene: settings.loadingScene,
    }),
  );
}

describe('a launch', () => {
  it('serves the scene on screen as the window sent it, though a file on disk claims its id', async () => {
    const root = await project();
    const shown = await snapshot(root);

    const launch = await prepareLaunch(registries, root, shown);

    expect(launch.entryId).toBe(shown.snapshot.entry.id);
    expect(launch.sceneName).toBe(shown.snapshot.entry.name);
    expect(launch.entryJson).toBe(shown.entryJson);
    expect(launch.entryJson).toContain('Unsaved Crate');
    expect(launch.projectPath).toBe(root);
    expect(launch.id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('serves the manifest launchManifest makes, titled with the project’s name', async () => {
    const root = await project();
    const shown = await snapshot(root);

    const launch = await prepareLaunch(registries, root, shown);

    const expected = launchManifest({
      snapshot: shown.snapshot,
      scenes: await discoverScenes(root),
      assets: (await scanAssets(registries, root)).assets,
      title: 'Races',
      scripts: launch.scripts,
    });
    expect(launch.manifest).toEqual(expected);
    expect(expected.title).toBe('Races');
    expect(launch.scenes).toEqual(await discoverScenes(root));
  });

  it('finds every asset but the scripts by id', async () => {
    const root = await project();

    const launch = await prepareLaunch(registries, root, await snapshot(root));

    const scanned = (await scanAssets(registries, root)).assets;
    const script = scanned.find((asset) => asset.kind === 'script');
    expect(script).toBeDefined();
    expect(launch.assets.get(TEX_BRICK)?.path).toBe(`${ASSETS_DIR}/textures/brick.png`);
    expect(launch.assets.has(script!.id)).toBe(false);
    expect([...launch.assets.keys()].sort()).toEqual(
      scanned.filter((asset) => asset.kind !== 'script').map((asset) => asset.id).sort(),
    );
  });

  it('keeps the compiled bundle, and none for a project without scripts', async () => {
    const withScript = await project();
    const without = await project(null);

    const launch = await prepareLaunch(registries, withScript, await snapshot(withScript));
    const bare = await prepareLaunch(registries, without, await snapshot(without));

    expect(launch.scripts).toMatch(/export\s*\{[^}]*\bscripts\b/);
    expect(launch.manifest.scripts).toBe('scripts.mjs');
    expect(bare.scripts).toBeNull();
    expect(bare.manifest.scripts).toBeNull();
  });

  it('is refused when a script does not compile, in the compiler’s words', async () => {
    const root = await project('export default class Broken {\n');

    await expect(prepareLaunch(registries, root, await snapshot(root))).rejects.toThrow(
      /^Scripts did not compile:\n.*Spin\.ts.*\n?/s,
    );
  });

  it('leaves the scene’s file exactly as it was', async () => {
    const root = await project();
    const [entry] = await discoverScenes(root);
    const before = await readFile(join(root, entry!.path));

    await prepareLaunch(registries, root, await snapshot(root));

    expect((await readFile(join(root, entry!.path))).equals(before)).toBe(true);
  });
});
