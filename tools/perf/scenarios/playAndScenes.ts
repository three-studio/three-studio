import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, isSceneId, type SceneId } from '@three-studio/core';
import { openProject, updateProject } from '../../../apps/desktop/src/main/project';
import { ballastPaths, writeScriptedProject } from '../generate/projects';
import {
  type CdpSession,
  decodeNumberList,
  decodeNumbers,
  freePort,
  recordAt,
  runInPage,
  stringAt,
} from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import {
  goThroughLoading,
  pressPlay,
  pressStop,
  rendererCounts,
  sceneApiFrom,
  sceneLoaded,
  setLoadingScene,
  switchScenes,
} from '../page/editor';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { median } from '../report/stats';
import { type ScenarioContext, finished, prepared } from './context';
import { checkExit, heapReading } from './readings';

/*
 * S6 — Play and scenes: the scripted project of four scenes. Play's start —
 * compile, import, world, first frame — five times; thirty switches between
 * `A` and `B` through the game's own scene API; a switch to `Heavy` behind `Loading`; and
 * ten cycles of a ballast script edited on disk, Play, Stop.
 *
 * In that order: the switches run with no loading scene, which the `Game`
 * would otherwise put up before every one of them, and Play starts on its
 * first scene without one, so the cycles may follow it being set.
 */

/**
 * The medians of five Plays and thirty switches: one Play a launch moved by
 * 5 % from one launch to the next, and ten switches by 3.7 %.
 */
const PLAYS = 5;
const SWITCHES = 30;
const CYCLES = 10;

export const METRICS: ReadonlyMap<string, MetricSpec> = new Map<string, MetricSpec>([
  ['play.firstFrameMs', { kind: 'timing', unit: 'ms' }],
  ['switch.ms', { kind: 'timing', unit: 'ms' }],
  ['switch.heapBytes', { kind: 'memory', unit: 'B' }],
  ['switch.gpuBytes', { kind: 'memory', unit: 'B' }],
  ['switch.heapGrowthBytes', { kind: 'reported', unit: 'B' }],
  ['switch.gpuGrowthBytes', { kind: 'reported', unit: 'B' }],
  ['loading.ms', { kind: 'timing', unit: 'ms' }],
  ['loading.longestFrameMs', { kind: 'timing', unit: 'ms' }],
  ['loading.frames', { kind: 'reported', unit: '' }],
  ['loading.startPrograms', { kind: 'reported', unit: '' }],
  ['cycles.heapBytes', { kind: 'memory', unit: 'B' }],
  ['cycles.gpuBytes', { kind: 'memory', unit: 'B' }],
  ['cycles.heapGrowthPerCycleBytes', { kind: 'reported', unit: 'B' }],
  ['cycles.gpuGrowthPerCycleBytes', { kind: 'reported', unit: 'B' }],
]);

/** The loading switch's metrics, out of what `goThroughLoading` read in the page. */
export function loadingMetrics(reading: Readonly<Record<string, number>>): Record<string, number> {
  return {
    'loading.ms': reading['ms'] ?? Number.NaN,
    'loading.longestFrameMs': reading['longestFrameMs'] ?? Number.NaN,
    'loading.frames': reading['frames'] ?? Number.NaN,
    'loading.startPrograms': reading['startPrograms'] ?? Number.NaN,
  };
}

/** Bumps a ballast script's revision on disk: a new bundle at the next Play. */
export async function editBallast(path: string, revision: number): Promise<void> {
  const source = await readFile(path, 'utf8');
  const edited = source.replace(/const REVISION = \d+;/, `const REVISION = ${revision};`);
  if (edited === source) throw new Error(`${path} has no revision to bump`);
  await writeFile(path, edited);
}

async function memoryNow(session: CdpSession): Promise<{ heap: number; gpu: number }> {
  const heap = await heapReading(session);
  const gpu = decodeNumbers(await runInPage(session, rendererCounts, undefined))['gpuBytes'] ?? Number.NaN;
  return { heap: heap.heapBytes, gpu };
}

interface Subject {
  readonly project: string;
  /** The scenes' ids by name. */
  readonly scenes: Readonly<Record<string, SceneId>>;
  readonly ballast: string;
}

function decodeSubject(value: unknown): Subject {
  if (!isRecord(value)) throw new Error('not a subject');
  const scenes = recordAt(value, 'scenes');
  return {
    project: stringAt(value, 'project'),
    scenes: Object.fromEntries(Object.keys(scenes).map((name) => [name, sceneIdAt(scenes, name)])),
    ballast: stringAt(value, 'ballast'),
  };
}

/** A scene's id out of a record a launch wrote and this one reads back. */
function sceneIdAt(record: Record<string, unknown>, key: string): SceneId {
  const id = record[key];
  if (!isSceneId(id)) throw new Error(`${key} is not a scene id`);
  return id;
}

function sceneId(subject: Subject, name: string): SceneId {
  const id = subject.scenes[name];
  if (id === undefined) throw new Error(`the scripted project has no scene ${name}`);
  return id;
}

