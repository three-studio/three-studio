import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createNewScene,
  serializeScene,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { openProject, readProject } from '../src/main/project';

/*
 * A project on disk outlives every version of the editor that will open it, so
 * three promises are worth pinning: a setting added after a project was written
 * arrives filled rather than `undefined`, a project written in an older format
 * is carried forward rather than refused, and one written in a format that does
 * not exist yet is refused rather than guessed at.
 */

async function projectWith(fields: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-project-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });

  const document = createNewScene('main');
  const path = `${SCENES_DIR}/main.scene.json`;
  await writeFile(join(root, path), serializeScene(document), 'utf8');

  await writeFile(
    join(root, PROJECT_FILE_NAME),
    JSON.stringify({
      version: PROJECT_FORMAT_VERSION,
      name: 'Fields',
      engineVersion: '0.1.0',
      scenes: [{ id: document.id, name: 'main', path }],
      startScene: document.id,
      ...fields,
    }),
    'utf8',
  );
  return root;
}

describe('settings a project predates', () => {
  it('fills every section from its own factory', async () => {
    const root = await projectWith({ settings: {} });
    const project = await readProject(root);

    expect(project.settings.rendering.shadowMapSize).toBe(2048);
    expect(project.settings.physics.gravity).toEqual([0, -9.81, 0]);
    expect(project.settings.physics.fixedTimestep).toBeCloseTo(1 / 60);
    expect(project.settings.build.profiles['web']?.target).toBe('web');
    expect(project.settings.loadingScene).toBeNull();
  });

  it('opens a project whose settings block is missing entirely', async () => {
    const root = await projectWith({});
    const project = await readProject(root);

    expect(project.settings.rendering).toBeDefined();
    expect(project.settings.physics).toBeDefined();
    expect(project.settings.build.active).toBe('web');
  });

  it('keeps values a newer editor wrote', async () => {
    const root = await projectWith({
      settings: {
        rendering: { forceWebGL: false, antialias: false, maxPixelRatio: 1, shadows: false, shadowMapSize: 512, exposure: 1.4 },
        physics: { gravity: [0, -3.7, 0], fixedTimestep: 1 / 120, maxSubsteps: 8 },
        build: { active: 'web', profiles: {} },
      },
    });
    const project = await readProject(root);

    expect(project.settings.rendering.exposure).toBe(1.4);
    expect(project.settings.physics.gravity).toEqual([0, -3.7, 0]);
    expect(project.settings.physics.maxSubsteps).toBe(8);
    // And fills what that block predates. The `rendering` above is a complete
    // one as of the version that wrote it, which is exactly the shape a setting
    // added later has to survive: kept where it spoke, filled where it did not.
    expect(project.settings.rendering.batching).toBe(true);
  });

  it('does not rewrite the file just by reading it', async () => {
    // Opening a project must not dirty it in version control: a teammate
    // pulling a diff of defaults they never chose is noise.
    const root = await projectWith({ settings: {} });
    const before = await readFile(join(root, PROJECT_FILE_NAME), 'utf8');
    await readProject(root);
    expect(await readFile(join(root, PROJECT_FILE_NAME), 'utf8')).toBe(before);
  });
});

describe('a format this build does not read', () => {
  it('refuses one written by a newer editor, and says what to do about it', async () => {
    const root = await projectWith({ version: PROJECT_FORMAT_VERSION + 1 });
    // A version that does not exist yet says nothing about what its fields
    // mean, so the only honest answer is no — and an answer of no that leaves
    // the reader with nothing to try is half a message.
    await expect(readProject(root)).rejects.toThrow(/newer version/i);
    await expect(readProject(root)).rejects.toThrow(/update/i);
  });
});

