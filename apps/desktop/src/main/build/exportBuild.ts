import { readFile, readdir } from 'node:fs/promises';
import {
  collectSceneAssets,
  findScene,
  basePathProblem,
  deserializeScene,
  normalizeBasePath,
  type AssetEntry,
  type BuildProfile,
  type BuildProfiles,
  type ExportProgress,
  type ExportResult,
  type SceneDoc,
  type SceneEntry,
} from '@three-studio/core';
import { AssetError } from '../assetFiles';
import { readMaterialAssets, readPrefabAssets } from '../assetLibraries';
import { scanAssets } from '../assetScan';
import { resolveInside } from '../paths';
import { findTemplate } from '../prebuilt';
import { discoverScenes, readProject } from '../project';
import { sizeOf } from './buildFiles';
import { BuildPlan } from './buildPlan';
import { assembleManifest } from './manifest';
import { EXPORT_ROOTS, claimOutputFolder } from './outputFolder';
import { planAssets } from './steps/assets';
import { planPlayer } from './steps/player';
import { planScenes } from './steps/scenes';
import { planScripts } from './steps/scripts';
import { writeBuild } from './writeBuild';

/*
 * `ExportProgress` and `ExportResult` come from core rather than being declared
 * again here. The same pair was declared twice for `ScriptBuildResult` earlier
 * and drifted the moment one side gained a field.
 */

/**
 * The profile an export will run, and the folder it will write into.
 *
 * The active one, and only the active one. The caller used to be able to name
 * a different profile, and nothing has passed that argument since the Package
 * dialog started saving `active` before asking for the export — which it does
 * because a build has to be reproducible from what is on disk. An override
 * would be the dialog's copy of the choice quietly beating the file's.
 *
 * Both refusals are the ones a person can act on: an `active` no profile
 * answers to is a stale project file or a profile someone deleted in another
 * window, and a profile with no output folder is the ordinary state of a new
 * one — the message names the panel where it is chosen.
 *
 * Here rather than in the IPC handler that used to hold it, because the whole
 * of it is a decision about `BuildProfiles` and nothing about Electron. See the
 * note on `searchRoots` below: this module has kept out of electron's way from
 * the start, and this is the same argument one step earlier.
 */
export function requireBuildProfile(
  settings: BuildProfiles,
): { profile: BuildProfile; outputDir: string } {
  const id = settings.active;
  const profile = settings.profiles[id];
  if (!profile) throw new Error(`No build profile "${id}".`);

  const outputDir = profile.outputDir;
  if (!outputDir) {
    throw new Error(`"${profile.name}" has no output folder. Choose one in Package.`);
  }
  return { profile, outputDir };
}

/**
 * Writes a self-contained web build from a build profile.
 *
 * The player itself is prebuilt (`apps/web-template`), so exporting copies it
 * and adds what the profile asks for: the scenes, the assets they reference,
 * the materials they link to, and the compiled scripts. No bundler runs here —
 * an export should not depend on a toolchain being installed next to the app.
 *
 * **Planned, then written.** Every file is decided, read and hashed first, and
 * nothing in the output folder changes until all of it has worked: a script
 * that does not compile, a scene that cannot be read or a name a build cannot
 * hold is found while the folder still holds the previous build, whole.
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
  const roots = [...(await readdir(template)), ...EXPORT_ROOTS];

  // Before anything is read or written, and after the two refusals above that
  // need no folder at all: a folder the export must not touch is the author's
  // to fix, and finding out once the copy has started is too late.
  const release = await claimOutputFolder(outputDir, projectPath, roots);
  try {
    const plan = new BuildPlan(new Set(roots));
    const planned = await planExport(plan, projectPath, profile, template, base, report);

    report(0.8, 'Writing the build');
    await writeBuild(plan, outputDir, roots, (fraction) =>
      report(0.8 + 0.2 * fraction, 'Writing the build'),
    );

    report(1, 'Done');
    return {
      outputDir,
      ...planned,
      // Off the plan rather than counted along the way: the sizes are already
      // there, and a second tally is a second thing to keep in step.
      size: sizeOf(plan.files()),
    };
  } finally {
    release();
  }
}

/** Everything the export decides, read and hashed, with nothing written. */
async function planExport(
  plan: BuildPlan,
  projectPath: string,
  profile: BuildProfile,
  template: string,
  base: string,
  report: (fraction: number, step: string) => void,
): Promise<Omit<ExportResult, 'outputDir' | 'size'>> {
  const warnings: string[] = [];

  report(0.05, 'Reading the project');
  const project = await readProject(projectPath);
  const known = await discoverScenes(projectPath);
  // An empty list means the start scene, so a project that never opened the
  // build settings still exports something sensible. Ids, as everything that
  // refers to a scene is.
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

  report(0.2, 'Reading the player');
  await planPlayer(plan, template, base);
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

  // Unreal's "cook everything in the project" against cooking only what is
  // reached: scripts can load an asset by name, which no static walk can see.
  // Sorted, so the plan and the manifest come out the same on every machine.
  const referenced = [
    ...(profile.includeAllAssets
      ? new Set(manifest.assets.map((asset) => asset.id))
      : union(scenes.map(({ scene }) => collectSceneAssets(scene, materials, prefabs)))),
  ].sort();

  const shippable: AssetEntry[] = [];
  for (const id of referenced) {
    const entry = byId.get(id);
    if (!entry) {
      warnings.push(`Asset ${id} is referenced by a scene but is not in the project.`);
      continue;
    }
    // Scripts ship compiled, not as source: the build has no TypeScript in it.
    if (entry.kind !== 'script') shippable.push(entry);
  }
  const assets = await planAssets(plan, projectPath, shippable, (done, total) =>
    report(0.25 + 0.4 * (done / Math.max(total, 1)), 'Reading assets'),
  );
  warnings.push(...assets.warnings);

  planScenes(plan, scenes);

  report(0.7, 'Compiling scripts');
  const scripts = await planScripts(plan, projectPath);

  /*
   * One file, and the only one the player reads before it knows anything.
   *
   * The asset table, the materials and the prefabs used to be three files
   * beside this one — three more round trips before the first frame, for
   * documents that are small and always needed. See format 4.
   */
  const build = assembleManifest({
    title: profile.title,
    rendering: project.settings.rendering,
    physics: project.settings.physics,
    scenes: scenes.map(({ entry }) => entry),
    loadingScene: project.settings.loadingScene,
    assets: assets.shipped,
    // Only what a shipped scene links to. An unused material or prefab asset is
    // no more part of the build than an unused texture is.
    materials: pick(materials, referenced),
    prefabs: pick(prefabs, referenced),
    scripts: scripts.file,
  });
  plan.addBytes('build.json', JSON.stringify(build, null, 2), { kind: 'manifest' });

  return {
    sceneCount: scenes.length,
    assetCount: assets.shipped.length,
    scriptCount: scripts.count,
    warnings,
  };
}

function union(lists: readonly (readonly string[])[]): Set<string> {
  const all = new Set<string>();
  for (const list of lists) for (const id of list) all.add(id);
  return all;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The entries of `source` named in `ids`.
 *
 * Own keys only, and defined rather than assigned: an id is read off a sidecar,
 * and one spelled `__proto__` would otherwise become the object's prototype.
 */
function pick<T>(source: Readonly<Record<string, T>>, ids: readonly string[]): Record<string, T> {
  return Object.fromEntries(
    ids.filter((id) => Object.hasOwn(source, id)).map((id) => [id, source[id]!]),
  );
}
