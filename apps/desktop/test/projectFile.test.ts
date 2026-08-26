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
import { readProject } from '../src/main/project';

/*
 * A project on disk outlives every version of the editor that will open it, so
 * two promises are worth pinning: a setting added after a project was written
 * arrives filled rather than `undefined`, and a project written in a format
 * this build does not read is refused rather than misread.
 *
 * There is no migration path from format 1 and there is not meant to be. It
 * addressed scenes by path and the loading scene by name; format 2 addresses
 * both by id, so the same field means a different thing. Reading one as the
 * other would give a project whose every reference is silently wrong, which is
 * strictly worse than saying no.
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
  it('refuses one written by a newer editor', async () => {
    const root = await projectWith({ version: PROJECT_FORMAT_VERSION + 1 });
    await expect(readProject(root)).rejects.toThrow(/newer version/i);
  });

  it('refuses an older one rather than misreading its references', async () => {
    const root = await projectWith({ version: PROJECT_FORMAT_VERSION - 1 });
    await expect(readProject(root)).rejects.toThrow(/format/i);
  });
});
