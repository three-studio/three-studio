import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import {
  ASSETS_DIR,
  collectSceneAssets,
  type TextureEncoding,
  findScene,
  BUILD_FORMAT_VERSION,
  type AssetSettings,
  deserializeScene,
  serializeScene,
  type BuildProfile,
  type ComponentDoc,
  type ExportProgress,
  type ExportResult,
  type MaterialDef,
  type PrefabDoc,
  type ProjectFile,
  type SceneDoc,
  type SceneEntry,
} from '@three-studio/core';
import {
  AssetError,
  companionsOf,
  readMaterialAssets,
  readPrefabAssets,
  scanAssets,
} from './assets';
import { resolveInside } from './paths';
import { readProject } from './project';
import { buildScripts } from './scripts';

/*
 * `ExportProgress` and `ExportResult` come from core rather than being declared
 * again here. The same pair was declared twice for `ScriptBuildResult` earlier
 * and drifted the moment one side gained a field.
 */

/**
 * Writes a self-contained web build from a build profile.
 *
 * The player itself is prebuilt (`apps/web-template`), so exporting copies it
 * and adds what the profile asks for: the scenes, the assets they reference,
 * the materials they link to, and the compiled scripts. No bundler runs here —
 * an export should not depend on a toolchain being installed next to the app.
 */
