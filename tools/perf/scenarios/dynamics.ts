import { join } from 'node:path';
import { isRecord, type AssetId } from '@three-studio/core';
import { writeDynamicsProject } from '../generate/projects';
import { assetIdAt, decodeNumberList, decodeNumbers, freePort, runInPage, stringAt } from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import {
  churnByScript,
  churnCrates,
  destroyCrates,
  pressPlay,
  pressStop,
  sceneLoaded,
  setScriptChurn,
  settleDraws,
  spawnCrates,
  windowShape,
} from '../page/editor';
import { countFrames, frameDeltas, waitFrames } from '../page/frames';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { frameStats, median } from '../report/stats';
import { type ScenarioContext, finished, prepared } from './context';
import { allocationsOver, captureView, checkExit, heapReading, oneWindow } from './readings';

/*
 * S4 — Dynamics: in the editor's Play, uncapped, a thousand boxes at rest on a
 * floor, each with a dynamic Rigid Body, a box Collider and a script; then a
 * thousand `Crate`s instantiated through the running world and destroyed,
 * each in one task with the world's pass; then a minute in which every frame
 * replaces the twenty oldest of a thousand crates, driven by the page; then
 * the same minute driven by the project's `Spawner` script, through the façade.
 */

const WARMUP_FRAMES = 120;
const MEASURED_FRAMES = 600;
const ALLOCATION_FRAMES = 300;
/** Rapier puts a body to sleep once it has been still for two seconds: the boxes are read past it. */
const REST_MS = 3000;
/** Between a spawn and what follows it: the crates drawn and falling a while, as a game's would be. */
const FALLING_FRAMES = 60;
const CHURN_MS = 60_000;
const CHURN_PER_FRAME = 20;

/**
 * The crates' slots: a grid the size of the field, high enough over it that a
 * crate falls for as long as it lives — fifty frames of the churn, sixty after
 * a spawn — and never reaches the boxes. Reaching them would wake them, and the
 * churn would read their contacts.
 */
const CRATES = { count: 1000, columns: 40, spacing: 1.5, height: 20 } as const;

export const DYNAMICS_METRICS: ReadonlyMap<string, MetricSpec> = new Map<string, MetricSpec>([
  ['scripted.frameMs', { kind: 'timing', unit: 'ms' }],
  ['scripted.frameMsP95', { kind: 'reported', unit: 'ms' }],
  ['scripted.frameMsMax', { kind: 'reported', unit: 'ms' }],
  ['scripted.allocBytesPerFrame', { kind: 'reported', unit: 'B' }],
  ['spawn.ms', { kind: 'timing', unit: 'ms' }],
  ['destroy.ms', { kind: 'timing', unit: 'ms' }],
  ['churn.frameMs', { kind: 'timing', unit: 'ms' }],
  ['churn.heapBytes', { kind: 'memory', unit: 'B' }],
  ['churn.heapGrowthBytes', { kind: 'reported', unit: 'B' }],
  ['script.churn.frameMs', { kind: 'timing', unit: 'ms' }],
  ['script.churn.heapBytes', { kind: 'memory', unit: 'B' }],
  ['script.churn.heapGrowthBytes', { kind: 'reported', unit: 'B' }],
]);

/** What a launch reads, before it is made metrics. */
export interface DynamicsReadings {
  /** The time between frames, the boxes at rest. */
  readonly scripted: readonly number[];
  readonly allocBytesPerFrame: number;
  readonly spawnMs: number;
  readonly destroyMs: number;
  /** The time between frames through the churn. */
  readonly churn: readonly number[];
  /** JS memory as the churn begins and once it is over, a thousand crates alive at both. */
  readonly heapBefore: number;
  readonly heapAfter: number;
  /** The same churn, by the project's `Spawner` script through the façade: the time between frames. */
  readonly scriptChurn: readonly number[];
  /** JS memory as the script's churn begins and once it is over, a thousand of its crates alive at both. */
  readonly scriptHeapBefore: number;
  readonly scriptHeapAfter: number;
}

export function dynamicsMetrics(readings: DynamicsReadings): Record<string, number> {
  const scripted = frameStats(readings.scripted);
  return {
    'scripted.frameMs': scripted.median,
    'scripted.frameMsP95': scripted.p95,
    'scripted.frameMsMax': scripted.max,
    'scripted.allocBytesPerFrame': readings.allocBytesPerFrame,
    'spawn.ms': readings.spawnMs,
    'destroy.ms': readings.destroyMs,
    'churn.frameMs': median(readings.churn),
    'churn.heapBytes': readings.heapAfter,
    'churn.heapGrowthBytes': readings.heapAfter - readings.heapBefore,
    'script.churn.frameMs': median(readings.scriptChurn),
    'script.churn.heapBytes': readings.scriptHeapAfter,
    'script.churn.heapGrowthBytes': readings.scriptHeapAfter - readings.scriptHeapBefore,
  };
}

export interface DynamicsSubject {
  readonly project: string;
  /** The `Crate` prefab, which the page hands the running world. */
  readonly crate: AssetId;
}