/*
 * Format 1, written out by hand as that build actually wrote it: the start
 * scene by path, the loading scene by name, the profile's scenes by path — and
 * with neither `batching` nor `basePath`, which did not exist yet.
 *
 * By hand and not from the current factories on purpose. A fixture built from
 * `createRenderingSettings()` and `PROJECT_FORMAT_VERSION - 1` stops being an
 * old file the day the current shape moves, which is precisely the day this
 * test has to fail.
 */
async function formatOneProject(
  fields: Record<string, unknown> = {},
): Promise<{ root: string; main: string; loading: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studio-format1-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });

  const ids: Record<string, string> = {};
  for (const name of ['main', 'Loading']) {
    const document = createNewScene(name);
    const path = `${SCENES_DIR}/${name}.scene.json`;
    await writeFile(join(root, path), serializeScene(document), 'utf8');
    ids[name] = document.id;
  }

  await writeFile(
    join(root, PROJECT_FILE_NAME),
    JSON.stringify({
      version: 1,
      name: 'Old',
      engineVersion: '0.0.9',
      scenes: [
        { name: 'main', path: `${SCENES_DIR}/main.scene.json` },
        { name: 'Loading', path: `${SCENES_DIR}/Loading.scene.json` },
      ],
      startScene: `${SCENES_DIR}/main.scene.json`,
      settings: {
        loadingScene: 'Loading',
        rendering: {
          forceWebGL: false,
          antialias: true,
          maxPixelRatio: 2,
          shadows: true,
          shadowMapSize: 2048,
          exposure: 1.4,
        },
        physics: { gravity: [0, -3.7, 0], fixedTimestep: 1 / 60, maxSubsteps: 5 },
        build: {
          active: 'web',
          profiles: {
            web: {
              name: 'Web',
              target: 'web',
              scenes: [`${SCENES_DIR}/main.scene.json`, `${SCENES_DIR}/Loading.scene.json`],
              outputDir: null,
              includeAllAssets: false,
              title: 'Old',
            },
          },
        },
      },
      ...fields,
    }),
    'utf8',
  );
  return { root, main: ids['main']!, loading: ids['Loading']! };
}

describe('a project written in an older format', () => {
  it('resolves the paths and names it holds into ids', async () => {
    const { root, main, loading } = await formatOneProject();
    const before = await readFile(join(root, PROJECT_FILE_NAME), 'utf8');
    const project = await readProject(root);

    expect(project.version).toBe(PROJECT_FORMAT_VERSION);
    expect(project.startScene).toBe(main);
    expect(project.settings.loadingScene).toBe(loading);
    expect(project.settings.build.profiles['web']?.scenes).toEqual([main, loading]);

    // What the author chose, untouched, and the two fields their build predates
    // filled from the factory — a migration is not a licence to reset a project.
    expect(project.settings.rendering.exposure).toBe(1.4);
    expect(project.settings.physics.gravity).toEqual([0, -3.7, 0]);
    expect(project.settings.rendering.batching).toBe(true);
    expect(project.settings.build.profiles['web']?.basePath).toBe('');

    // Upgraded in memory. The new form reaches the file the next time something
    // writes it for a reason of its own, so opening an old project still does
    // not dirty it in version control.
    expect(await readFile(join(root, PROJECT_FILE_NAME), 'utf8')).toBe(before);
  });

  it('opens on the scene the old path named', async () => {
    const { root, main } = await formatOneProject();
    expect((await openProject(root)).sceneId).toBe(main);
  });

  it('leaves a reference whose file has gone exactly as it found it', async () => {
    // Deleting a scene in the Finder is a thing people do, and an upgrade that
    // met one and threw would be the "create it again" refusal all over again,
    // reached by a different route. `openProject` falls back to the first scene
    // the same way it does for a stale id.
    const { root } = await formatOneProject({ startScene: `${SCENES_DIR}/gone.scene.json` });

    expect((await readProject(root)).startScene).toBe(`${SCENES_DIR}/gone.scene.json`);
    expect((await openProject(root)).scenePath).toBe(`${SCENES_DIR}/Loading.scene.json`);
  });
});
