import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createNewScene,
  deserializeScene,
  serializeScene,
  type ProjectFile,
  type SceneEntry,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { readProject } from '../src/main/project';
import {
  createScene,
  deleteScene,
  duplicateScene,
  renameScene,
  setStartScene,
} from '../src/main/scenes';

/*
 * Four invariants, none of which anything checked before there was a way to
 * make a second scene. Each is breakable in one call, and each breaks something
 * a long way from where it was broken: an export that ships an orphan file, a
 * project that opens on the wrong scene, a build missing a level.
 *
 * The fifth thing pinned here is the reason the registry addresses scenes by
 * id: a rename must move nothing.
 */

/** A project on disk with the named scenes; the first is the start scene. */
async function projectWith(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-scenes-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });

  const scenes: SceneEntry[] = [];
  for (const name of names) {
    const document = createNewScene(name);
    const path = `${SCENES_DIR}/${name}.scene.json`;
    await writeFile(join(root, path), serializeScene(document), 'utf8');
    scenes.push({ id: document.id, name, path });
  }

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: 'Registry',
    engineVersion: '0.1.0',
    scenes,
    startScene: scenes[0]!.id,
    settings: {
      loadingScene: null,
      rendering: {
        forceWebGL: false,
        antialias: true,
        maxPixelRatio: 2,
        shadows: true,
        shadowMapSize: 2048,
        exposure: 1,
      },
      physics: { gravity: [0, -9.81, 0], fixedTimestep: 1 / 60, maxSubsteps: 5 },
      build: {
        active: 'web',
        profiles: {
          web: {
            name: 'Web',
            target: 'web',
            scenes: scenes.map((entry) => entry.id),
            outputDir: null,
            includeAllAssets: false,
            title: 'Registry',
          },
        },
      },
    },
  };
  await writeFile(join(root, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
  return root;
}

async function idOf(root: string, name: string): Promise<string> {
  const project = await readProject(root);
  const entry = project.scenes.find((scene) => scene.name === name);
  if (!entry) throw new Error(`no scene called ${name}`);
  return entry.id;
}

function profileScenes(project: ProjectFile): string[] {
  return project.settings.build.profiles['web']?.scenes ?? [];
}

describe('a scene is addressed by id, never by name or path', () => {
  /*
   * The whole point. Before this, `scenes`, `startScene`, `loadingScene` and
   * every build profile held a path or a name, so renaming meant rewriting all
   * four — and missing one meant a project that opened on the wrong scene, or
   * a build missing a level, with nothing to connect the failure to the rename.
   */
  it('renames without moving the file or touching a single reference', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');
    await setStartScene(root, boss);

    const before = await readProject(root);
    const { scene } = await renameScene(root, boss, 'Arena');
    const after = await readProject(root);

    expect(scene.id).toBe(boss);
    expect(scene.name).toBe('Arena');
    // The file stays where it was created. That is what makes every reference
    // below survive without being rewritten.
    expect(scene.path).toBe(`${SCENES_DIR}/Boss.scene.json`);
    expect(after.startScene).toBe(boss);
    expect(profileScenes(after)).toEqual(profileScenes(before));
  });

  it('keeps a loading scene through a rename, because it holds an id', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');

    const project = await readProject(root);
    await writeFile(
      join(root, PROJECT_FILE_NAME),
      JSON.stringify({ ...project, settings: { ...project.settings, loadingScene: boss } }, null, 2),
      'utf8',
    );

    await renameScene(root, boss, 'Arena');
    expect((await readProject(root)).settings.loadingScene).toBe(boss);
  });

  it('takes the id from the scene document, so a file says which scene it is', async () => {
    const root = await projectWith(['main']);
    const { scene } = await createScene(root, 'Arena');

    const document = deserializeScene(await readFile(join(root, scene.path), 'utf8'));
    expect(document.id).toBe(scene.id);
  });
});

