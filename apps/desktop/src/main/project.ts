import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import {
  ASSETS_DIR,
  CACHE_DIR,
  ENGINE_VERSION,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  SCENE_FILE_SUFFIX,
  assetKindInfo,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  decodeProjectFile,
  findScene,
  formatDiagnostics,
  isRecord,
  isSceneId,
  safeFileName,
  sceneName,
  serializeScene,
  type CoreRegistries,
  type OpenProject,
  type ProjectContents,
  type ProjectFile,
  type ProjectSummary,
  type SceneEntry,
  type SceneId,
} from '@three-studio/core';
import { atomicWrite } from './atomicWrite';
import { MissingFileError, isNotFound, resolveInside } from './paths';
import { FileIndex, stampOf } from './projectIndex';
import { remember } from './recentProjects';
import { writeScriptTypings } from './scripts';

const DEFAULT_SCENE_PATH = `${SCENES_DIR}/main${SCENE_FILE_SUFFIX}`;

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export async function createProject(
  registries: CoreRegistries,
  name: string,
  directory: string,
): Promise<OpenProject> {
  const trimmed = name.trim();
  if (trimmed === '') throw new ProjectError('Project name cannot be empty.');

  const projectPath = join(directory, sanitizeFolderName(trimmed));
  if (await exists(projectPath)) {
    throw new ProjectError(`"${basename(projectPath)}" already exists in that folder.`);
  }

  await mkdir(join(projectPath, SCENES_DIR), { recursive: true });
  await mkdir(join(projectPath, CACHE_DIR), { recursive: true });
  // Taken from the importers rather than listed here. The list that used to be
  // here named four of the seven: `prefabs`, `shaders` and `audio` each had an
  // importer and no folder, so the one place an author would look for them was
  // the one place they were not — and a new importer would have landed the same
  // way. A `Set` because nothing stops two kinds sharing a directory.
  for (const directory of new Set([...assetKindInfo(registries).values()].map((it) => it.directory))) {
    await mkdir(join(projectPath, ASSETS_DIR, directory), { recursive: true });
  }

  // The document carries its own identity, and `startScene` adopts it rather
  // than a second id being minted here that could drift from the one in the
  // file. The entry below is what `discoverScenes` would read back; it is built
  // here so the first window does not have to walk a directory it just wrote.
  const starter = createStarterScene();
  const sceneJson = serializeScene(registries, starter);
  const entry: SceneEntry = {
    id: starter.id,
    name: sceneName(DEFAULT_SCENE_PATH),
    path: DEFAULT_SCENE_PATH,
    shadowedBy: null,
  };

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: trimmed,
    engineVersion: ENGINE_VERSION,
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
  // Two files, and they are not the same promise. The root one is the author's
  // to edit — they will add their own rules to it — and it exists because a
  // project put into git without one commits its own build cache, which is the
  // default outcome for anyone who does not already know the folder is there.
  // The one inside `.studio/` is the editor's guarantee about its own
  // directory, and it still holds when the root file has been rewritten or the
  // cache has been copied somewhere else. Nothing in there belongs in git: it
  // is build output and thumbnails.
  await writeFile(join(projectPath, '.gitignore'), `${CACHE_DIR}/\n`, 'utf8');
  await writeFile(join(projectPath, CACHE_DIR, '.gitignore'), '*\n', 'utf8');

  return finalize(projectPath, { project, scenes: [entry] }, entry, sceneJson);
}

/**
 * What the scene index was built by: the app version, and what an id is.
 *
 * The second half is not decoration. A build before scene ids were checked
 * listed a scene file with no id under its **path**, and cached the path as its
 * id. Its index still says the file is unchanged, and it is: what changed is
 * that a path is not an id. So that index is read again, and not reused.
 */
const SCENE_INDEX_BUILT_BY = `${ENGINE_VERSION}:ids-are-checked`;

/**
 * Every scene in the project, read off the disk.
 *
 * `scenes/` is walked rather than a list being consulted, because a list is a
 * cache of exactly this walk and could go stale: a scene copied in the Finder
 * was invisible, and one deleted there stopped the project from opening.
 *
 * The id lives inside each document, which made this read every scene whole to
 * get twelve characters out of the front of it — twenty scenes of three
 * thousand entities is 24 MB read for 20 ids, and it took 75 ms every time a
 * project opened or a scene was created. The index turns that into a `stat`
 * each; it is keyed on mtime and size, so a scene edited anywhere is read
 * again, and a missing or stale index costs one slow walk.
 *
 * A file that cannot be read or parsed is skipped rather than thrown on: one
 * broken scene must not be a project that will not open. So is one that has no
 * id of its own, which is said in the log (`readSceneId`).
 */
