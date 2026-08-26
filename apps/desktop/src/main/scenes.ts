import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  SCENES_DIR,
  createId,
  createNewScene,
  deserializeScene,
  findScene,
  sceneName,
  serializeScene,
  type ProjectFile,
  type SceneChange,
  type SceneEntry,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { ProjectError, readProject, writeProject } from './project';

/*
 * The scene registry: what makes a project able to hold more than the one scene
 * `createProject` wrote.
 *
 * **Everything here addresses a scene by id** — `SceneDoc.id`, adopted by the
 * project when the scene is created. The name is for the person using the
 * editor and the path is where the file happens to sit; neither is a reference,
 * so renaming is a one-line write and moving nothing. See ADR-15.
 *
 * Four invariants live here, and each one is breakable in a single call:
 *
 * 1. **Names are unique.** Not for the machine's sake any more — nothing
 *    resolves through them — but because a script may name a scene, and two
 *    scenes called `Boss` make that ambiguous. The exporter's `sceneMap` is a
 *    `Record` keyed by name for the same reason.
 * 2. **`startScene` is one of `scenes`.** Otherwise `openProject` falls back,
 *    silently, to a scene the author did not choose.
 * 3. **`BuildProfile.scenes` follows.** A profile naming a scene that no longer
 *    exists ships a build missing a level, a long way from the deletion.
 * 4. **The last scene stays.** A project with none cannot be opened at all.
 *
 * A fifth, from when references were paths and names: `settings.loadingScene`
 * is an id now, so it follows a rename for free — which is exactly the point of
 * the change.
 *
 * What this module does not do is edit scene documents. A window may have one
 * open with unsaved work, and a process writing into a file another window
 * holds is a data-loss path.
 */

/**
 * A name reduced to what a file name can hold, and to what reads back as
 * itself.
 *
 * `sceneName` strips `.scene.json` *and* `.json`, so a scene called `Boss.json`
 * would produce `Boss.json.scene.json` and read back as `Boss`. Reducing to a
 * fixed point first is what keeps the two agreeing.
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
 * A file path no scene is using.
 *
 * Names are unique but paths outlive them: a scene created as `Boss` and later
 * renamed to `Arena` keeps `scenes/Boss.scene.json`, so a new `Boss` needs
 * somewhere else to live. Suffixed rather than refused — the author asked for a
 * name, not for a file name.
 */
function freePathFor(project: ProjectFile, name: string): string {
  const taken = new Set(project.scenes.map((entry) => entry.path));
  const base = `${SCENES_DIR}/${name}`;

  if (!taken.has(`${base}.scene.json`)) return `${base}.scene.json`;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base} ${index}.scene.json`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${createId()}.scene.json`;
}

/**
 * @param except A scene allowed to hold the name — itself, when renaming.
 *
 * Compared without case: `Boss` and `boss` reading as two scenes to the editor
 * and as one to a script naming either is worse than refusing the second.
 */
