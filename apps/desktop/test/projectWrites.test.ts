import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_FILE_NAME } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { createProject, discoverScenes, readProject, updateProject } from '../src/main/project';
import { createScene, renameScene, setStartScene } from '../src/main/scenes';

/*
 * A project has one editor window per open scene, and every one of them can
 * write `project.json`. Each write is a read, a decision and a write with
 * `await`s in between, so two of them running at once used to interleave and
 * the second would overwrite what the first had just decided — no error, no
 * conflict, and the window that lost still showing its own change.
 *
 * Windows cannot be started here, so what stands in for two of them is two
 * calls that are not awaited in turn. The interleaving is the same one: these
 * are the same handlers, reached the same way, with the same `await` points.
 */

/** A project with two scenes, `main` and `Boss`. */
async function project(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-writes-'));
  const root = (await createProject('Races', parent)).summary.path;
  await createScene(root, 'Boss');
  return root;
}

async function idOf(root: string, name: string): Promise<string> {
  const entry = (await discoverScenes(root)).find((scene) => scene.name === name);
  if (!entry) throw new Error(`no scene called ${name}`);
  return entry.id;
}

describe('two windows writing the project file at once', () => {
  it('keeps both changes rather than the later one only', async () => {
    const root = await project();
    const boss = await idOf(root, 'Boss');

    // One window choosing a start scene while another saves settings. Both
    // read the project, both write the whole of it back; unserialised, one of
    // the two writes a file built on what the other had already replaced.
    await Promise.all([
      setStartScene(root, boss),
      updateProject(root, (current) => ({
        ...current,
        settings: { ...current.settings, loadingScene: 'splash' },
      })),
    ]);

    const after = await readProject(root);
    expect(after.startScene).toBe(boss);
    expect(after.settings.loadingScene).toBe('splash');
  });

  it('survives two windows renaming two different scenes', async () => {
    const root = await project();
    const [main, boss] = [await idOf(root, 'main'), await idOf(root, 'Boss')];

    // Renaming writes no reference at all since a reference became an id — it
    // moves the file and stops. Two of them are two independent moves, and this
    // is here so they stay that way: the day a rename writes `project.json`
    // again, it has to go through the queue with everything else.
    await Promise.all([renameScene(root, main, 'Level1'), renameScene(root, boss, 'Arena')]);

    const names = (await discoverScenes(root)).map((scene) => scene.name);
    expect(names.sort()).toEqual(['Arena', 'Level1']);
  });

  it('runs the next change after one of them throws', async () => {
    const root = await project();

    // A queue whose tail carries a rejection stops running anything behind it,
    // and the changes that throw here are ordinary ones: a name already taken,
    // a last scene refused.
    await expect(
      updateProject(root, () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');

    expect((await updateProject(root, (current) => ({ ...current, name: 'After' }))).name).toBe(
      'After',
    );
  });

  it('writes nothing when the change hands back the project it was given', async () => {
    const root = await project();
    const before = await readFile(join(root, PROJECT_FILE_NAME), 'utf8');

    await updateProject(root, (current) => current);

    // What a delete that does not move the start scene relies on: it is a file
    // operation and nothing else, and rewriting the project to identical bytes
    // would put it in someone's diff for no reason.
    expect(await readFile(join(root, PROJECT_FILE_NAME), 'utf8')).toBe(before);
  });
});
