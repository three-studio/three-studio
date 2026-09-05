import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  CACHE_DIR,
  ENGINE_VERSION,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  SCENE_FILE_SUFFIX,
  createBuildProfiles,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  findScene,
  normalizeBuildProfiles,
  resolveScene,
  sceneName,
  serializeScene,
  type OpenProject,
  type ProjectContents,
  type ProjectFile,
  type ProjectSummary,
  type SceneEntry,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { FileIndex, stampOf } from './projectIndex';
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
  // Taken from the importers rather than listed here. The list that used to be
  // here named four of the seven: `prefabs`, `shaders` and `audio` each had an
  // importer and no folder, so the one place an author would look for them was
  // the one place they were not — and a new importer would have landed the same
  // way. A `Set` because nothing stops two kinds sharing a directory.
  for (const directory of new Set(Object.values(ASSET_KIND_INFO).map((it) => it.directory))) {
    await mkdir(join(projectPath, ASSETS_DIR, directory), { recursive: true });
  }

  // The document carries its own identity, and `startScene` adopts it rather
  // than a second id being minted here that could drift from the one in the
  // file. The entry below is what `discoverScenes` would read back; it is built
  // here so the first window does not have to walk a directory it just wrote.
  const starter = createStarterScene();
  const sceneJson = serializeScene(starter);
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
 * broken scene must not be a project that will not open.
 */
