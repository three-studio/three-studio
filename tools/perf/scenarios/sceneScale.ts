import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserializeScene, isRecord, serializeScene, type SceneDoc } from '@three-studio/core';
import { openProject } from '../../../apps/desktop/src/main/project';
import { writeLargeProject } from '../generate/projects';
import {
  decodeNumberList,
  decodeNumbers,
  freePort,
  numberAt,
  runInPage,
  stringAt,
  stringsAt,
} from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import {
  dragDeltas,
  duplicateAndUndo,
  editAndSave,
  firstFrameWithEntities,
  hierarchyScroll,
  scrollDeltas,
  settleDraws,
  windowShape,
} from '../page/editor';
import { frameDeltas } from '../page/frames';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { frameStats, median } from '../report/stats';
import { type ScenarioContext, finished, prepared } from './context';
import { MISSED_START, captureView, checkExit, heapReading, oneWindow, readTwiceAtMost } from './readings';

/*
 * S2 — Scene scale: 10 003 entities, decoded and encoded in Node, opened,
 * saved, a thousand of them duplicated and the duplicate undone — displayed
 * launches, as shipped — then idle, dragged and scrolled frames, uncapped.
 */

/** The Hierarchy's row, in CSS pixels (`ROW_HEIGHT`, `hierarchyWindow.ts`). */
const ROW_HEIGHT = 24;
/**
 * Each gesture nine times, and the scene decoded and encoded nine times after
 * three passes untimed: with three of each, a save's median moved by 15 % from
 * one launch to the next, and the first decodes of a fresh process are the
 * JIT's — the baseline's A/B read the decode 8 % apart on the same commit.
 */
const GESTURES = 9;
const NODE_WARMUPS = 3;
const NODE_REPETITIONS = 9;
const WARMUP_FRAMES = 60;
const MEASURED_FRAMES = 300;

const METRICS: ReadonlyMap<string, MetricSpec> = new Map<string, MetricSpec>([
  ['node.decodeMs', { kind: 'timing', unit: 'ms' }],
  // Shown, not judged: on one commit against itself its medians fell 2.6 %
  // apart, more than half the budget.
  ['node.encodeMs', { kind: 'reported', unit: 'ms' }],
  ['sceneBytes', { kind: 'count', unit: 'B' }],
  ['open.firstFrameMs', { kind: 'timing', unit: 'ms' }],
  ['open.heapBytes', { kind: 'memory', unit: 'B' }],
  ['open.heapUsedBytes', { kind: 'reported', unit: 'B' }],
  ['open.heapBackingBytes', { kind: 'reported', unit: 'B' }],
  // Shown, not judged: a save writes 16.7 MB, and on one commit against itself
  // its medians fell 3.3 % apart, with nine saves a launch.
  ['save.ms', { kind: 'reported', unit: 'ms' }],
  ['duplicate.ms', { kind: 'timing', unit: 'ms' }],
  ['undo.ms', { kind: 'timing', unit: 'ms' }],
  ['idle.frameMs', { kind: 'timing', unit: 'ms' }],
  ['drag.frameMs', { kind: 'timing', unit: 'ms' }],
  ['drag.frameMsP95', { kind: 'reported', unit: 'ms' }],
  ['scroll.frameMs', { kind: 'timing', unit: 'ms' }],
  ['scroll.frameMsP95', { kind: 'reported', unit: 'ms' }],
]);

/** The first `count` groups at the root — entities with children — in the scene's order. */
export function groupsToSelect(scene: SceneDoc, count: number): string[] {
  const groups = scene.rootOrder.filter((id) => (scene.entities[id]?.children.length ?? 0) > 0);
  if (groups.length < count) throw new Error(`the scene has ${groups.length} groups, not ${count}`);
  return groups.slice(0, count);
}

/** How many entities these and everything under them make. */
export function subtreeSize(scene: SceneDoc, ids: readonly string[]): number {
  let total = 0;
  const pending = [...ids];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    total += 1;
    pending.push(...(scene.entities[id]?.children ?? []));
  }
  return total;
}

/**
 * The scene decoded and encoded `repetitions` times each in Node after
 * `warmups` untimed passes, the medians: what the decoders F7 writes are held to.
 */
