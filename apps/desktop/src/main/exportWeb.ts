import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import {
  ASSETS_DIR,
  collectSceneAssets,
  type TextureEncoding,
  findScene,
  BUILD_FORMAT_VERSION,
  type AssetSettings,
  type BuildManifest,
  basePathProblem,
  buildScenePath,
  deserializeScene,
  normalizeBasePath,
  serializeScene,
  type BuildProfile,
  type ComponentDoc,
  type ExportProgress,
  type ExportResult,
  type MaterialDef,
  type PrefabDoc,
  type SceneDoc,
  type SceneEntry,
} from '@three-studio/core';
import {
  AssetError,
  companionsOf,
  hashFile,
  readMaterialAssets,
  readPrefabAssets,
  scanAssets,
} from './assets';
import { resolveInside } from './paths';
import { discoverScenes, readProject } from './project';
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

  // Before anything is written: a base that cannot be expressed is a typo in
  // the profile, and finding out after the assets have been copied costs the
  // author a whole export to learn one line.
  const problem = basePathProblem(profile.basePath ?? '');
  if (problem) throw new AssetError(problem);
  const base = normalizeBasePath(profile.basePath ?? '');

  const template = await findTemplate(searchRoots);
  const warnings: string[] = [];

  report(0.05, 'Reading the project');
  const project = await readProject(projectPath);
  const known = await discoverScenes(projectPath);
  // An empty list means the start scene, so a project that never opened the
  // build settings still exports something sensible. Ids, as everything that
  // refers to a scene is — see ADR-15.
  const sceneIds = profile.scenes.length > 0 ? profile.scenes : [project.startScene];

  const scenes: { entry: SceneEntry; scene: SceneDoc }[] = [];
  for (const id of sceneIds) {
    const entry = findScene(known, id);
    if (!entry) {
      // A warning, not a refusal. A profile is written once and the scenes it
      // names live in the Finder, where one can be deleted or moved out months
      // later; refusing the whole export for that means the author cannot ship
      // the eleven levels that are still there. Loud, and it does not stop the
      // build — the same trade the missing-asset warning below already makes.
      warnings.push(`This profile ships a scene the project no longer has (${id}).`);
      continue;
    }
    try {
      scenes.push({
        entry,
        scene: deserializeScene(await readFile(resolveInside(projectPath, entry.path), 'utf8')),
      });
    } catch (cause) {
      throw new AssetError(`Scene "${entry.name}" could not be read: ${describe(cause)}`);
    }
  }
  // None of them resolved, which is not a build. The player loads the first
  // scene in the manifest before anything else, and a manifest naming none is a
  // black page rather than a message.
  if (scenes.length === 0) {
    throw new AssetError('This profile ships no scene this project still has.');
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
  // The copy is what makes the base removable: `index.html` is overwritten with
  // the pristine template on every export, so re-exporting a folder with an
  // empty base leaves no tag behind from the last one.
  await cp(template, outputDir, { recursive: true });
  if (base !== '') {
    await applyBase(join(outputDir, 'index.html'), base);
    // Any absolute base, `//host/` included. The exporter does not know which
    // origin the page will be served from, so it cannot tell whether this is a
    // different one — hence a conditional sentence rather than a verdict.
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(base)) {
      warnings.push(
        `This build is based at ${base}. If the page is served from a different origin, that ` +
          `server has to send Access-Control-Allow-Origin for build.json, the scenes, assets/ ` +
          `and scripts.mjs — without it the page loads and stays black.`,
      );
    }
  }

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

  /*
   * Emptied first, because the names below are content addresses.
   *
   * An unhashed copy overwrote its predecessor; a hashed one lands beside it,
   * so a folder re-exported through twenty rounds of tweaking one texture would
   * carry twenty copies of it — and the author uploads the folder. Only
   * `assets/`, which the exporter alone creates and fills: emptying the whole
   * output directory would take whatever else has been put there, and the
   * player's own files are overwritten by the copy above anyway.
   */
  await rm(join(outputDir, 'assets'), { recursive: true, force: true });

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

    /*
     * Named by its content, so a re-export is never served from a stale cache.
     *
     * The player bundle has been hashed by Vite since the first build; the
     * project's own files kept their names, so a site somebody had already
     * visited went on showing the texture they had already downloaded. A
     * production bug, and a silent one — the build was right and the browser
     * was serving something else.
     *
     * Hashed **here**, from the bytes, and deliberately not from
     * `entry.hash`: that one is the digest taken at import and refreshed only
     * when the editor itself rewrites a material or a prefab. A texture edited
     * in Photoshop keeps its sidecar hash for ever, which is exactly the case
     * this is for. It costs one extra read per asset, once per export.
     *
     * Free in every other sense, because the indirection was already there: the
     * player never sees a file name, it reads `assets` in the manifest.
     */
    const source = resolveInside(projectPath, entry.path);
    const relativeToAssets = hashedName(toPosix(relative(ASSETS_DIR, entry.path)), await hashFile(source));
    const destination = join(outputDir, 'assets', ...relativeToAssets.split(posix.sep));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
    paths[id] = relativeToAssets;
    if (entry.settings.kind === 'texture' && entry.settings.encoding === 'ultrahdr') {
      textureEncodings[id] = entry.settings.encoding;
    }
    assetSettings[id] = entry.settings;
    assetCount += 1;

    /*
     * A `.gltf` names its buffer and its images in the file, not by asset id,
     * so nothing in `referenced` accounts for them — the build would ship a
     * model with no geometry. Same for an `.obj` and its `.mtl`.
     *
     * Copied under their own names, and that is the point: the names are
     * written inside the model, relative to it, and the model has not moved —
     * only its own file name carries the hash. Hashing a companion would break
     * the reference that names it, and the only way to hash one is to rewrite
     * the model that points at it.
     */
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

  // --- scenes ---------------------------------------------------------------
  /*
   * One shape for all of them: `scenes/<id>.json`, entry point first — as in
   * Unity's Scenes In Build, where the first is where the game starts and the
   * rest ship for a script to load later.
   *
   * The entry scene used to be renamed to `scene.json` at the root while the
   * others went under `scenes/`, and that one asymmetry paid for three
   * functions: a map from every scene's name *and* id to the file it became, a
   * resolution of the loading scene's id back into a name, and a flattener for
   * the project's own paths. A build is not a thing to hand-edit, so the id
   * wins and the path is derived from it.
   */
  const shipped: string[] = [];
  // An alias, not an address: a script may name a level, and the name is what
  // an author reads in the editor. Nothing is found by it — see `sceneNames`.
  const sceneNames: Record<string, string> = {};
  for (const { scene, entry } of scenes) {
    const file = buildScenePath(entry.id);
    // A scene file carrying no id of its own is addressed by its project path,
    // so an id can contain slashes. Rare, and cheaper to make directories for
    // than to special-case.
    await mkdir(dirname(join(outputDir, file)), { recursive: true });
    await writeFile(join(outputDir, file), serializeScene(scene), 'utf8');
    shipped.push(entry.id);
    sceneNames[entry.name] = entry.id;
  }

  // --- scripts --------------------------------------------------------------
  report(0.85, 'Compiling scripts');
  const scripts = await buildScripts(projectPath);
  if (scripts.errors.length > 0) {
    throw new AssetError(`Scripts did not compile:\n${scripts.errors.join('\n')}`);
  }
  const scriptFile = scripts.scriptCount > 0 ? 'scripts.mjs' : null;
  if (scriptFile) await writeFile(join(outputDir, scriptFile), scripts.code, 'utf8');

  // --- the manifest ---------------------------------------------------------
  /*
   * One file, and the only one the player reads before it knows anything.
   *
   * Typed rather than written as a bare literal, and the type lives in core:
   * the reader is a browser and the writer is the main process, so nothing but
   * a shared declaration can keep them in step. What each field means is on
   * `BuildManifest`; what is decided *here* is below.
   *
   * The asset table, the materials and the prefabs used to be three files
   * beside this one — three more round trips before the first frame, for
   * documents that are small and always needed. See format 4.
   */
  const build: BuildManifest = {
    formatVersion: BUILD_FORMAT_VERSION,
    title: profile.title,
    // Kept beside `rendering`, which subsumes it: a build written before that
    // field carries only this one, and a player from then still falls back to
    // it. Persisted data gains fields; it does not lose them.
    forceWebGL: project.settings.rendering.forceWebGL,
    rendering: project.settings.rendering,
    scenes: shipped,
    sceneNames,
    // The id the project already holds, passed through. An id naming a scene
    // this profile does not ship reaches the player as a loading scene it
    // cannot read, which it says out loud — where dropping it here was silent.
    loadingScene: project.settings.loadingScene,
    assets: paths,
    // Only what a shipped scene links to. An unused material or prefab asset is
    // no more part of the build than an unused texture is.
    materials: pick(materials, referenced),
    prefabs: pick(prefabs, referenced),
    textureEncodings,
    assetSettings,
    scripts: scriptFile,
  };
  await writeFile(join(outputDir, 'build.json'), JSON.stringify(build, null, 2), 'utf8');

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

