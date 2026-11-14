import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_FILE_NAME, PROJECT_FORMAT_VERSION, isRecord } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { ProjectError, createProject, openProject, readProject } from '../src/main/project';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * `project.json` as the main process reads it: decoded, and refused with its
 * diagnostics — the file, then each field and its fault — when it is of another
 * format or malformed. Before a scene is read, so that an older project is
 * refused at the door rather than opened half-way. Nothing is filled in,
 * nothing converted, and reading never writes: opening a project must not put
 * it in somebody's diff.
 */

/** A project as `createProject` makes it, in a throwaway folder. */
async function created(): Promise<{ root: string; file: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-project-'));
  const root = (await createProject(registries, 'Decoded', parent)).summary.path;
  return { root, file: join(root, PROJECT_FILE_NAME) };
}

/** The project's file with `change` applied to it as a record. */
async function rewritten(file: string, change: (project: Record<string, unknown>) => void): Promise<void> {
  const project: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isRecord(project)) throw new Error(`${file} holds no project`);
  change(project);
  await writeFile(file, JSON.stringify(project, null, 2), 'utf8');
}

describe('a project file', () => {
  it('reads back as `createProject` made it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'studio-project-'));
    const opened = await createProject(registries, 'Decoded', parent);

    expect(await readProject(opened.summary.path)).toEqual(opened.project);
  });

  it('is refused at another version, in one line naming the file and both versions', async () => {
    const { root, file } = await created();
    await rewritten(file, (project) => (project['version'] = PROJECT_FORMAT_VERSION - 1));

    const refusal = readProject(root);
    await expect(refusal).rejects.toBeInstanceOf(ProjectError);
    await expect(refusal).rejects.toThrow(
      `${file}\nversion: written in format ${PROJECT_FORMAT_VERSION - 1}; this build reads format ${PROJECT_FORMAT_VERSION} and does not convert it`,
    );
  });

  it('is refused before a scene is read, by every door that opens it', async () => {
    const { root, file } = await created();
    await rewritten(file, (project) => (project['version'] = PROJECT_FORMAT_VERSION + 1));

    await expect(openProject(root)).rejects.toThrow(`${file}\nversion: written in format ${PROJECT_FORMAT_VERSION + 1}`);
  });

  it('is refused with each malformed field where it sits', async () => {
    const { root, file } = await created();
    await rewritten(file, (project) => {
      project['scenes'] = [];
      project['engineVersion'] = 6;
    });

    await expect(readProject(root)).rejects.toThrow(
      [file, 'engineVersion: expected a string, found 6', 'scenes: is no field this build reads'].join('\n'),
    );
  });

  it('is refused when it is not JSON at all', async () => {
    const { root, file } = await created();
    await writeFile(file, '{ "version": ', 'utf8');

    await expect(readProject(root)).rejects.toThrow(`${PROJECT_FILE_NAME} is not valid JSON.`);
  });

  it('is never written by being read, refused or not', async () => {
    const { root, file } = await created();
    const before = await readFile(file, 'utf8');
    await readProject(root);
    expect(await readFile(file, 'utf8')).toBe(before);

    await rewritten(file, (project) => (project['version'] = 2));
    const refused = await readFile(file, 'utf8');
    await expect(readProject(root)).rejects.toThrow(ProjectError);
    expect(await readFile(file, 'utf8')).toBe(refused);
  });
});
