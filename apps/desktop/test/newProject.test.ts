import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  CACHE_DIR,
  ENGINE_VERSION,
  SCENES_DIR,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { createProject, readProject, writeProject } from '../src/main/project';

/*
 * What a brand new project has in it, which is a promise made once and kept
 * for the life of the project: an author never scaffolds a second time, so
 * anything missing here is missing for good — they find the gap months later
 * and fill it by hand, if they work out that it was a gap at all.
 */

/** A new project in a throwaway parent directory. */
async function scaffold(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-new-'));
  return (await createProject('Fresh', parent)).summary.path;
}

describe('the folders a new project starts with', () => {
  it('gives every importer somewhere to import into', async () => {
    const root = await scaffold();

    // Derived on both sides, and that is the point of the test: the list here
    // used to be four names typed into `createProject`, so `prefabs`, `shaders`
    // and `audio` had importers and no folder. An importer added with a new
    // `directory` now brings its folder with it, and this fails if anyone types
    // the list back in.
    const declared = [...new Set(Object.values(ASSET_KIND_INFO).map((it) => it.directory))];
    expect((await readdir(join(root, ASSETS_DIR))).sort()).toEqual(declared.sort());
  });

  it('has a scene to open and a cache to write into', async () => {
    const root = await scaffold();

    expect(await readdir(join(root, SCENES_DIR))).toEqual(['main.scene.json']);
    expect((await readProject(root)).name).toBe('Fresh');
  });
});

describe('the cache and the repository around it', () => {
  it('ignores the cache from the project root, not only from inside it', async () => {
    const root = await scaffold();

    // A project committed without this brings its own build output and
    // thumbnails along, and the author has no reason to suspect the folder is
    // there. The one inside `.studio/` does not cover it: git never looks in a
    // directory that nothing has asked it to track.
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(`${CACHE_DIR}/\n`);
    expect(await readFile(join(root, CACHE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
  });
});

describe('engineVersion', () => {
  it('names the build that last wrote the file, not the one that made it', async () => {
    const root = await scaffold();
    const project = await readProject(root);
    expect(project.engineVersion).toBe(ENGINE_VERSION);

    // As a project carried forward from an older build arrives: the value on
    // disk is whatever wrote it last, and this build writing it is what makes
    // that true again. Project Settings shows this field, so a stale one is a
    // wrong answer to the first question a bug report asks.
    project.engineVersion = '0.0.1';
    await writeProject(root, project);

    expect((await readProject(root)).engineVersion).toBe(ENGINE_VERSION);
    // Stamped on the caller's object too: it is the one handed back to the
    // window, and the two must not disagree.
    expect(project.engineVersion).toBe(ENGINE_VERSION);
  });
});
