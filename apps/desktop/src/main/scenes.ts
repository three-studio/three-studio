import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import {
  SCENES_DIR,
  SCENE_FILE_SUFFIX,
  createId,
  createNewScene,
  deserializeScene,
  findScene,
  sceneName,
  serializeScene,
  type ProjectContents,
  type ProjectFile,
  type SceneChange,
  type SceneEntry,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { ProjectError, discoverScenes, readProject, writeProject } from './project';

/*
 * The five things that can be done to the scenes of a project: create one,
 * duplicate one, rename one, delete one, and choose the one a project opens on.
 *
 * **Everything here addresses a scene by id** — `SceneDoc.id`, written into the
 * document when the scene is created. See ADR-15.
 *
 * The list itself is not here any more. `scenes/` is the list and
 * `discoverScenes` reads it, so three of the four invariants this module used
 * to hold went with the copy they were protecting. What is left is what a
 * directory cannot say for itself:
 *
 * 1. **Names are unique.** Not for the machine's sake — nothing resolves
 *    through a name — but a script may name a scene, and two called `Boss` make
 *    that ambiguous. The disk permits it, since two folders under `scenes/` can
 *    hold a `Boss.scene.json` each; this refuses to be what creates it, and
 *    `resolveScene` takes the first by path order when it meets one anyway.
 * 2. **The last scene stays.** A project with none cannot be opened at all.
 *
 * `startScene`, `loadingScene` and the build profiles are still tidied when a
 * scene is deleted from here, but none of the three is an invariant now: each
 * tolerates an id that is not on disk, because a scene can be deleted in the
 * Finder without this module ever running.
 *
 * What this module does not do is edit scene documents. A window may have one
 * open with unsaved work, and a process writing into a file another window
 * holds is a data-loss path. Renaming is the one operation that touches a file
 * at all — it moves it, because the file name is the name.
 *
 * Each of the four writes below walks `scenes/` a second time afterwards rather
 * than splicing its own result into the list it already had. Splicing means a
 * second copy of the ordering and shadowing rules `discoverScenes` owns, and a
 * second copy of a rule is how two answers come to disagree — which is the
 * whole reason `project.json` stopped holding this list. T-019 is what makes
 * the second walk cheap.
 */

/**
 * A name reduced to what a file name can hold, and to what reads back as
 * itself.
 *
 * `sceneName` strips `.scene.json` *and* `.json`, so a scene called `Boss.json`
 * would produce `Boss.json.scene.json` and read back as `Boss`. Reducing to a
 * fixed point first is what keeps the two agreeing — and it matters more than
 * it did, because the name is now read back out of the path every time.
 */
function toSceneName(requested: string): string {
  // The characters Windows reserves, plus separators and control characters:
  // the name becomes a file name, and a `/` in it would silently make a folder.
  let name = requested
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();

  for (let next = sceneName(name); next !== name; next = sceneName(name)) name = next;
  return name;
}

/**
 * Where a scene called `name` lives, inside a given folder of the project.
 *
 * There used to be a search here for a file name nothing was using, which could
 * settle on `Boss 2.scene.json`. That was only possible while the name lived in
 * `project.json` and was free to disagree with the file — a scene called `Boss`
 * sitting in a file called `Boss 2`. The name is the file name now, so a name
 * that is taken is a path that is taken, and the answer is a refusal rather
 * than a second-best file the author never asked for.
 */
function scenePathIn(folder: string, name: string): string {
  return `${folder}/${name}${SCENE_FILE_SUFFIX}`;
}

/**
 * @param except Path of the scene allowed to hold the name — itself, when
 *   renaming. A path rather than an id, because two files can now claim one id.
 *
 * Compared without case: `Boss` and `boss` reading as two scenes to the editor
 * and as one to a script naming either is worse than refusing the second.
 */
function requireNameAvailable(
  scenes: readonly SceneEntry[],
  name: string,
  except?: string,
): void {
  if (name === '') throw new ProjectError('A scene name cannot be empty.');

  const taken = scenes.some(
    (entry) => entry.path !== except && entry.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new ProjectError(`This project already has a scene called "${name}".`);
}

/**
 * Refuses a path that already holds a file, before anything is written there.
 *
 * The name check above only sees scenes that could be read, and a `.scene.json`
 * with broken JSON in it is not one of them — `discoverScenes` skips it so that
 * the project still opens. Without this, writing over it would be silent, and
 * somebody's unopenable scene is still somebody's scene.
 */
async function requireFree(projectPath: string, path: string): Promise<void> {
  try {
    await stat(resolveInside(projectPath, path));
  } catch {
    return;
  }
  throw new ProjectError(`"${path}" already exists in this project.`);
}

function requireScene(scenes: readonly SceneEntry[], sceneId: string): SceneEntry {
  const entry = findScene(scenes, sceneId);
  if (!entry) throw new ProjectError(`"${sceneId}" is not a scene of this project.`);
  return entry;
}

/**
 * Drops every reference to a scene at once — the start scene, each build
 * profile, and the loading scene.
 *
 * Tidiness now rather than an invariant: all three tolerate an id with no file,
 * because a scene deleted in the Finder never comes through here. It is still
 * done, because a profile that ships a scene nobody can find is a build someone
 * will one day have to explain.
 *
 * @param remaining What is on disk after the file went, which is what says
 *   whether the id is really gone.
 */
function withoutScene(
  project: ProjectFile,
  sceneId: string,
  remaining: readonly SceneEntry[],
): ProjectFile {
  // Still there: a second file claimed the same id — see `SceneEntry.shadowedBy`
  // — so removing one of the two did not remove the scene the references name.
  if (findScene(remaining, sceneId)) return project;

  const profiles = Object.fromEntries(
    Object.entries(project.settings.build.profiles).map(([id, profile]) => [
      id,
      { ...profile, scenes: profile.scenes.filter((each) => each !== sceneId) },
    ]),
  );

  return {
    ...project,
    // Never left pointing at what was just removed; `remaining` cannot be empty
    // here because deleting the last scene is refused.
    startScene: project.startScene === sceneId ? (remaining[0]?.id ?? '') : project.startScene,
    settings: {
      ...project.settings,
      loadingScene: project.settings.loadingScene === sceneId ? null : project.settings.loadingScene,
      build: { ...project.settings.build, profiles },
    },
  };
}

/**
 * A new, empty scene with the root `Scene` entity.
 *
 * `project.json` is not written at all: the file under `scenes/` **is** the
 * addition. That is the whole of what this task bought — a scene created here
 * and a scene copied in the Finder are now the same event.
 */
export async function createScene(projectPath: string, name: string): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const scenes = await discoverScenes(projectPath);

  const newName = toSceneName(name);
  requireNameAvailable(scenes, newName);
  const path = scenePathIn(SCENES_DIR, newName);
  await requireFree(projectPath, path);

  // The document is authored first so it carries the id, rather than an id
  // being minted beside it that could drift from the one in the file.
  const document = createNewScene(newName);
  const scene: SceneEntry = { id: document.id, name: newName, path, shadowedBy: null };
  await writeSceneFile(projectPath, path, serializeScene(document));

  return { project, scenes: await discoverScenes(projectPath), scene };
}

/**
 * Copies a scene under a new name, beside the file it copied.
 *
 * The copy gets its own document id: two files claiming one identity is the
 * kind of aliasing that surfaces much later, and it is now the identity the
 * whole project references. `SceneEntry.shadowedBy` exists because the Finder
 * will make one of those anyway, and this is the one place that will not.
 */
export async function duplicateScene(
  projectPath: string,
  sceneId: string,
  name: string,
): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const scenes = await discoverScenes(projectPath);
  const source = requireScene(scenes, sceneId);

  const copyName = toSceneName(name);
  requireNameAvailable(scenes, copyName);
  const path = scenePathIn(posix.dirname(source.path), copyName);
  await requireFree(projectPath, path);

  const document = deserializeScene(await readFile(resolveInside(projectPath, source.path), 'utf8'));
  const scene: SceneEntry = { id: createId(), name: copyName, path, shadowedBy: null };
  await writeSceneFile(
    projectPath,
    path,
    serializeScene({ ...document, id: scene.id, name: copyName }),
  );

  return { project, scenes: await discoverScenes(projectPath), scene };
}

