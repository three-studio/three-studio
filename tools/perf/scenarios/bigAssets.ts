import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeScene, unwrap, entitiesWith, isRecord, type EntityId } from '@three-studio/core';
import { scanAssets } from '../../../apps/desktop/src/main/assetScan';
import { exportBuild } from '../../../apps/desktop/src/main/build/exportBuild';
import { openProject, readProject } from '../../../apps/desktop/src/main/project';
import { writeGeometryProject, writeTexturesProject } from '../generate/projects';
import { builtInRegistries } from '../registries';
import {
  type CdpSession,
  decodeNumberList,
  decodeNumbers,
  entityIdAt,
  freePort,
  runInPage,
  stringAt,
  stringsAt,
} from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import { serveFolder } from '../launch/serve';
import {
  deleteEntity,
  firstFrameWithModel,
  pressPlay,
  pressStop,
  rendererCounts,
  windowShape,
} from '../page/editor';
import { animationFrames, waitFrames } from '../page/frames';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { longestInside } from '../report/stats';
import { type ScenarioContext, finished, prepared } from './context';
import {
  MISSED_START,
  captureView,
  checkExit,
  folderBytes,
  heapReading,
  measureBuild,
  oneWindow,
  readTwiceAtMost,
  warmFiles,
} from './readings';

/*
 * S1 — Big assets: a 331 MB model loaded as written, and a model of 24
 * 4096² images capped at 2 048, each in the edit view, in Play, after its
 * entity is deleted, and in an exported build.
 *
 * One recipe at a time, its project and export removed before the next is
 * written, so the disk's peak is the big model beside its exported copy.
 * Displayed launches, as shipped: what is measured is loading, not frames.
 */

interface Recipe {
  readonly name: 'geometry' | 'textures';
  readonly write: (parent: string) => Promise<string>;
}

const RECIPES: readonly Recipe[] = [
  { name: 'geometry', write: (parent) => writeGeometryProject(parent) },
  { name: 'textures', write: (parent) => writeTexturesProject(parent) },
];

/**
 * Timings shown and not judged: on one commit against itself their medians
 * fell apart by more than half the budget. The big model's Play lands near
 * 1 150 ms or near 1 300 ms, its longest task near 560 or 690 ms, launch after
 * launch on the same code, with the system swapping (6.5 % and 15.6 % apart);
 * the textures build's first frame, 3.1 %.
 */
const UNJUDGED: ReadonlySet<string> = new Set([
  'geometry.play.firstFrameMs',
  'geometry.play.longestTaskMs',
  'textures.build.firstFrameMs',
]);

function recipeMetrics(name: string): [string, MetricSpec][] {
  const memory = (at: string): [string, MetricSpec][] => [
    [`${name}.${at}.heapBytes`, { kind: 'memory', unit: 'B' }],
    [`${name}.${at}.heapUsedBytes`, { kind: 'reported', unit: 'B' }],
    [`${name}.${at}.heapBackingBytes`, { kind: 'reported', unit: 'B' }],
    [`${name}.${at}.gpuBytes`, { kind: 'memory', unit: 'B' }],
  ];
  const timing = (metric: string): [string, MetricSpec] => [
    metric,
    { kind: UNJUDGED.has(metric) ? 'reported' : 'timing', unit: 'ms' },
  ];
  const timings = (at: string): [string, MetricSpec][] => [
    timing(`${name}.${at}.firstFrameMs`),
    timing(`${name}.${at}.longestTaskMs`),
  ];
  return [
    ...timings('edit'),
    ...memory('edit'),
    [`${name}.edit.textures`, { kind: 'count', unit: '' }],
    [`${name}.edit.geometries`, { kind: 'count', unit: '' }],
    [`${name}.edit.programs`, { kind: 'count', unit: '' }],
    ...timings('play'),
    ...memory('play'),
    ...memory('deleted'),
    ...timings('build'),
    ...memory('build'),
  ];
}

const METRICS: ReadonlyMap<string, MetricSpec> = new Map(RECIPES.flatMap((recipe) => recipeMetrics(recipe.name)));

/** The entity holding the model, read from the start scene with the app's own code. */
async function modelEntityOf(projectPath: string): Promise<EntityId> {
  const scene = unwrap(decodeScene(builtInRegistries(), (await openProject(projectPath)).sceneJson), projectPath);
  const [entityId] = entitiesWith(scene, 'model');
  if (entityId === undefined) throw new Error('the scene holds no model');
  return entityId;
}

