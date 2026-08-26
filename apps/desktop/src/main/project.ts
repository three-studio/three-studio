import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  ASSETS_DIR,
  CACHE_DIR,
  ENGINE_VERSION,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  findScene,
  sceneName,
  serializeScene,
  type OpenProject,
  type ProjectFile,
  type ProjectSummary,
  type SceneEntry,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { remember } from './recentProjects';
import { writeScriptTypings } from './scripts';

const DEFAULT_SCENE_PATH = `${SCENES_DIR}/main.scene.json`;

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export async function createProject(name: string, directory: string): Promise<OpenProject> {
  const trimmed = name.trim();
  if (trimmed === '') throw new ProjectError('Project name cannot be empty.');

  const projectPath = join(directory, sanitizeFolderName(trimmed));
  if (await exists(projectPath)) {
    throw new ProjectError(`"${basename(projectPath)}" already exists in that folder.`);
  }

  await mkdir(join(projectPath, SCENES_DIR), { recursive: true });
  await mkdir(join(projectPath, CACHE_DIR), { recursive: true });
  for (const kind of ['models', 'textures', 'materials', 'scripts']) {
    await mkdir(join(projectPath, ASSETS_DIR, kind), { recursive: true });
  }

  // The document is written first so the project can adopt its id: a scene
  // carries its own identity, and the registry references it rather than
  // minting a second one that could drift.
  const starter = createStarterScene();
  const sceneJson = serializeScene(starter);
  const entry: SceneEntry = { id: starter.id, name: sceneName(DEFAULT_SCENE_PATH), path: DEFAULT_SCENE_PATH };

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: trimmed,
    engineVersion: ENGINE_VERSION,
    scenes: [entry],
    startScene: entry.id,
    settings: {
      loadingScene: null,
      rendering: createRenderingSettings(),
      physics: createPhysicsSettings(),
      build: createBuildProfiles(trimmed),
    },
  };

  await writeFile(join(projectPath, PROJECT_FILE_NAME), JSON.stringify(project, null, 2), 'utf8');
  await writeFile(join(projectPath, DEFAULT_SCENE_PATH), sceneJson, 'utf8');
  // The cache holds build output and thumbnails; nothing there belongs in git.
  await writeFile(join(projectPath, CACHE_DIR, '.gitignore'), '*\n', 'utf8');

  return finalize(projectPath, project, entry, sceneJson);
}

/**
 * @param wanted Id of a scene of this project, opened instead of its start
 *   scene. How a window reopens on the scene it was showing, and how a second
 *   window opens on a different one. Ignored when the project no longer has
 *   it: a stale URL must not make a project refuse to open.
 */
export async function openProject(projectPath: string, wanted?: string): Promise<OpenProject> {
  const project = await readProjectFile(projectPath);

  const entry =
    (wanted === undefined ? undefined : findScene(project, wanted)) ??
    findScene(project, project.startScene) ??
    project.scenes[0];
  if (!entry) throw new ProjectError('This project has no scenes.');

  let sceneJson: string;
  try {
    sceneJson = await readFile(resolveInside(projectPath, entry.path), 'utf8');
  } catch {
    throw new ProjectError(`Scene "${entry.name}" is missing from the project.`);
  }

  return finalize(projectPath, project, entry, sceneJson);
}

/**
 * Writes a scene through a temporary file and a rename.
 *
 * A crash or a full disk part-way through a direct write would leave the user
 * with a truncated scene and no copy of the original — the one failure mode an
 * editor must not have.
 */
export async function saveScene(
  projectPath: string,
  scenePath: string,
  contents: string,
): Promise<void> {
  await readProjectFile(projectPath);
  const target = resolveInside(projectPath, scenePath);
  const temporary = `${target}.tmp`;

  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, target);
}

/**
 * Reads one scene of the open project.
 *
 * Separate from `openProject`, which hands back the starting scene: this is
 * what a running game asks for when it moves to the next one, and the renderer
 * names the path, so it goes through the same containment guard as everything
 * else it can name.
 */
export async function readSceneFile(projectPath: string, scenePath: string): Promise<string> {
  await readProjectFile(projectPath);
  return readFile(resolveInside(projectPath, scenePath), 'utf8');
}

/** Writes the project file back, through a temporary file like a scene. */
export async function writeProject(projectPath: string, project: ProjectFile): Promise<void> {
  const target = join(projectPath, PROJECT_FILE_NAME);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(project, null, 2), 'utf8');
  await rename(temporary, target);
}

/** The project file, with anything a newer format added filled in. */
export async function readProject(projectPath: string): Promise<ProjectFile> {
  return readProjectFile(projectPath);
}

async function readProjectFile(projectPath: string): Promise<ProjectFile> {
  let raw: string;
  try {
    raw = await readFile(join(projectPath, PROJECT_FILE_NAME), 'utf8');
  } catch {
    throw new ProjectError(`No ${PROJECT_FILE_NAME} found in "${projectPath}".`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectError(`${PROJECT_FILE_NAME} is not valid JSON.`);
  }

  const project = parsed as Partial<ProjectFile>;
  if (typeof project.version !== 'number' || !Array.isArray(project.scenes)) {
    throw new ProjectError(`${PROJECT_FILE_NAME} is missing required fields.`);
  }
  if (project.version > PROJECT_FORMAT_VERSION) {
    throw new ProjectError(
      `This project was created by a newer version of the editor (format ${project.version}).`,
    );
  }
  // Refused rather than migrated. Format 1 addressed scenes by path and the
  // loading scene by name; format 2 addresses both by id, and reading one as
  // the other would produce a project whose every reference is wrong. There is
  // nothing older in the wild to migrate — the editor has never shipped.
  if (project.version < PROJECT_FORMAT_VERSION) {
    throw new ProjectError(
      `This project uses project format ${project.version}; this build reads ${PROJECT_FORMAT_VERSION}. Create it again.`,
    );
  }

  // Filled from each section's own factory rather than demanded, which is what
  // makes adding a setting a change to one function instead of a migration.
  // See the format rules in `README.md`.
  const settings = (project.settings ?? {}) as Partial<ProjectFile['settings']>;
  settings.rendering = { ...createRenderingSettings(), ...settings.rendering };
  settings.physics = { ...createPhysicsSettings(), ...settings.physics };
  settings.build ??= createBuildProfiles(project.name ?? 'Project');
  settings.loadingScene ??= null;
  (parsed as ProjectFile).settings = settings as ProjectFile['settings'];

  return parsed as ProjectFile;
}

async function finalize(
  projectPath: string,
  project: ProjectFile,
  entry: SceneEntry,
  sceneJson: string,
): Promise<OpenProject> {
  // Refreshed on every open so the declarations track the editor version rather
  // than whatever shipped when the project was first created.
  await writeScriptTypings(projectPath).catch(() => undefined);

  const summary: ProjectSummary = {
    name: project.name,
    path: projectPath,
    lastOpenedAt: Date.now(),
  };
  await remember(summary);
  return { summary, project, scenePath: entry.path, sceneId: entry.id, sceneJson };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a project name usable as a directory on all three platforms: removes
 * the characters Windows reserves plus control characters, collapses runs of
 * whitespace, and drops trailing dots and spaces (which Windows would strip
 * silently, leaving the on-disk name different from the one in project.json).
 *
 * Spaces are kept — they are legal everywhere, and quoting paths is the
 * caller's job.
 */
function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned === '' ? 'Untitled Project' : cleaned;
}