describe('scene names are unique in a project', () => {
  /*
   * Not for the machine's sake any more — nothing resolves through a name —
   * but a script may name a scene, and two called `Boss` make that ambiguous.
   */
  it('refuses a new scene whose name is already taken', async () => {
    const root = await projectWith(['main', 'Boss']);

    await expect(createScene(root, 'Boss')).rejects.toThrow(/already/i);
    expect((await readProject(root)).scenes).toHaveLength(2);
  });

  it('refuses a rename onto a name another scene holds', async () => {
    const root = await projectWith(['main', 'Boss']);
    await expect(renameScene(root, await idOf(root, 'main'), 'Boss')).rejects.toThrow(/already/i);
  });

  it('compares without case, because two files cannot differ by case alone', async () => {
    const root = await projectWith(['main', 'Boss']);
    await expect(createScene(root, 'boss')).rejects.toThrow(/already/i);
  });

  it('lets a scene keep its own name through a change of case', async () => {
    const root = await projectWith(['main', 'Boss']);
    const { scene } = await renameScene(root, await idOf(root, 'Boss'), 'boss');
    expect(scene.name).toBe('boss');
  });

  /*
   * A name is reused once its first holder has been renamed away from it, and
   * the file that holder still sits in is the one the new scene would want.
   */
  it('finds another file when the obvious one is taken', async () => {
    const root = await projectWith(['main', 'Boss']);
    await renameScene(root, await idOf(root, 'Boss'), 'Arena');

    const { scene } = await createScene(root, 'Boss');
    expect(scene.name).toBe('Boss');
    expect(scene.path).not.toBe(`${SCENES_DIR}/Boss.scene.json`);
  });

  it('refuses a name that is nothing but punctuation', async () => {
    const root = await projectWith(['main']);
    await expect(createScene(root, '   ')).rejects.toThrow(/name/i);
  });
});

describe('the start scene is always one of the scenes', () => {
  it('repoints when the start scene is deleted', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');
    await deleteScene(root, await idOf(root, 'main'));

    const project = await readProject(root);
    expect(project.startScene).toBe(boss);
    expect(project.scenes.map((scene) => scene.id)).toEqual([boss]);
  });

  it('refuses to start on a scene the project does not have', async () => {
    const root = await projectWith(['main']);
    await expect(setStartScene(root, 'not-an-id')).rejects.toThrow(/not a scene/i);
  });
});

describe('build profiles follow their scenes', () => {
  it('drops the scene a deletion removed', async () => {
    const root = await projectWith(['main', 'Boss']);
    const main = await idOf(root, 'main');
    await deleteScene(root, await idOf(root, 'Boss'));

    expect(profileScenes(await readProject(root))).toEqual([main]);
  });

  it('clears a loading scene the deletion removed', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');

    const project = await readProject(root);
    await writeFile(
      join(root, PROJECT_FILE_NAME),
      JSON.stringify({ ...project, settings: { ...project.settings, loadingScene: boss } }, null, 2),
      'utf8',
    );

    await deleteScene(root, boss);
    expect((await readProject(root)).settings.loadingScene).toBeNull();
  });
});

describe('a project always has a scene', () => {
  it('refuses to delete the last one', async () => {
    const root = await projectWith(['main']);
    // `openProject` throws for a project with no scenes, so this would produce
    // one that cannot be opened again.
    await expect(deleteScene(root, await idOf(root, 'main'))).rejects.toThrow(/last scene/i);
    expect((await readProject(root)).scenes).toHaveLength(1);
  });
});

describe('what the registry writes', () => {
  it('gives a new scene the root Scene entity, where global scripts go', async () => {
    const root = await projectWith(['main']);
    const { scene } = await createScene(root, 'Arena');

    const document = deserializeScene(await readFile(join(root, scene.path), 'utf8'));
    expect(document.entities[document.rootOrder[0]!]?.name).toBe('Scene');
    expect(document.name).toBe('Arena');
  });

  it('gives a duplicate its own id, so the two are not one scene', async () => {
    const root = await projectWith(['main']);
    const main = await idOf(root, 'main');
    const { scene } = await duplicateScene(root, main, 'Main Copy');

    const original = deserializeScene(await readFile(join(root, `${SCENES_DIR}/main.scene.json`), 'utf8'));
    const copy = deserializeScene(await readFile(join(root, scene.path), 'utf8'));

    expect(scene.id).not.toBe(main);
    expect(copy.id).toBe(scene.id);
    expect(copy.name).toBe('Main Copy');
    expect(Object.keys(copy.entities)).toHaveLength(Object.keys(original.entities).length);
  });

  it('adds what it creates to the project, in order', async () => {
    const root = await projectWith(['main']);
    const main = await idOf(root, 'main');
    const { scene } = await createScene(root, 'Arena');

    const project = await readProject(root);
    expect(project.scenes.map((entry) => entry.id)).toEqual([main, scene.id]);
    // A new scene is not the start scene: that is a separate, deliberate choice.
    expect(project.startScene).toBe(main);
  });

  it('hands back the project it wrote, so no one has to read the file again', async () => {
    const root = await projectWith(['main']);
    const { project } = await createScene(root, 'Arena');
    expect(project).toEqual(await readProject(root));
  });
});