export function nodeTimings(
  text: string,
  warmups: number,
  repetitions: number,
): { decodeMs: number; encodeMs: number; entities: number } {
  const decodes: number[] = [];
  const encodes: number[] = [];
  let scene: SceneDoc | null = null;
  for (let n = 0; n < warmups + repetitions; n += 1) {
    const started = performance.now();
    scene = deserializeScene(text);
    if (n >= warmups) decodes.push(performance.now() - started);
  }
  if (scene === null) throw new Error('no repetition ran');
  for (let n = 0; n < warmups + repetitions; n += 1) {
    const started = performance.now();
    serializeScene(scene);
    if (n >= warmups) encodes.push(performance.now() - started);
  }
  return { decodeMs: median(decodes), encodeMs: median(encodes), entities: Object.keys(scene.entities).length };
}

interface Subject {
  readonly project: string;
  /** The scene file the editor opens, and saves into. */
  readonly scenePath: string;
  /**
   * The scene as the warm-up's saves left it, copied back before each measured
   * launch: the saves nudge an entity, and every launch — of either tree, in an
   * A/B — opens the same file and weighs the same bytes.
   */
  readonly snapshot: string;
  readonly ids: readonly string[];
  readonly groups: readonly string[];
  /** What a duplicate of the groups adds: the groups and their children. */
  readonly added: number;
  /** One prop, the kind of entity a drag holds, batched with its like. */
  readonly dragged: string;
}

function decodeSubject(value: unknown): Subject {
  if (!isRecord(value)) throw new Error('not a subject');
  return {
    project: stringAt(value, 'project'),
    scenePath: stringAt(value, 'scenePath'),
    snapshot: stringAt(value, 'snapshot'),
    ids: stringsAt(value, 'ids'),
    groups: stringsAt(value, 'groups'),
    added: numberAt(value, 'added'),
    dragged: stringAt(value, 'dragged'),
  };
}

/** Open, save, duplicate and undo, in a displayed launch. */
async function measureDisplayed(context: ScenarioContext, subject: Subject, label: string): Promise<Record<string, number>> {
  return readTwiceAtMost(label, async (attempt) => {
    const editor = await launchEditor({
      repo: context.repo,
      runDir: context.runDir,
      project: subject.project,
      mode: 'display',
      label: attempt === 1 ? label : `${label}-again`,
      port: await freePort(),
    });
    try {
      const shown = decodeNumbers(await runInPage(editor.session, firstFrameWithEntities, subject.ids, 300_000));
      if (shown['late'] === 1) {
        editor.kill();
        context.say(`${label}: the scene was bound before the driver arrived`);
        return MISSED_START;
      }
      const heap = await heapReading(editor.session);
      if (context.shots !== null) await captureView(editor.session, 'edit', 'display', join(context.shots, `${label}-open.png`));
      const saves: number[] = [];
      const duplicates: number[] = [];
      const undos: number[] = [];
      for (let n = 0; n < GESTURES; n += 1) {
        saves.push(decodeNumbers(await runInPage(editor.session, editAndSave, subject.dragged, 120_000))['saveMs'] ?? Number.NaN);
        const both = decodeNumbers(await runInPage(editor.session, duplicateAndUndo, subject.groups, 300_000));
        if (both['added'] !== subject.added) {
          throw new Error(`${label}: Duplicate added ${both['added']} entities, not ${subject.added}`);
        }
        duplicates.push(both['duplicateMs'] ?? Number.NaN);
        undos.push(both['undoMs'] ?? Number.NaN);
      }
      const exit = await editor.finish();
      checkExit(label, 'display', exit);
      context.say(`${label}: opened at ${shown['firstFrameAt']?.toFixed(0)} ms, duplicate ${median(duplicates).toFixed(0)} ms`);
      return {
        'open.firstFrameMs': shown['firstFrameAt'] ?? Number.NaN,
        'open.heapBytes': heap.heapBytes,
        'open.heapUsedBytes': heap.heapUsedBytes,
        'open.heapBackingBytes': heap.heapBackingBytes,
        'save.ms': median(saves),
        'duplicate.ms': median(duplicates),
        'undo.ms': median(undos),
      };
    } catch (error) {
      editor.kill();
      throw error;
    }
  });
}