function requireNameAvailable(project: ProjectFile, name: string, except?: string): void {
  if (name === '') throw new ProjectError('A scene name cannot be empty.');

  const taken = project.scenes.some(
    (entry) => entry.id !== except && entry.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new ProjectError(`This project already has a scene called "${name}".`);
}

function requireScene(project: ProjectFile, sceneId: string): SceneEntry {
  const entry = findScene(project, sceneId);
  if (!entry) throw new ProjectError(`"${sceneId}" is not a scene of this project.`);
  return entry;
}

/**
 * Drops every reference to a scene at once — the project's list, the start
 * scene, each build profile, and the loading scene.
 *
 * One function rather than four call sites, because forgetting any of them
 * shows up somewhere else entirely: at the next open, or in an export, or when
 * a level finishes loading. Renaming needs none of this any more, which is the
 * whole return on addressing scenes by id.
 */
function withoutScene(project: ProjectFile, sceneId: string): ProjectFile {
  const scenes = project.scenes.filter((entry) => entry.id !== sceneId);

  const profiles = Object.fromEntries(
    Object.entries(project.settings.build.profiles).map(([id, profile]) => [
      id,
      { ...profile, scenes: profile.scenes.filter((each) => each !== sceneId) },
    ]),
  );

  return {
    ...project,
    scenes,
    // Never left pointing at what was just removed; `scenes` cannot be empty
    // here because deleting the last scene is refused.
    startScene: project.startScene === sceneId ? (scenes[0]?.id ?? '') : project.startScene,
    settings: {
      ...project.settings,
      loadingScene: project.settings.loadingScene === sceneId ? null : project.settings.loadingScene,
      build: { ...project.settings.build, profiles },
    },
  };
}

/** A new, empty scene with the root `Scene` entity. */
export async function createScene(projectPath: string, name: string): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const newName = toSceneName(name);
  requireNameAvailable(project, newName);

  // The document is authored first so the project can adopt its id, rather than
  // mint a second identity that could drift from the one in the file.
  const document = createNewScene(newName);
  const scene: SceneEntry = { id: document.id, name: newName, path: freePathFor(project, newName) };
  await writeSceneFile(projectPath, scene.path, serializeScene(document));

  const updated: ProjectFile = { ...project, scenes: [...project.scenes, scene] };
  await writeProject(projectPath, updated);
  return { project: updated, scene };
}

/**
 * Copies a scene under a new name.
 *
 * The copy gets its own document id: two files claiming one identity is the
 * kind of aliasing that surfaces much later, and it is now the identity the
 * whole project references.
 */
export async function duplicateScene(
  projectPath: string,
  sceneId: string,
  name: string,
): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const source = requireScene(project, sceneId);

  const copyName = toSceneName(name);
  requireNameAvailable(project, copyName);

  const document = deserializeScene(await readFile(resolveInside(projectPath, source.path), 'utf8'));
  const scene: SceneEntry = {
    id: createId(),
    name: copyName,
    path: freePathFor(project, copyName),
  };
  await writeSceneFile(
    projectPath,
    scene.path,
    serializeScene({ ...document, id: scene.id, name: copyName }),
  );

  const updated: ProjectFile = { ...project, scenes: [...project.scenes, scene] };
  await writeProject(projectPath, updated);
  return { project: updated, scene };
}

/**
 * Changes the label, and nothing else.
 *
 * No file is moved and no reference is rewritten: that is what addressing
 * scenes by id buys. The file keeps the name it was created under, which will
 * drift from the scene's name over time — the same trade Unity makes with its
 * GUIDs and Godot with `uid://`.
 */
export async function renameScene(
  projectPath: string,
  sceneId: string,
  name: string,
): Promise<SceneChange> {
  const project = await readProject(projectPath);
  const current = requireScene(project, sceneId);

  const newName = toSceneName(name);
  requireNameAvailable(project, newName, sceneId);
  if (newName === current.name) return { project, scene: current };

  const scene: SceneEntry = { ...current, name: newName };
  const updated: ProjectFile = {
    ...project,
    scenes: project.scenes.map((entry) => (entry.id === sceneId ? scene : entry)),
  };
  await writeProject(projectPath, updated);
  return { project: updated, scene };
}

export async function deleteScene(projectPath: string, sceneId: string): Promise<ProjectFile> {
  const project = await readProject(projectPath);
  const scene = requireScene(project, sceneId);

  if (project.scenes.length <= 1) {
    // `openProject` throws for a project with no scenes, so this would leave
    // one that cannot be opened again.
    throw new ProjectError('A project needs a scene; this is the last scene.');
  }

  // The project file first: a delete that fails half way should leave a project
  // that opens, not one pointing at a file that is gone.
  const updated = withoutScene(project, sceneId);
  await writeProject(projectPath, updated);
  await rm(resolveInside(projectPath, scene.path), { force: true });
  return updated;
}

export async function setStartScene(projectPath: string, sceneId: string): Promise<ProjectFile> {
  const project = await readProject(projectPath);
  requireScene(project, sceneId);

  const updated: ProjectFile = { ...project, startScene: sceneId };
  await writeProject(projectPath, updated);
  return updated;
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