export async function exportBuild(
  projectPath: string,
  profile: BuildProfile,
  outputDir: string,
  /**
   * Where to look for the prebuilt player. Passed in rather than read from
   * `app`, so this module stays free of electron and can be tested as the file
   * operation it is.
   */
  searchRoots: readonly string[] = [],
  onProgress: (progress: ExportProgress) => void = () => {},
): Promise<ExportResult> {
  const report = (fraction: number, step: string) => onProgress({ fraction, step });
  report(0, 'Locating the player');
  // Read, not assumed. Adding a target to the union without a branch here is
  // a compile error rather than a profile that silently produces a web build.
  switch (profile.target) {
    case 'web':
      break;
    default: {
      const unreachable: never = profile.target;
      throw new AssetError(`No exporter for target "${String(unreachable)}".`);
    }
  }

  const template = await findTemplate(searchRoots);
  const warnings: string[] = [];

  report(0.05, 'Reading the project');
  const project = await readProject(projectPath);
  // An empty list means the start scene, so a project that never opened the
  // build settings still exports something sensible. Ids, as everything that
  // refers to a scene is — see ADR-15.
  const sceneIds = profile.scenes.length > 0 ? profile.scenes : [project.startScene];

  const scenes: { entry: SceneEntry; scene: SceneDoc }[] = [];
  for (const id of sceneIds) {
    const entry = findScene(project, id);
    if (!entry) throw new AssetError(`This profile ships a scene the project no longer has.`);
    try {
      scenes.push({
        entry,
        scene: deserializeScene(await readFile(resolveInside(projectPath, entry.path), 'utf8')),
      });
    } catch (cause) {
      throw new AssetError(`Scene "${entry.name}" could not be read: ${describe(cause)}`);
    }
  }

  report(0.15, 'Scanning assets');
  const manifest = await scanAssets(projectPath);
  // Off that manifest rather than each scanning for itself. Three concurrent
  // walks of `assets/` was already two too many, and since a scan writes the
  // sidecars it finds missing or out of date, they also raced: a reader
  // catching a half-written one adopts the asset under a fresh id, and the
  // export ships a scene pointing at an id no longer on disk.
  const [materials, prefabs] = await Promise.all([
    readMaterialAssets(projectPath, manifest),
    readPrefabAssets(projectPath, manifest),
  ]);
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));

  report(0.25, 'Copying the player');
  await mkdir(outputDir, { recursive: true });
  await cp(template, outputDir, { recursive: true });

  // --- assets ---------------------------------------------------------------
  // Unreal's "cook everything in the project" against cooking only what is
  // reached: scripts can load an asset by name, which no static walk can see.
  const referenced = profile.includeAllAssets
    ? new Set(manifest.assets.map((asset) => asset.id))
    : union(scenes.map(({ scene }) => new Set(collectSceneAssets(scene, materials, prefabs))));

  const paths: Record<string, string> = {};
  /**
   * Only the images whose file name does not already say what they are.
   *
   * Which today means Ultra HDR and nothing else: it is a `.jpg`, so the player
   * would send it through the ordinary image path and quietly lose every stop
   * of range above white — a sky that casts no light rather than a visible
   * failure. Radiance and OpenEXR are named by their extension and are not
   * listed, so this map is empty for almost every build.
   */
  const textureEncodings: Record<string, TextureEncoding> = {};
  /**
   * What the author chose at import, for every asset that ships.
   *
   * The player has no sidecars — they stay in the project — so without this a
   * model that is 2746 units in the file would be 2746 units in the build,
   * while the editor showed it at the scale it was imported at. A build that
   * does not look like the editor is the one bug an export must not have.
   */
  const assetSettings: Record<string, AssetSettings> = {};
  let assetCount = 0;
  let copied = 0;

  for (const id of referenced) {
    // Reported per file: on a project with a few hundred textures this is the
    // part that takes the time, and a bar that sits still reads as a hang.
    report(0.3 + 0.5 * (copied++ / Math.max(referenced.size, 1)), 'Copying assets');
    const entry = byId.get(id);
    if (!entry) {
      warnings.push(`Asset ${id} is referenced by a scene but is not in the project.`);
      continue;
    }
    // Scripts ship compiled, not as source: the build has no TypeScript in it.
    if (entry.kind === 'script') continue;

    const relativeToAssets = toPosix(relative(ASSETS_DIR, entry.path));
    const destination = join(outputDir, 'assets', ...relativeToAssets.split(posix.sep));
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolveInside(projectPath, entry.path), destination);
    paths[id] = relativeToAssets;
    if (entry.settings.kind === 'texture' && entry.settings.encoding === 'ultrahdr') {
      textureEncodings[id] = entry.settings.encoding;
    }
    assetSettings[id] = entry.settings;
    assetCount += 1;

    // A `.gltf` names its buffer and its images in the file, not by asset id,
    // so nothing in `referenced` accounts for them — the build would ship a
    // model with no geometry. Same for an `.obj` and its `.mtl`.
    const source = resolveInside(projectPath, entry.path);
    for (const companion of await companionsOf(source)) {
      const target = join(dirname(destination), ...companion.split('/'));
      try {
        await mkdir(dirname(target), { recursive: true });
        await cp(join(dirname(source), companion), target);
      } catch {
        warnings.push(`${entry.name} refers to ${companion}, which is not in the project.`);
      }
    }
  }

  // --- documents ------------------------------------------------------------
  // The first scene is the entry point, as in Unity's Scenes In Build. The
  // others ship beside it for a script to load later.
  const sceneFiles: string[] = [];
  // Names as scripts use them, mapped to where the file actually landed. The
  // entry scene is renamed to `scene.json`, so a path from the project would
  // not resolve here — the name is what survives the move.
  const sceneMap: Record<string, string> = {};
  for (const [index, { scene, entry }] of scenes.entries()) {
    const file = index === 0 ? 'scene.json' : `scenes/${sceneFileName(entry.path)}`;
    await mkdir(dirname(join(outputDir, file)), { recursive: true });
    await writeFile(join(outputDir, file), serializeScene(scene), 'utf8');
    sceneFiles.push(file);
    // Keyed by name *and* by id: a script may hold either, and a build that
    // only understood one would make the other silently fail to load.
    sceneMap[entry.name] = file;
    sceneMap[entry.id] = file;
  }

  await writeFile(join(outputDir, 'assets.json'), JSON.stringify(paths, null, 2), 'utf8');
  await writeFile(
    join(outputDir, 'materials.json'),
    // Only the ones a scene links to; an unused material asset is not part of
    // the build any more than an unused texture is.
    JSON.stringify(pick(materials, referenced), null, 2),
    'utf8',
  );
  await writeFile(
    join(outputDir, 'prefabs.json'),
    JSON.stringify(pick(prefabs, referenced), null, 2),
    'utf8',
  );
  // --- scripts --------------------------------------------------------------
  report(0.85, 'Compiling scripts');
  const scripts = await buildScripts(projectPath);
  if (scripts.errors.length > 0) {
    throw new AssetError(`Scripts did not compile:\n${scripts.errors.join('\n')}`);
  }
  const scriptFile = scripts.scriptCount > 0 ? 'scripts.mjs' : null;
  if (scriptFile) await writeFile(join(outputDir, scriptFile), scripts.code, 'utf8');

  await writeFile(
    join(outputDir, 'build.json'),
    JSON.stringify(
      {
        // Read by the player before anything else; see `BUILD_FORMAT_VERSION`.
        formatVersion: BUILD_FORMAT_VERSION,
        title: profile.title,
        // From the project's rendering settings, not a copy on the profile.
        // Two places holding the same flag is how they end up disagreeing.
        forceWebGL: project.settings.rendering.forceWebGL,
        scenes: sceneFiles,
        /** Scene name → file, so a script can name a scene and be portable. */
        sceneMap,
        /**
         * Shown while another scene loads; a scene like any other. Resolved to
         * a name here because that is what `sceneMap` is keyed by for a human
         * to read — the id resolves too, but the file is meant to be readable.
         */
        loadingScene: loadingSceneName(project),
        /** See `textureEncodings` above; absent when nothing needed it. */
        textureEncodings,
        /** See `assetSettings` above. Kept beside `textureEncodings`, which it
         * subsumes but does not replace: a player from before this field still
         * reads that one, and dropping it would break those builds. */
        assetSettings,
        // Named here rather than probed for. A static server that answers 404s
        // with its index page — which many do — returns 200 and HTML for a file
        // that is not there, so asking the server whether the bundle exists is
        // not a question that can be answered reliably.
        scripts: scriptFile,
      },
      null,
      2,
    ),
    'utf8',
  );

  report(1, 'Done');
  return {
    outputDir,
    sceneCount: scenes.length,
    assetCount,
    scriptCount: scripts.scriptCount,
    warnings,
  };
}