/**
 * Moves the file, and rewrites nothing else.
 *
 * The file name is the name, so this is what renaming is. No reference moves
 * with it — every one of them is an id (ADR-15) — which is why a rename that
 * changes where a scene lives still costs one write and breaks nothing. The
 * file used to stay put and the label move instead, and the price was that the
 * Finder and the editor disagreed about the name of every renamed scene.
 *
 * The window showing the scene has to adopt the path out of the result; see
 * `renameCurrentScene`.
 */
export async function renameScene(
  projectPath: string,
  sceneId: string,
  name: string,
): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const scenes = await discoverScenes(projectPath);
  const current = requireScene(scenes, sceneId);

  const newName = toSceneName(name);
  requireNameAvailable(scenes, newName, current.path);
  if (newName === current.name) return { project, scenes, scene: current };

  // Stays in the folder it was in: moving a scene between folders is a thing
  // the Finder does, and giving it a second meaning here would make a rename
  // do two things at once.
  const path = scenePathIn(posix.dirname(current.path), newName);
  // A change of case is a rename of the file onto itself where the volume is
  // case-insensitive, which is macOS and Windows by default. `stat` finds the
  // target there because it *is* the source, so checking would refuse the one
  // rename that is certainly safe.
  if (path.toLowerCase() !== current.path.toLowerCase()) {
    await requireFree(projectPath, path);
  }
  await rename(resolveInside(projectPath, current.path), resolveInside(projectPath, path));

  const scene: SceneEntry = { ...current, name: newName, path };
  return { project, scenes: await discoverScenes(projectPath), scene };
}