async function memoryOf(session: CdpSession, prefix: string): Promise<Record<string, number>> {
  const heap = await heapReading(session);
  const counts = decodeNumbers(await runInPage(session, rendererCounts, undefined));
  return {
    [`${prefix}.heapBytes`]: heap.heapBytes,
    [`${prefix}.heapUsedBytes`]: heap.heapUsedBytes,
    [`${prefix}.heapBackingBytes`]: heap.heapBackingBytes,
    [`${prefix}.gpuBytes`]: counts['gpuBytes'] ?? Number.NaN,
  };
}

/**
 * One editor launch: the model's first frame, Play's, and what deleting the
 * model leaves behind. A launch whose driver arrived after the model was drawn
 * is refused and made again, once: its first frame cannot be read.
 */
async function measureEditor(
  context: ScenarioContext,
  recipe: Recipe,
  project: string,
  entityId: EntityId,
  label: string,
): Promise<{ metrics: Record<string, number>; window: Record<string, number> }> {
  return readTwiceAtMost(label, async (attempt) => {
    const editor = await launchEditor({
      repo: context.repo,
      runDir: context.runDir,
      project,
      mode: 'display',
      label: attempt === 1 ? label : `${label}-again`,
      port: await freePort(),
    });
    try {
      const shown = decodeNumbers(await runInPage(editor.session, firstFrameWithModel, entityId, 600_000));
      if (shown['late'] === 1) {
        editor.kill();
        context.say(`${label}: the model was drawn before the driver arrived`);
        return MISSED_START;
      }
      const edit = `${recipe.name}.edit`;
      const firstFrameMs = shown['firstFrameAt'] ?? Number.NaN;
      const frames = decodeNumberList(await runInPage(editor.session, animationFrames, undefined));
      const counts = decodeNumbers(await runInPage(editor.session, rendererCounts, undefined));
      const window = decodeNumbers(await runInPage(editor.session, windowShape, undefined));
      const metrics: Record<string, number> = {
        [`${edit}.firstFrameMs`]: firstFrameMs,
        [`${edit}.longestTaskMs`]: longestInside(frames, { from: 0, to: firstFrameMs }).longestMs,
        [`${edit}.textures`]: counts['textures'] ?? Number.NaN,
        [`${edit}.geometries`]: counts['geometries'] ?? Number.NaN,
        [`${edit}.programs`]: counts['programs'] ?? Number.NaN,
        ...(await memoryOf(editor.session, edit)),
      };
      if (context.shots !== null) await captureView(editor.session, 'edit', 'display', join(context.shots, `${label}-edit.png`));

      // Play builds its own model cache and parses the file again, while the
      // edit view's copy stays held.
      const play = decodeNumbers(await runInPage(editor.session, pressPlay, undefined, 600_000));
      const pressedAt = play['pressedAt'] ?? Number.NaN;
      const playFrames = decodeNumberList(await runInPage(editor.session, animationFrames, undefined));
      metrics[`${recipe.name}.play.firstFrameMs`] = play['gameShownMs'] ?? Number.NaN;
      metrics[`${recipe.name}.play.longestTaskMs`] = longestInside(playFrames, {
        from: pressedAt,
        to: pressedAt + (play['gameShownMs'] ?? Number.NaN),
      }).longestMs;
      Object.assign(metrics, await memoryOf(editor.session, `${recipe.name}.play`));
      if (context.shots !== null) await captureView(editor.session, 'game', 'display', join(context.shots, `${label}-play.png`));
      await runInPage(editor.session, pressStop, undefined);

      // What deleting the model gives back, and what it leaves.
      await runInPage(editor.session, deleteEntity, entityId);
      await runInPage(editor.session, waitFrames, 60);
      Object.assign(metrics, await memoryOf(editor.session, `${recipe.name}.deleted`));

      const exit = await editor.finish();
      checkExit(label, 'display', exit);
      context.say(
        `${label}: first frame ${firstFrameMs.toFixed(0)} ms, Play ${metrics[`${recipe.name}.play.firstFrameMs`]?.toFixed(0)} ms`,
      );
      return { metrics, window };
    } catch (error) {
      editor.kill();
      throw error;
    }
  });
}

/** Every `.glb` under a folder, with its size: what an export ships of the models. */
async function modelFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.glb')) {
      const path = join(entry.parentPath, entry.name);
      found.push(`${(await stat(path)).size} B`);
    }
  }
  return found;
}