function union(sets: readonly Set<string>[]): Set<string> {
  const all = new Set<string>();
  for (const set of sets) for (const id of set) all.add(id);
  return all;
}

/** The loading scene's name, or `null` when the project has none. */
function loadingSceneName(project: ProjectFile): string | null {
  const id = project.settings.loadingScene;
  return id === null ? null : (findScene(project, id)?.name ?? null);
}

/** `scenes/main.scene.json` -> `main.scene.json`; the build has one flat level. */
function sceneFileName(path: string): string {
  return path.split('/').pop() ?? 'scene.json';
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Every asset the scene needs, following materials to the textures they use. */

function pick<T>(source: Readonly<Record<string, T>>, ids: ReadonlySet<string>): Record<string, T> {
  const picked: Record<string, T> = {};
  for (const id of ids) {
    const value = source[id];
    if (value) picked[id] = value;
  }
  return picked;
}

/**
 * Locates the prebuilt player.
 *
 * Packaged it sits in the app's resources; in development it is the workspace
 * build, found by walking up from the app path so the answer does not depend on
 * which directory the dev server was started from.
 */
async function findTemplate(searchRoots: readonly string[]): Promise<string> {
  const candidates = searchRoots.flatMap((root) => [
    join(root, 'web-template'),
    ...ancestors(root).map((dir) => join(dir, 'apps', 'web-template', 'dist')),
  ]);

  for (const candidate of candidates) {
    try {
      const entries = await readdir(candidate);
      if (entries.includes('index.html')) return candidate;
    } catch {
      // Not here; try the next one.
    }
  }

  throw new AssetError(
    'The web player has not been built. Run `npm run build --workspace @three-studio/web-template`.',
  );
}

function ancestors(from: string): string[] {
  const list: string[] = [];
  let current = resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    list.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return list;
}

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}