export async function deleteScene(
  projectPath: string,
  sceneId: string,
): Promise<ProjectContents> {
  const project = await readProject(projectPath);
  const scenes = await discoverScenes(projectPath);
  const scene = requireScene(scenes, sceneId);

  if (scenes.length <= 1) {
    // `openProject` throws for a project with no scenes, so this would leave
    // one that cannot be opened again.
    throw new ProjectError('A project needs a scene; this is the last scene.');
  }

  // The file first, then the project file — the reverse of the old order, and
  // for the reason that reversed it: what the project should say about its
  // start scene depends on what is left on disk, so the disk goes first and is
  // then read back. A crash between the two leaves a project that opens, since
  // nothing in it has to name a file that exists.
  await rm(resolveInside(projectPath, scene.path), { force: true });
  const remaining = await discoverScenes(projectPath);
  const updated = withoutScene(project, sceneId, remaining);
  await writeProject(projectPath, updated);
  return { project: updated, scenes: remaining };
}

export async function setStartScene(
  projectPath: string,
  sceneId: string,
): Promise<ProjectContents> {
  const project = await readProject(projectPath);
  const scenes = await discoverScenes(projectPath);
  requireScene(scenes, sceneId);

  const updated: ProjectFile = { ...project, startScene: sceneId };
  await writeProject(projectPath, updated);
  return { project: updated, scenes };
}

/** Through a temporary file and a rename, like every other write to a project. */
async function writeSceneFile(
  projectPath: string,
  scenePath: string,
  contents: string,
): Promise<void> {
  const target = resolveInside(projectPath, scenePath);
  await mkdir(dirname(target), { recursive: true });

  const temporary = `${target}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, target);
}
