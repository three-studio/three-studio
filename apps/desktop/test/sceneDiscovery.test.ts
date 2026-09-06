import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createBuildProfiles,
  createNewScene,
  createPhysicsSettings,
  createRenderingSettings,
  serializeScene,
  type ProjectFile,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { ProjectError, discoverScenes, openProject } from '../src/main/project';

/*
 * `scenes/` is the list of scenes. `project.json` used to hold a copy of it,
 * and every failure below is one that copy caused: a scene added in the Finder
 * was invisible, a scene deleted there stopped the project from opening at all,
 * and neither could be fixed from inside the editor because the editor could
 * not see the file it was arguing with.
 *
 * The new case the copy could not produce is two files claiming one id, which a
 * duplicate in the Finder makes in one keystroke. The decision — the first by
 * path order wins, the other is listed and flagged, neither is lost — is pinned
 * at the bottom.
 */

/** A project on disk with the named scenes, `startScene` on the first. */
async function projectWith(paths: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-discover-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });

  const ids: string[] = [];
  for (const path of paths) {
    const document = createNewScene(path);
    await mkdir(join(root, SCENES_DIR, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, SCENES_DIR, `${path}.scene.json`), serializeScene(document), 'utf8');
    ids.push(document.id);
  }

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: 'Discovery',
    engineVersion: '0.1.0',
    startScene: ids[0] ?? '',
    settings: {
      loadingScene: null,
      rendering: createRenderingSettings(),
      physics: createPhysicsSettings(),
      build: createBuildProfiles('Discovery'),
    },
  };
  await writeFile(join(root, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
  return root;
}

describe('the scenes of a project are the files under scenes/', () => {
  it('finds a scene copied in beside the others', async () => {
    const root = await projectWith(['main']);
    // What a person does in the Finder, and what used to leave them with a file
    // the editor would not show and no way to make it.
    await cp(
      join(root, SCENES_DIR, 'main.scene.json'),
      join(root, SCENES_DIR, 'Arena.scene.json'),
    );
    // Its own id, as a scene authored anywhere else would have; the same id is
    // the case pinned further down.
    await writeFile(
      join(root, SCENES_DIR, 'Arena.scene.json'),
      serializeScene(createNewScene('Arena')),
      'utf8',
    );

    expect((await discoverScenes(root)).map((scene) => scene.name)).toEqual(['Arena', 'main']);
  });

  it('finds scenes in folders under scenes/, named by their file', async () => {
    const root = await projectWith(['main', 'levels/Boss']);
    const scenes = await discoverScenes(root);

    expect(scenes.map((scene) => scene.path)).toEqual([
      `${SCENES_DIR}/levels/Boss.scene.json`,
      `${SCENES_DIR}/main.scene.json`,
    ]);
    expect(scenes.map((scene) => scene.name)).toEqual(['Boss', 'main']);
  });

  it('ignores what is not a scene file', async () => {
    const root = await projectWith(['main']);
    await writeFile(join(root, SCENES_DIR, 'notes.txt'), 'nothing to see', 'utf8');
    // The shape an interrupted write leaves behind: `atomicWrite` stages beside
    // the target under an id of its own, and a crash is the one way one stays.
    await writeFile(join(root, SCENES_DIR, 'main.scene.json.a1b2c3d4.tmp'), '{}', 'utf8');

    expect((await discoverScenes(root)).map((scene) => scene.name)).toEqual(['main']);
  });

  /*
   * One unreadable file is one scene missing, not a project that will not open.
   * `project.json` requiring its list is exactly what made the second happen.
   */
  it('skips a scene file it cannot parse, and opens the project anyway', async () => {
    const root = await projectWith(['main', 'Boss']);
    await writeFile(join(root, SCENES_DIR, 'Boss.scene.json'), '{ half a file', 'utf8');

    expect((await discoverScenes(root)).map((scene) => scene.name)).toEqual(['main']);
    expect((await openProject(root)).sceneId).toBeTruthy();
  });

  /*
   * A hand-written `.scene.json` carries no identity, so it is addressed by
   * where it is — a reference its next move will break, which is the truth
   * about it, and better than a file the editor refuses to list.
   */
  it('addresses a scene with no id of its own by its path', async () => {
    const root = await projectWith(['main']);
    await writeFile(join(root, SCENES_DIR, 'Hand.scene.json'), '{ "name": "Hand" }', 'utf8');

    const entry = (await discoverScenes(root)).find((scene) => scene.name === 'Hand');
    expect(entry?.id).toBe(`${SCENES_DIR}/Hand.scene.json`);
  });
});

describe('opening a project whose scenes moved without it', () => {
  it('opens on the first scene when the start scene has been deleted', async () => {
    const root = await projectWith(['Boss', 'main']);
    const scenes = await discoverScenes(root);
    // `startScene` names `Boss`, which is also first by path; delete it and the
    // project must fall back rather than refuse.
    await rm(join(root, SCENES_DIR, 'Boss.scene.json'));

    const opened = await openProject(root);
    expect(opened.sceneId).toBe(scenes[1]!.id);
    expect(opened.scenes.map((scene) => scene.name)).toEqual(['main']);
  });

  it('ignores a wanted scene that is no longer on disk', async () => {
    const root = await projectWith(['main']);
    // A window reopening on a URL from before the scene was deleted.
    const opened = await openProject(root, 'an-id-nothing-has');
    expect(opened.sceneId).toBe((await discoverScenes(root))[0]!.id);
  });

  it('refuses only when there is no scene at all', async () => {
    const root = await projectWith(['main']);
    await rm(join(root, SCENES_DIR, 'main.scene.json'));
    await expect(openProject(root)).rejects.toBeInstanceOf(ProjectError);
  });
});

describe('two files claiming one id', () => {
  /*
   * Duplicating `Boss.scene.json` in the Finder copies its `SceneDoc.id` too,
   * so two files answer to one reference. The first by path order wins it. The
   * other is kept in the list and says who beat it: dropping it would be a file
   * that exists, holds work, and has vanished from the editor with no
   * explanation — much harder to find than a row with a reason next to it.
   */
  async function withDuplicate(): Promise<string> {
    const root = await projectWith(['Boss']);
    await cp(
      join(root, SCENES_DIR, 'Boss.scene.json'),
      join(root, SCENES_DIR, 'Boss copy.scene.json'),
    );
    return root;
  }

  it('keeps both files and says which one lost', async () => {
    const scenes = await discoverScenes(await withDuplicate());

    expect(scenes.map((scene) => scene.name)).toEqual(['Boss copy', 'Boss']);
    // Path order, not the order the file system listed them: `Boss copy` sorts
    // first, so it is the one every reference to that id resolves to.
    expect(scenes[0]!.shadowedBy).toBeNull();
    expect(scenes[1]!.shadowedBy).toBe(`${SCENES_DIR}/Boss copy.scene.json`);
    expect(scenes[0]!.id).toBe(scenes[1]!.id);
  });

  it('opens the winner when the shared id is asked for', async () => {
    const root = await withDuplicate();
    const scenes = await discoverScenes(root);

    const opened = await openProject(root, scenes[0]!.id);
    expect(opened.scenePath).toBe(`${SCENES_DIR}/Boss copy.scene.json`);
  });
});