/**
 * `textures/brick.png` and a digest -> `textures/brick.a1b2c3d4.png`.
 *
 * Eight hex characters, as Vite uses for the same job: thirty-two bits, so a
 * collision inside one build is not a thing that happens, and short enough that
 * the name still reads as the file it came from when someone opens the folder.
 *
 * The last dot only, so `Brick.material.json` becomes `Brick.material.<h>.json`
 * and still reads as a material. A leading dot is a whole name — `.gitkeep` is
 * not an extension — which is what `dot <= 0` says.
 */
function hashedName(path: string, hash: string): string {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot <= 0 ? file : file.slice(0, dot);
  const extension = dot <= 0 ? '' : file.slice(dot);
  return `${directory}${stem}.${hash.slice(0, 8)}${extension}`;
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
 * Points the copied page at the URL the build will be served from.
 *
 * One `<base>` rather than a rewrite of every URL: the page, the player bundle,
 * the JSON documents beside it, every asset and the script bundle are all
 * resolved against the document, so a single tag moves them together and cannot
 * fall out of step with a path added later. It goes first in `<head>`, because
 * it only governs the URLs that come after it.
 */
async function applyBase(indexPath: string, base: string): Promise<void> {
  const html = await readFile(indexPath, 'utf8');
  if (!/<head[^>]*>/i.test(html)) {
    throw new AssetError('The web player page has no <head>, so it cannot be given a base URL.');
  }
  // A replacer function, not a replacement string: `String.replace` reads `$&`,
  // "$`", `$1` and friends out of a string, so a base carrying `$1` would be
  // written back with a captured group in place of itself.
  const tag = `<base href="${escapeAttribute(base)}" />`;
  const tagged = html.replace(
    /<head([^>]*)>/i,
    (_match, attributes: string) => `<head${attributes}>\n    ${tag}`,
  );
  await writeFile(indexPath, tagged, 'utf8');
}

/**
 * Second net behind `basePathProblem`, which already refuses the characters
 * that would need it. Kept because the value lands in markup either way, and a
 * validator and an emitter that trust each other are how injections happen.
 */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
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