/** A subject kept between two launches: its prefab's id is text until it is decoded as one. */
export function decodeDynamicsSubject(value: unknown): DynamicsSubject {
  if (!isRecord(value)) throw new Error('not a subject');
  return { project: stringAt(value, 'project'), crate: assetIdAt(value, 'crate') };
}

async function measure(
  context: ScenarioContext,
  subject: DynamicsSubject,
  label: string,
): Promise<{ metrics: Record<string, number>; window: Record<string, number>; notes: string[] }> {
  const editor = await launchEditor({
    repo: context.repo,
    runDir: context.runDir,
    project: subject.project,
    mode: 'uncapped',
    label,
    port: await freePort(),
  });
  try {
    const { session } = editor;
    await runInPage(session, sceneLoaded, undefined);
    const window = decodeNumbers(await runInPage(session, windowShape, undefined));
    await runInPage(session, pressPlay, undefined, 180_000);
    await runInPage(session, settleDraws, 30);
    await runInPage(session, countFrames, REST_MS);
    const scripted = decodeNumberList(
      await runInPage(session, frameDeltas, { warmup: WARMUP_FRAMES, frames: MEASURED_FRAMES }),
    );
    const allocations = await allocationsOver(session, ALLOCATION_FRAMES, context.repo);

    const field = { ...CRATES, prefab: subject.crate };
    const spawn = decodeNumbers(await runInPage(session, spawnCrates, field));
    await runInPage(session, waitFrames, FALLING_FRAMES);
    const destroy = decodeNumbers(await runInPage(session, destroyCrates, undefined));

    // A thousand alive again, and the heap read with them, before the churn.
    await runInPage(session, spawnCrates, field);
    await runInPage(session, waitFrames, FALLING_FRAMES);
    const before = await heapReading(session);
    const churn = decodeNumberList(
      await runInPage(session, churnCrates, { ...field, perFrame: CHURN_PER_FRAME, ms: CHURN_MS }, CHURN_MS + 60_000),
    );
    const after = await heapReading(session);
    if (context.shots !== null) {
      await captureView(session, 'game', 'uncapped', join(context.shots, `${label}-churn.png`));
    }
    await runInPage(session, destroyCrates, undefined);

    // The same churn by the `Spawner`, through the façade: its thousand
    // crates placed over the first fifty frames, then the heap read and the
    // minute measured.
    await runInPage(session, setScriptChurn, true);
    await runInPage(session, waitFrames, FALLING_FRAMES);
    const scriptBefore = await heapReading(session);
    const scriptChurn = decodeNumberList(await runInPage(session, churnByScript, CHURN_MS, CHURN_MS + 60_000));
    const scriptAfter = await heapReading(session);
    if (context.shots !== null) {
      await captureView(session, 'game', 'uncapped', join(context.shots, `${label}-script-churn.png`));
    }
    await runInPage(session, pressStop, undefined);

    const exit = await editor.finish();
    checkExit(label, 'uncapped', exit);
    const metrics = dynamicsMetrics({
      scripted,
      allocBytesPerFrame: allocations.bytesPerFrame,
      spawnMs: spawn['ms'] ?? Number.NaN,
      destroyMs: destroy['ms'] ?? Number.NaN,
      churn,
      heapBefore: before.heapBytes,
      heapAfter: after.heapBytes,
      scriptChurn,
      scriptHeapBefore: scriptBefore.heapBytes,
      scriptHeapAfter: scriptAfter.heapBytes,
    });
    context.say(
      `${label}: scripted ${metrics['scripted.frameMs']?.toFixed(2)} ms, ` +
        `spawn ${metrics['spawn.ms']?.toFixed(0)} ms, destroy ${metrics['destroy.ms']?.toFixed(0)} ms, ` +
        `churn ${metrics['churn.frameMs']?.toFixed(2)} ms, script churn ${metrics['script.churn.frameMs']?.toFixed(2)} ms`,
    );
    return {
      metrics,
      window,
      notes: allocations.sites.map(
        (site) => `scripted: ${(site.bytes / ALLOCATION_FRAMES).toFixed(0)} B/frame at ${site.where}`,
      ),
    };
  } catch (error) {
    editor.kill();
    throw error;
  }
}

export async function dynamicsScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const subject = await prepared(
    context,
    'S4',
    async (folder) => {
      const written = await writeDynamicsProject(folder);
      const made: DynamicsSubject = { project: written.path, crate: written.crate };
      // Not recorded: compiles the pipelines, warms the disk cache and the
      // harness's application data, as a person's second launch would find them.
      await measure(context, made, 'S4-warmup');
      return made;
    },
    decodeDynamicsSubject,
  );
  try {
    const launches: Record<string, number>[] = [];
    const windows: Record<string, number>[] = [];
    let notes: string[] = [];
    for (let n = 1; n <= context.launches; n += 1) {
      const reading = await measure(context, subject, `S4-${n}`);
      launches.push(reading.metrics);
      windows.push(reading.window);
      if (n === 1) notes = reading.notes;
    }
    return { metrics: metricsOf(DYNAMICS_METRICS, launches), window: oneWindow('S4', windows), notes };
  } finally {
    await finished(context, 'S4');
  }
}