export async function discoverScenes(projectPath: string): Promise<SceneEntry[]> {
  const found: SceneEntry[] = [];
  // Nothing here is repaired or filled in on read, so the id in the file is the
  // whole of what is cached — and it is checked when it is reused, since an
  // index is a file somebody may have edited.
  const index = await FileIndex.open<string>(projectPath, 'scenes.index.json', SCENE_INDEX_BUILT_BY);

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // No `scenes/` at all, or one that cannot be read. A project with no
      // scenes is a thing `openProject` reports; it is not a thing to throw
      // about from here.
      return;
    }
    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.name.endsWith(SCENE_FILE_SUFFIX)) {
        const path = toPosix(relative(projectPath, child));
        const stamp = await stampOf(child);
        if (stamp === null) continue;

        const cached = index.reuse(path, stamp);
        const id = isSceneId(cached) ? cached : await readSceneId(child, path);
        if (id === null) continue;
        if (id !== cached) index.put(path, stamp, id);
        found.push({ id, name: sceneName(path), path, shadowedBy: null });
      }
    }
  };
  await walk(join(projectPath, SCENES_DIR));

  // Sorted before the ids are resolved, and by code unit rather than by locale,
  // so "the first one" is a property of the project rather than of the order
  // this file system happened to hand the entries back in — or of the machine
  // reading it.
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const claimed = new Map<string, string>();
  for (const entry of found) {
    const winner = claimed.get(entry.id);
    if (winner === undefined) claimed.set(entry.id, entry.path);
    else entry.shadowedBy = winner;
  }
  await index.save();
  return found;
}

/**
 * The `SceneDoc.id` in a scene file, or `null` when the scene cannot be listed.
 *
 * Parsed rather than deserialized: `deserializeScene` validates and migrates a
 * whole document, and this runs once per file every time a project opens.
 *
 * A file with no id is not listed, and says so. A hand-written `.scene.json`
 * carries no identity of its own, and addressing it by its path would be a
 * reference that its next move breaks — the start scene, a build profile and a
 * window's URL with it, none of them saying why. A reference is an identifier,
 * never a path, and a file that has none is not one anything can refer to. It
 * is named in the log for now, until the editor reports it to its author.
 */
async function readSceneId(file: string, path: string): Promise<SceneId | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const id = parsed['id'];
  if (isSceneId(id)) return id;
  console.warn(`[scenes] ${path} is not listed: it has no id of its own, and a path is not one.`);
  return null;
}

/** Project-relative paths are `/`-separated everywhere; Windows is not. */
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * @param wanted Id of a scene of this project, opened instead of its start
 *   scene. How a window reopens on the scene it was showing, and how a second
 *   window opens on a different one. Ignored when the project no longer has
 *   it: a stale URL must not make a project refuse to open.
 */
export async function openProject(projectPath: string, wanted?: SceneId): Promise<OpenProject> {
  const project = await readProjectFile(projectPath);
  const scenes = await discoverScenes(projectPath);

  // Both lookups fall through rather than failing. `startScene` names a file
  // that can be deleted in the Finder, and this is the fallback that stops one
  // stale line from making a project unopenable.
  const entry =
    (wanted === undefined ? undefined : findScene(scenes, wanted)) ??
    findScene(scenes, project.startScene) ??
    scenes[0];
  if (!entry) throw new ProjectError('This project has no scenes.');

  let sceneJson: string;
  try {
    sceneJson = await readFile(resolveInside(projectPath, entry.path), 'utf8');
  } catch {
    throw new ProjectError(`Scene "${entry.name}" is missing from the project.`);
  }

  return finalize(projectPath, { project, scenes }, entry, sceneJson);
}

/**
 * Writes a scene, whole or not at all.
 *
 * A crash or a full disk part-way through a direct write would leave the user
 * with a truncated scene and no copy of the original — the one failure mode an
 * editor must not have. See `atomicWrite`.
 */
export async function saveScene(
  projectPath: string,
  scenePath: string,
  contents: string,
): Promise<void> {
  await readProjectFile(projectPath);
  await atomicWrite(resolveInside(projectPath, scenePath), contents);
}

/**
 * Reads one scene of the open project.
 *
 * Separate from `openProject`, which hands back the starting scene: this is
 * what a running game asks for when it moves to the next one, and what Revert
 * Scene reads back into the window's document. The renderer names the path, so
 * it goes through the same containment guard as everything else it can name.
 *
 * A file that is not there is said in words, by its place in the project: it
 * was moved or deleted outside the editor, and Node's `ENOENT` with an absolute
 * path is not something a toast should show.
 */