interface RecipeSubject {
  readonly project: string;
  readonly entityId: EntityId;
  /** The exported build. */
  readonly out: string;
  /** What was read while preparing: the file the model loads from, what the export ships, the disk's peak. */
  readonly notes: readonly string[];
}

function decodeSubject(value: unknown): RecipeSubject {
  if (!isRecord(value)) throw new Error('not a subject');
  return {
    project: stringAt(value, 'project'),
    entityId: entityIdAt(value, 'entityId'),
    out: stringAt(value, 'out'),
    notes: stringsAt(value, 'notes'),
  };
}

/**
 * A model written, opened once to warm the caches, and exported. The warm-up
 * also builds `textures`' capped copy, which only the editor's own scan can
 * make (in Node it cannot scale an embedded image): the export ships what it
 * finds.
 */
async function prepareRecipe(context: ScenarioContext, recipe: Recipe, folder: string): Promise<RecipeSubject> {
  const project = await recipe.write(folder);
  const entityId = await modelEntityOf(project);
  await measureEditor(context, recipe, project, entityId, `S1-${recipe.name}-warmup`);
  const model = (await scanAssets(builtInRegistries(), project)).assets.find((asset) => asset.kind === 'model');
  const { build } = (await readProject(project)).settings;
  const profile = build.profiles[build.active];
  if (!profile) throw new Error(`the ${recipe.name} project has no active build profile`);
  const out = join(folder, 'export');
  await exportBuild(builtInRegistries(), project, profile, out, [context.repo]);
  // Read where the disk is fullest: the model, its copy if it has one, the
  // export beside them, and the harness's application data. The run's own
  // folder, not the volume's free space: with the system swapping, that moved
  // by gigabytes the run did not write.
  const peakBytes = await folderBytes(context.runDir);
  return {
    project,
    entityId,
    out,
    notes: [
      `${recipe.name}: loaded from ${model?.importedPath ?? 'its source'}, ${model?.sizeBytes ?? 0} B as written`,
      `${recipe.name}: the export ships ${(await modelFiles(out)).join(', ')} of models`,
      `${recipe.name}: the run's folder holds ${(peakBytes / 1024 ** 2).toFixed(0)} MB at the peak`,
    ],
  };
}

async function runRecipe(
  context: ScenarioContext,
  recipe: Recipe,
): Promise<{ launches: Record<string, number>[]; window: Readonly<Record<string, number>> | null; notes: string[] }> {
  const id = `S1-${recipe.name}`;
  const subject = await prepared(context, id, (folder) => prepareRecipe(context, recipe, folder), decodeSubject);
  try {
    const editors: Record<string, number>[] = [];
    const windows: Record<string, number>[] = [];
    for (let n = 1; n <= context.launches; n += 1) {
      const reading = await measureEditor(context, recipe, subject.project, subject.entityId, `S1-${recipe.name}-${n}`);
      editors.push(reading.metrics);
      windows.push(reading.window);
    }
    const window = oneWindow(`S1 ${recipe.name}`, windows);
    await warmFiles(subject.out);
    const server = await serveFolder(subject.out);
    try {
      const launches: Record<string, number>[] = [];
      const builds: Record<string, number>[] = [];
      for (const [index, editor] of editors.entries()) {
        const built = await measureBuild(context, server.url, `S1-${recipe.name}-build-${index + 1}`, {
          allocations: false,
        });
        builds.push(built.window);
        const placed: Record<string, number> = {};
        for (const [name, value] of Object.entries(built.metrics)) {
          if (['firstFrameMs', 'longestTaskMs', 'heapBytes', 'heapUsedBytes', 'heapBackingBytes', 'gpuBytes'].includes(name)) {
            placed[`${recipe.name}.build.${name}`] = value;
          }
        }
        launches.push({ ...editor, ...placed });
      }
      oneWindow(`S1 ${recipe.name}'s builds`, builds);
      return { launches, window, notes: [...subject.notes] };
    } finally {
      await server.close();
    }
  } finally {
    await finished(context, id);
  }
}

export async function bigAssetsScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const launches: Record<string, number>[] = Array.from({ length: context.launches }, () => ({}));
  let window: Readonly<Record<string, number>> | null = null;
  const notes: string[] = [];
  for (const recipe of RECIPES) {
    const ran = await runRecipe(context, recipe);
    ran.launches.forEach((reading, index) => Object.assign(launches[index] ?? {}, reading));
    window ??= ran.window;
    notes.push(...ran.notes);
  }
  return { metrics: metricsOf(METRICS, launches), window, notes };
}