/** Idle, dragged and scrolled frames, uncapped. */
async function measureUncapped(
  context: ScenarioContext,
  subject: Subject,
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
    await runInPage(editor.session, firstFrameWithEntities, subject.ids, 300_000);
    await runInPage(editor.session, settleDraws, 30, 120_000);
    const window = decodeNumbers(await runInPage(editor.session, windowShape, undefined));
    const idle = frameStats(
      decodeNumberList(await runInPage(editor.session, frameDeltas, { warmup: WARMUP_FRAMES, frames: MEASURED_FRAMES })),
    );
    const drag = frameStats(
      decodeNumberList(
        await runInPage(editor.session, dragDeltas, {
          entityId: subject.dragged,
          warmup: WARMUP_FRAMES,
          frames: MEASURED_FRAMES,
        }),
      ),
    );
    const scroll = frameStats(
      decodeNumberList(
        await runInPage(editor.session, scrollDeltas, {
          rowCount: subject.ids.length,
          rowHeight: ROW_HEIGHT,
          rows: 5,
          warmup: WARMUP_FRAMES,
          frames: MEASURED_FRAMES,
        }),
      ),
    );
    const scrolled = decodeNumbers(
      await runInPage(editor.session, hierarchyScroll, { rowCount: subject.ids.length, rowHeight: ROW_HEIGHT }),
    );
    if (context.shots !== null) {
      await captureView(editor.session, 'edit', 'uncapped', join(context.shots, `${label}-scrolled.png`));
    }
    const exit = await editor.finish();
    checkExit(label, 'uncapped', exit);
    context.say(`${label}: idle ${idle.median.toFixed(2)} ms, drag ${drag.median.toFixed(2)} ms, scroll ${scroll.median.toFixed(2)} ms`);
    return {
      metrics: {
        'idle.frameMs': idle.median,
        'drag.frameMs': drag.median,
        'drag.frameMsP95': drag.p95,
        'scroll.frameMs': scroll.median,
        'scroll.frameMsP95': scroll.p95,
      },
      window,
      notes: [`the Hierarchy scrolled to row ${scrolled['firstRow']} of ${scrolled['rows']}`],
    };
  } catch (error) {
    editor.kill();
    throw error;
  }
}

async function prepare(context: ScenarioContext, folder: string): Promise<Subject> {
  const project = await writeLargeProject(folder);
  const opened = await openProject(project);
  const scenePath = join(project, opened.scenePath);
  const scene = deserializeScene(await readFile(scenePath, 'utf8'));
  const groups = groupsToSelect(scene, 100);
  const [first] = groups;
  const dragged = first === undefined ? undefined : scene.entities[first]?.children[0];
  if (dragged === undefined) throw new Error('the large scene has no prop in its first group');
  const subject: Subject = {
    project,
    scenePath,
    snapshot: join(folder, 'scene.snapshot.json'),
    ids: Object.keys(scene.entities),
    groups,
    added: subtreeSize(scene, groups),
    dragged,
  };
  // Not recorded: the caches, and the scene file as the editor's own save writes it.
  await measureDisplayed(context, subject, 'S2-warmup');
  await measureUncapped(context, subject, 'S2-warmup-uncapped');
  await copyFile(scenePath, subject.snapshot);
  return subject;
}

export async function sceneScaleScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const subject = await prepared(context, 'S2', (folder) => prepare(context, folder), decodeSubject);
  try {
    const saved = await readFile(subject.snapshot, 'utf8');
    const launches: Record<string, number>[] = [];
    const windows: Record<string, number>[] = [];
    const notes = [`Duplicate added ${subject.added} entities to ${subject.ids.length}, and Undo took them back, every time`];
    for (let n = 1; n <= context.launches; n += 1) {
      await copyFile(subject.snapshot, subject.scenePath);
      const node = nodeTimings(saved, NODE_WARMUPS, NODE_REPETITIONS);
      const displayed = await measureDisplayed(context, subject, `S2-${n}`);
      await copyFile(subject.snapshot, subject.scenePath);
      const uncapped = await measureUncapped(context, subject, `S2-${n}-uncapped`);
      windows.push(uncapped.window);
      if (n === 1) notes.push(...uncapped.notes);
      launches.push({
        'node.decodeMs': node.decodeMs,
        'node.encodeMs': node.encodeMs,
        sceneBytes: Buffer.byteLength(saved, 'utf8'),
        ...displayed,
        ...uncapped.metrics,
      });
    }
    return { metrics: metricsOf(METRICS, launches), window: oneWindow('S2', windows), notes };
  } finally {
    await finished(context, 'S2');
  }
}