async function measure(
  context: ScenarioContext,
  subject: Subject,
  nextRevision: () => number,
  label: string,
): Promise<{ metrics: Record<string, number>; notes: string[] }> {
  // Every launch starts with no loading scene: the last one set it.
  await updateProject(subject.project, (project) => ({ ...project, settings: { ...project.settings, loadingScene: null } }));
  const editor = await launchEditor({
    repo: context.repo,
    runDir: context.runDir,
    project: subject.project,
    mode: 'display',
    label,
    port: await freePort(),
  });
  try {
    await runInPage(editor.session, sceneLoaded, undefined);
    // The last Play stays running, for the switches.
    const plays: number[] = [];
    for (let n = 1; n <= PLAYS; n += 1) {
      if (n > 1) await runInPage(editor.session, pressStop, undefined);
      plays.push(decodeNumbers(await runInPage(editor.session, pressPlay, undefined, 300_000))['gameShownMs'] ?? Number.NaN);
    }
    await runInPage(editor.session, sceneApiFrom, 'A');

    const before = await memoryNow(editor.session);
    const order = Array.from({ length: SWITCHES }, (_, index) => {
      const name = index % 2 === 0 ? 'B' : 'A';
      return { name, id: sceneId(subject, name) };
    });
    const switches = decodeNumberList(
      await runInPage(editor.session, switchScenes, { order, loadingId: sceneId(subject, 'Loading') }, 300_000),
    );
    const switched = await memoryNow(editor.session);
    await runInPage(editor.session, pressStop, undefined);

    await runInPage(editor.session, setLoadingScene, sceneId(subject, 'Loading'));
    await runInPage(editor.session, pressPlay, undefined, 300_000);
    await runInPage(editor.session, sceneApiFrom, 'A');
    const loading = decodeNumbers(
      await runInPage(
        editor.session,
        goThroughLoading,
        { target: { name: 'Heavy', id: sceneId(subject, 'Heavy') }, loadingId: sceneId(subject, 'Loading') },
        300_000,
      ),
    );
    await runInPage(editor.session, pressStop, undefined);

    const cyclesBefore = await memoryNow(editor.session);
    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      await editBallast(subject.ballast, nextRevision());
      await runInPage(editor.session, pressPlay, undefined, 300_000);
      await runInPage(editor.session, pressStop, undefined);
    }
    const cycled = await memoryNow(editor.session);

    const exit = await editor.finish();
    checkExit(label, 'display', exit);
    context.say(
      `${label}: Play ${median(plays).toFixed(0)} ms, switch ${median(switches).toFixed(0)} ms, loading ${loading['ms']?.toFixed(0)} ms`,
    );
    return {
      metrics: {
        'play.firstFrameMs': median(plays),
        'switch.ms': median(switches),
        'switch.heapBytes': switched.heap,
        'switch.gpuBytes': switched.gpu,
        'switch.heapGrowthBytes': switched.heap - before.heap,
        'switch.gpuGrowthBytes': switched.gpu - before.gpu,
        ...loadingMetrics(loading),
        'cycles.heapBytes': cycled.heap,
        'cycles.gpuBytes': cycled.gpu,
        'cycles.heapGrowthPerCycleBytes': (cycled.heap - cyclesBefore.heap) / CYCLES,
        'cycles.gpuGrowthPerCycleBytes': (cycled.gpu - cyclesBefore.gpu) / CYCLES,
      },
      notes: [
        `${SWITCHES} switches between A and B, no frame of Loading among them`,
        `the heap ${cycled.heap > cyclesBefore.heap ? 'grew' : 'did not grow'} over ${CYCLES} edit → Play cycles`,
        loading['sawLoading'] === 1
          ? `Loading ran while Heavy loaded, ${loading['frames']} frames drawn meanwhile`
          : 'Loading NEVER ran while Heavy loaded',
      ],
    };
  } catch (error) {
    editor.kill();
    throw error;
  }
}

export async function playAndScenesScenario(context: ScenarioContext): Promise<ScenarioResult> {
  let revision = 0;
  const nextRevision = (): number => {
    revision += 1;
    return revision;
  };
  const subject = await prepared(
    context,
    'S6',
    async (folder) => {
      const project = await writeScriptedProject(folder);
      const opened = await openProject(project);
      const [ballast] = ballastPaths();
      if (ballast === undefined) throw new Error('the scripted recipe has no ballast script');
      const made: Subject = {
        project,
        scenes: Object.fromEntries(opened.scenes.map((scene) => [scene.name, scene.id])),
        ballast: join(project, ballast),
      };
      await measure(context, made, nextRevision, 'S6-warmup');
      return made;
    },
    decodeSubject,
  );
  try {
    const launches: Record<string, number>[] = [];
    let notes: string[] = [];
    for (let n = 1; n <= context.launches; n += 1) {
      const reading = await measure(context, subject, nextRevision, `S6-${n}`);
      launches.push(reading.metrics);
      if (n === 1) notes = reading.notes;
    }
    return { metrics: metricsOf(METRICS, launches), window: null, notes };
  } finally {
    await finished(context, 'S6');
  }
}