export async function readSceneFile(projectPath: string, scenePath: string): Promise<string> {
  await readProjectFile(projectPath);
  try {
    return await readFile(resolveInside(projectPath, scenePath), 'utf8');
  } catch (cause) {
    throw isNotFound(cause) ? new MissingFileError(scenePath) : cause;
  }
}

/**
 * Writes the project file back, whole or not at all, like a scene.
 *
 * Private, and reachable only from inside `updateProject`: a second door to
 * this file is a second way past the queue, and the queue is the only thing
 * stopping two windows from losing each other's work.
 *
 * Stamps `engineVersion` on the way, because this is the one place the file is
 * written and the field claims to name the build that last wrote it. Only
 * `createProject` ever set it, so what it actually named was the build that
 * created the project — which says nothing about the bytes you are reading
 * when one turns up broken, and that is the whole of what it is for.
 *
 * The caller's object is stamped too, rather than a copy being written: the
 * object goes straight back to the renderer, and a window showing one version
 * while the file on disk says another is a worse answer than no version.
 */
async function writeProject(projectPath: string, project: ProjectFile): Promise<void> {
  project.engineVersion = ENGINE_VERSION;
  await atomicWrite(join(projectPath, PROJECT_FILE_NAME), JSON.stringify(project, null, 2));
}

/**
 * The tail of the queue below. Never rejects — see `updateProject`.
 */
let writes: Promise<unknown> = Promise.resolve();

/**
 * Reads `project.json`, changes it, and writes it back, with nothing else
 * getting in between.
 *
 * A project has N editor windows on it — one per scene — and any of them can
 * set the start scene, delete a scene or save settings. Each of those is a
 * read, a decision and a write with `await`s between them, so two running at
 * once interleave at every one of those points and the second write is built
 * on what the first one read. One window setting the start scene while another
 * saves rendering settings loses whichever landed first, in silence, and the
 * window that lost goes on showing its own change until it is reloaded.
 *
 * A queue and not a lock file, because the main process is this file's only
 * writer: `createProject` writes it into a directory that did not exist a
 * moment ago, and every write after that comes through here. One queue for the
 * process rather than one per project — only one project is open at a time
 * (`activeProjectPath`, `ipc.ts`), and two of them made to wait for each other
 * would cost nothing worth the bookkeeping.
 *
 * @param change What to write. Returning the object it was handed means
 *   nothing moved and nothing is written: a delete that does not touch the
 *   start scene must not put a project in someone's diff.
 */
export function updateProject(
  projectPath: string,
  change: (project: ProjectFile) => ProjectFile | Promise<ProjectFile>,
): Promise<ProjectFile> {
  const run = async (): Promise<ProjectFile> => {
    const project = await readProjectFile(projectPath);
    const updated = await change(project);
    if (updated !== project) await writeProject(projectPath, updated);
    return updated;
  };

  const result = writes.then(run);
  // What the next caller waits on must not be allowed to reject, or one change
  // that threw — a name already taken, a last scene refused — would take down
  // every change queued behind it.
  writes = result.catch(() => undefined);
  return result;
}

/**
 * The project file, decoded. Refused with its diagnostics — the file, then each
 * field and its fault — when it is of another format or malformed.
 */
export async function readProject(projectPath: string): Promise<ProjectFile> {
  return readProjectFile(projectPath);
}

/**
 * Reads `project.json` and decodes it, and does nothing else: nothing is filled
 * in, converted or written back. Every door to a project comes through here
 * first — opening it, saving or reading a scene, changing its settings — so an
 * older project is refused before any scene of it is read, and refused the same
 * way whichever door it was.
 */
async function readProjectFile(projectPath: string): Promise<ProjectFile> {
  const file = join(projectPath, PROJECT_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new ProjectError(`No ${PROJECT_FILE_NAME} found in "${projectPath}".`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectError(`${PROJECT_FILE_NAME} is not valid JSON.`);
  }

  const decoded = decodeProjectFile(parsed);
  if (!decoded.ok) throw new ProjectError(formatDiagnostics(file, decoded.diagnostics));
  return decoded.value;
}

async function finalize(
  projectPath: string,
  contents: ProjectContents,
  entry: SceneEntry,
  sceneJson: string,
): Promise<OpenProject> {
  // Refreshed on every open so the declarations track the editor version rather
  // than whatever shipped when the project was first created.
  await writeScriptTypings(projectPath).catch(() => undefined);

  const summary: ProjectSummary = {
    name: contents.project.name,
    path: projectPath,
    lastOpenedAt: Date.now(),
  };
  await remember(summary);
  return { ...contents, summary, scenePath: entry.path, sceneId: entry.id, sceneJson };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The one file-name rule, plus what a project with no name left is called. */
function sanitizeFolderName(name: string): string {
  return safeFileName(name) || 'Untitled Project';
}