export async function discoverScenes(projectPath: string): Promise<SceneEntry[]> {
  const found: SceneEntry[] = [];
  // Only the app version: unlike a sidecar, nothing here is repaired or filled
  // in on read, so the id in the file is the whole of what is cached.
  const index = await FileIndex.open<string>(projectPath, 'scenes.index.json', ENGINE_VERSION);

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

        let id = index.reuse(path, stamp);
        if (id === undefined) {
          const read = await readSceneId(child, path);
          if (read === null) continue;
          index.put(path, stamp, read);
          id = read;
        }
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
 * The `SceneDoc.id` in a scene file, or `null` when the file is not readable.
 *
 * Parsed rather than deserialized: `deserializeScene` validates and migrates a
 * whole document, and this runs once per file every time a project opens.
 *
 * A file with no id falls back to its own path. A hand-written `.scene.json`
 * has no identity of its own, and addressing it by where it is says exactly
 * that — a reference that its next move will break, which is the truth about a
 * scene that never carried one. Showing it beats refusing to list it.
 */
async function readSceneId(file: string, path: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const id = (parsed as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : path;
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
export async function openProject(projectPath: string, wanted?: string): Promise<OpenProject> {
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

/**
 * Writes the project file back, through a temporary file like a scene.
 *
 * Private, and reachable only from inside `updateProject`: a second door to
 * this file is a second way past the queue, and the queue is the only thing
 * stopping two windows from losing each other's work. It is also what makes
 * the fixed `.tmp` name safe here, where `FileIndex` needs a unique one.
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
  const target = join(projectPath, PROJECT_FILE_NAME);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(project, null, 2), 'utf8');
  await rename(temporary, target);
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

/** The project file, carried forward and with anything a newer format added filled in. */
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
  // The version is the whole of the check. `scenes` was required here too, and
  // requiring it is exactly what made a project whose list had gone refuse to
  // open: the list is the `scenes/` directory now, and an empty one is a
  // project with no scenes rather than a file that is malformed.
  if (typeof project.version !== 'number') {
    throw new ProjectError(`${PROJECT_FILE_NAME} is missing required fields.`);
  }
  // The one refusal left, and the only one a version number can justify: a
  // format written after this build was made says nothing about what its
  // fields mean, so reading it would be guessing. Everything older is carried
  // forward below.
  if (project.version > PROJECT_FORMAT_VERSION) {
    throw new ProjectError(
      `This project was created by a newer version of the editor (format ${project.version}; this build reads ${PROJECT_FORMAT_VERSION}). Update Three Studio to open it.`,
    );
  }

  // Filled from each section's own factory rather than demanded, which is what
  // makes adding a setting a change to one function instead of a migration.
  // See the format rules in `README.md`.
  const settings = (project.settings ?? {}) as Partial<ProjectFile['settings']>;
  settings.rendering = { ...createRenderingSettings(), ...settings.rendering };
  settings.physics = { ...createPhysicsSettings(), ...settings.physics };
  // Not `??=`: a profile written before a build option existed is missing that
  // one field, not the whole section, and only the profiles themselves know
  // which. `normalizeBuildProfiles` fills each from the factory.
  settings.build = normalizeBuildProfiles(settings.build, project.name ?? 'Project');
  settings.loadingScene ??= null;
  (parsed as ProjectFile).settings = settings as ProjectFile['settings'];

  // The list this file used to carry. Dropped from the object, not from the
  // file: reading a project must not rewrite it, so the key leaves `project.json`
  // the next time something writes for a reason of its own. Until then it is a
  // stale copy of the directory that nothing reads — which is what it always
  // was, and why it is going.
  delete (parsed as { scenes?: unknown }).scenes;

  // Migrated after the fill, so a step only has to translate the meanings it
  // recognises instead of also defending against a section that did not exist
  // when the file was written. The walk is inside the branch because only an
  // old file should pay for it: `saveScene` and `readSceneFile` come through
  // here on every save, and a current project must not read a directory to be
  // told it is already current. An old one walks twice on open — once here,
  // once in `openProject` — which the index of T-019 makes a warm `stat` each.
  if (project.version < PROJECT_FORMAT_VERSION) {
    adoptSceneIds(parsed as ProjectFile, await discoverScenes(projectPath));
  }
  // Stamped, so the object says which format it now conforms to. Nothing is
  // written back: reading a project must not dirty it in version control, and
  // the upgraded form reaches the file the next time something writes it for a
  // reason of its own — the same route the `scenes` key above takes out.
  (parsed as ProjectFile).version = PROJECT_FORMAT_VERSION;

  return parsed as ProjectFile;
}

/**
 * Format 1 → 2: every scene reference becomes the id of the scene it named.
 *
 * Format 1 addressed the start scene by path and the loading scene by name,
 * and this build reads both as ids. That is why the old file was refused
 * outright — "create it again" — rather than misread: opened as it stands, a
 * format 1 project starts on no scene, shows no loading scene, and exports a
 * build missing every level, with nothing tying any of it to the upgrade.
 * Refusing was the safe half of the answer; this is the other half.
 *
 * The registry that file carried in `scenes` is not consulted. It was a copy
 * of `scenes/` that could already be stale on the day it was written — the
 * reason it is gone — so the disk answers instead, and a scene added or
 * removed in the Finder since migrates as correctly as one that never moved.
 */
function adoptSceneIds(project: ProjectFile, scenes: readonly SceneEntry[]): void {
  const { settings } = project;
  project.startScene = sceneIdFor(scenes, project.startScene);
  if (settings.loadingScene !== null) {
    settings.loadingScene = sceneIdFor(scenes, settings.loadingScene);
  }
  for (const profile of Object.values(settings.build.profiles)) {
    profile.scenes = profile.scenes.map((reference) => sceneIdFor(scenes, reference));
  }
}

/**
 * The id of the scene an old reference named, or the reference left untouched.
 *
 * Path first, because that is what `startScene` held and a path is the one
 * form that cannot be confused with another scene's; then `resolveScene`,
 * which takes an id ahead of a name, so a reference that already carries one
 * survives being read a second time.
 *
 * A reference that resolves to nothing is returned exactly as it was found.
 * The file it names can have been deleted in the Finder, and `openProject`
 * falls back to the first scene; throwing here would put back the failure this
 * whole function exists to remove.
 */
function sceneIdFor(scenes: readonly SceneEntry[], reference: string): string {
  const entry = scenes.find((scene) => scene.path === reference) ?? resolveScene(scenes, reference);
  return entry?.id ?? reference;
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
