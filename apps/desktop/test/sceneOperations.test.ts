import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BUILD_PROFILE_ID,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createBuildProfiles,
  createNewScene,
  createPhysicsSettings,
  createRenderingSettings,
  deserializeScene,
  serializeScene,
  type ProjectFile,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { discoverScenes, openProject, readProject } from '../src/main/project';
import {
  createScene,
  deleteScene,
  duplicateScene,
  renameScene,
  setStartScene,
} from '../src/main/scenes';

/*
 * The five operations on the scenes of a project, each one a file operation
 * plus a write of `startScene` when `startScene` is what moved.
 *
 * All four of the invariants these used to hold by hand are gone or explained:
 * three were about keeping `project.json`'s copy of `scenes/` honest, and what
 * is pinned in their place is that nothing rewrites those references any more
 * and nothing needs it to. What survives is the pair that was never about a
 * list — names stay unique, the last scene stays — and the thing the move to
 * disk made true of a rename: the file moves, and no reference moves with it.
 */

/** A project on disk with the named scenes; the first is the start scene. */
async function projectWith(names: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-scenes-'));
  await mkdir(join(root, SCENES_DIR), { recursive: true });

  const ids: string[] = [];
  for (const name of names) {
    const document = createNewScene(name);
    await writeFile(
      join(root, SCENES_DIR, `${name}.scene.json`),
      serializeScene(document),
      'utf8',
    );
    ids.push(document.id);
  }

  // Through the factories, not a second copy of the defaults: this block was
  // one, and it went stale the day `basePath` was added to `BuildProfile`
  // without anything noticing — these files were outside `typecheck`'s reach.
  // The profile does need its scenes filled in, because what a delete does to
  // that list is half of what is pinned below.
  const build = createBuildProfiles('Registry');
  build.profiles[DEFAULT_BUILD_PROFILE_ID]!.scenes = ids;

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: 'Registry',
    engineVersion: '0.1.0',
    startScene: ids[0]!,
    settings: {
      loadingScene: null,
      rendering: createRenderingSettings(),
      physics: createPhysicsSettings(),
      build,
    },
  };
  await writeFile(join(root, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
  return root;
}

async function idOf(root: string, name: string): Promise<string> {
  const entry = (await discoverScenes(root)).find((scene) => scene.name === name);
  if (!entry) throw new Error(`no scene called ${name}`);
  return entry.id;
}

async function sceneFiles(root: string): Promise<string[]> {
  return (await readdir(join(root, SCENES_DIR))).sort();
}

function profileScenes(project: ProjectFile): string[] {
  return project.settings.build.profiles['web']?.scenes ?? [];
}

describe('a scene is addressed by id, never by name or path', () => {
  /*
   * The whole point. Before this, `startScene`, `loadingScene` and every build
   * profile held a path or a name, so renaming meant rewriting all of them —
   * and missing one meant a project that opened on the wrong scene, or a build
   * missing a level, with nothing to connect the failure to the rename.
   */
  it('renames by moving the file, and rewrites no reference', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');
    await setStartScene(root, boss);

    const before = await readProject(root);
    const { scene } = await renameScene(root, boss, 'Arena');
    const after = await readProject(root);

    expect(scene.id).toBe(boss);
    expect(scene.name).toBe('Arena');
    // The file is what moved. That is what a rename *is* now: the name is read
    // back off the path, so the two can no longer disagree.
    expect(scene.path).toBe(`${SCENES_DIR}/Arena.scene.json`);
    expect(await sceneFiles(root)).toEqual(['Arena.scene.json', 'main.scene.json']);
    // And nothing else was touched, because every reference is an id.
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
   * Not for the machine's sake — nothing resolves through a name — but a script
   * may name a scene, and two called `Boss` make that ambiguous. Refused here
   * rather than made unique, because a name is a file name now: silently
   * settling on `Boss 2` would hand back a scene called something else.
   */
  it('refuses a new scene whose name is already taken', async () => {
    const root = await projectWith(['main', 'Boss']);

    await expect(createScene(root, 'Boss')).rejects.toThrow(/already/i);
    expect(await sceneFiles(root)).toEqual(['Boss.scene.json', 'main.scene.json']);
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
    expect(scene.path).toBe(`${SCENES_DIR}/boss.scene.json`);
  });

  /*
   * The reverse of what the registry did here. A name used to stay attached to
   * the file its first holder was created in, so reusing it needed a second
   * file — `Boss 2.scene.json` for a scene called `Boss`. The file moves with
   * the name now, so the name is genuinely free and the obvious file is too.
   */
  it('frees the file when a scene is renamed away from it', async () => {
    const root = await projectWith(['main', 'Boss']);
    await renameScene(root, await idOf(root, 'Boss'), 'Arena');

    const { scene } = await createScene(root, 'Boss');
    expect(scene.name).toBe('Boss');
    expect(scene.path).toBe(`${SCENES_DIR}/Boss.scene.json`);
  });

  /*
   * `sceneName` strips `.scene.json` *and* `.json`, so a name that already
   * looks like a file name has to be reduced to a fixed point before it becomes
   * one. Without that, `Boss.json` would be written to `Boss.json.scene.json`
   * and read back as `Boss` — and since the path is now the only source of the
   * name, that is not a label disagreeing with a file, it is the scene being
   * called something other than what was asked for. `Boss.scene.json` is worse
   * still: it would read back as `Boss.scene`.
   */
  it('reduces a name that is already a file name to what it reads back as', async () => {
    const root = await projectWith(['main']);

    const { scene } = await createScene(root, 'Boss.json');
    expect(scene.name).toBe('Boss');
    expect(scene.path).toBe(`${SCENES_DIR}/Boss.scene.json`);
    // The whole point of the fixed point: the name survives the round trip
    // through the file it was written to.
    expect((await discoverScenes(root)).map((entry) => entry.name)).toContain('Boss');
  });

  it('refuses a name that is nothing but punctuation', async () => {
    const root = await projectWith(['main']);
    await expect(createScene(root, '   ')).rejects.toThrow(/name/i);
  });

  /*
   * A `.scene.json` the walk skipped — broken JSON — is not in the list the
   * name check reads, so nothing above sees it. Writing over it would be
   * silent, and somebody's unopenable scene is still somebody's scene.
   */
  it('refuses to write over a scene file it could not read', async () => {
    const root = await projectWith(['main']);
    await writeFile(join(root, SCENES_DIR, 'Arena.scene.json'), '{ not json', 'utf8');

    await expect(createScene(root, 'Arena')).rejects.toThrow(/already exists/i);
    expect(await readFile(join(root, SCENES_DIR, 'Arena.scene.json'), 'utf8')).toBe('{ not json');
  });
});

describe('the start scene is always one of the scenes', () => {
  it('repoints when the start scene is deleted', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');
    const { project, scenes } = await deleteScene(root, await idOf(root, 'main'));

    expect(project.startScene).toBe(boss);
    expect(scenes.map((scene) => scene.id)).toEqual([boss]);
  });

  it('refuses to start on a scene the project does not have', async () => {
    const root = await projectWith(['main']);
    await expect(setStartScene(root, 'not-an-id')).rejects.toThrow(/not a scene/i);
  });
});

describe('what a deletion no longer rewrites', () => {
  /*
   * A deletion used to walk the build profiles and the loading scene and take
   * the id out of both. It stopped, because both had to tolerate an id with no
   * file anyway — a scene deleted in the Finder never comes through here — and
   * once they tolerate it, doing the work in the one path that runs sometimes
   * buys nothing and rots quietly. The tolerance is what is pinned instead.
   */
  it('leaves a build profile naming the deleted scene alone', async () => {
    const root = await projectWith(['main', 'Boss']);
    const before = profileScenes(await readProject(root));
    await deleteScene(root, await idOf(root, 'Boss'));

    // Untouched — and the export says so, rather than the deletion pre-empting
    // it. See `exportWeb.test.ts`: a profile naming a scene that is gone is a
    // warning on the build, not a refusal and not a silent edit.
    expect(profileScenes(await readProject(root))).toEqual(before);
  });

  it('leaves a loading scene naming the deleted scene alone, and still opens', async () => {
    const root = await projectWith(['main', 'Boss']);
    const boss = await idOf(root, 'Boss');

    const project = await readProject(root);
    await writeFile(
      join(root, PROJECT_FILE_NAME),
      JSON.stringify({ ...project, settings: { ...project.settings, loadingScene: boss } }, null, 2),
      'utf8',
    );
    await deleteScene(root, boss);

    // `SceneHost.showLoadingScene` catches a loading scene it cannot read and
    // goes straight to the target — "better than stopping because the
    // interstitial is missing". So this line costs nothing, and the project
    // opens with it in place.
    expect((await readProject(root)).settings.loadingScene).toBe(boss);
    expect((await openProject(root)).sceneId).toBe(await idOf(root, 'main'));
  });

  /*
   * The other half of the same idea: a delete that moves nothing in the project
   * file does not write it. A project appearing in someone's diff with identical
   * bytes is noise, and it is the kind that teaches people to stop reading them.
   */
  it('does not write the project file when the start scene did not move', async () => {
    const root = await projectWith(['main', 'Boss']);
    const before = await readFile(join(root, PROJECT_FILE_NAME), 'utf8');

    await deleteScene(root, await idOf(root, 'Boss'));
    expect(await readFile(join(root, PROJECT_FILE_NAME), 'utf8')).toBe(before);
  });
});

describe('a project always has a scene', () => {
  it('refuses to delete the last one', async () => {
    const root = await projectWith(['main']);
    // `openProject` throws for a project with no scenes, so this would produce
    // one that cannot be opened again.
    await expect(deleteScene(root, await idOf(root, 'main'))).rejects.toThrow(/last scene/i);
    expect(await sceneFiles(root)).toEqual(['main.scene.json']);
  });
});

describe('what these operations write', () => {
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

    const original = deserializeScene(
      await readFile(join(root, `${SCENES_DIR}/main.scene.json`), 'utf8'),
    );
    const copy = deserializeScene(await readFile(join(root, scene.path), 'utf8'));

    expect(scene.id).not.toBe(main);
    expect(copy.id).toBe(scene.id);
    expect(copy.name).toBe('Main Copy');
    expect(Object.keys(copy.entities)).toHaveLength(Object.keys(original.entities).length);
  });

  /*
   * The file is the addition. Nothing is written to `project.json` at all,
   * which is why a scene created here and a scene copied in the Finder are now
   * the same event — and why two people adding one no longer collide.
   */
  it('adds a scene without touching the project file', async () => {
    const root = await projectWith(['main']);
    const before = await readFile(join(root, PROJECT_FILE_NAME), 'utf8');

    const { project, scenes, scene } = await createScene(root, 'Arena');

    expect(await readFile(join(root, PROJECT_FILE_NAME), 'utf8')).toBe(before);
    expect(project).toEqual(await readProject(root));
    // Path order, which is where the new file falls — not the order it was
    // added in, because nothing records that any more.
    expect(scenes.map((entry) => entry.name)).toEqual(['Arena', 'main']);
    expect(scene.path).toBe(`${SCENES_DIR}/Arena.scene.json`);
    // A new scene is not the start scene: that is a separate, deliberate choice.
    expect(project.startScene).toBe(await idOf(root, 'main'));
  });
});
