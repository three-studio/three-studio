import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deserializeScene, entitiesWith, findComponent } from '@three-studio/core';
import { openProject } from '../../../apps/desktop/src/main/project';
import { writeRenderProject } from '../generate/projects';
import { type CdpSession, decodeNumberList, decodeNumbers, freePort, runInPage } from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import {
  poseEditorCamera,
  pressPlay,
  pressStop,
  rendererCounts,
  sceneLoaded,
  settleDraws,
  windowShape,
} from '../page/editor';
import { frameDeltas } from '../page/frames';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { frameStats } from '../report/stats';
import type { ScenarioContext } from './context';
import { allocationsOver, captureView, checkExit, heapReading } from './readings';

/*
 * S3 — Render: September's field of 3 004 entities, in the edit view and in
 * Play, uncapped so a frame's time is its work. The editor camera takes the
 * main camera's pose, so both draw the same shot.
 */

const WARMUP_FRAMES = 120;
const MEASURED_FRAMES = 600;
const ALLOCATION_FRAMES = 300;

function viewMetrics(view: 'edit' | 'play'): [string, MetricSpec][] {
  return [
    [`${view}.frameMs`, { kind: 'timing', unit: 'ms' }],
    [`${view}.frameMsP95`, { kind: 'reported', unit: 'ms' }],
    [`${view}.frameMsMax`, { kind: 'reported', unit: 'ms' }],
    [`${view}.drawCalls`, { kind: 'count', unit: '' }],
    [`${view}.triangles`, { kind: 'count', unit: '' }],
    [`${view}.textures`, { kind: 'count', unit: '' }],
    [`${view}.geometries`, { kind: 'count', unit: '' }],
    [`${view}.programs`, { kind: 'count', unit: '' }],
    [`${view}.renderTargets`, { kind: 'count', unit: '' }],
    [`${view}.gpuBytes`, { kind: 'memory', unit: 'B' }],
    [`${view}.heapBytes`, { kind: 'memory', unit: 'B' }],
    [`${view}.heapUsedBytes`, { kind: 'reported', unit: 'B' }],
    [`${view}.heapBackingBytes`, { kind: 'reported', unit: 'B' }],
    [`${view}.allocBytesPerFrame`, { kind: 'reported', unit: 'B' }],
  ];
}

const METRICS: ReadonlyMap<string, MetricSpec> = new Map([...viewMetrics('edit'), ...viewMetrics('play')]);

interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly fov: number;
}

/** The scene's main camera, read from its file with the app's own code. */
async function mainCameraPose(projectPath: string): Promise<CameraPose> {
  const scene = deserializeScene((await openProject(projectPath)).sceneJson);
  for (const entityId of entitiesWith(scene, 'camera')) {
    const camera = findComponent(scene, entityId, 'camera');
    const entity = scene.entities[entityId];
    if (camera?.isMain === true && entity) {
      return { position: entity.transform.position, rotation: entity.transform.rotation, fov: camera.fov };
    }
  }
  throw new Error('the render scene has no main camera');
}

/** One view's readings: its frames, what it draws and holds, and what a frame allocates. */
async function readView(
  session: CdpSession,
  view: 'edit' | 'play',
  repo: string,
): Promise<{ metrics: Record<string, number>; sites: string[] }> {
  const deltas = decodeNumberList(await runInPage(session, frameDeltas, { warmup: WARMUP_FRAMES, frames: MEASURED_FRAMES }));
  const frames = frameStats(deltas);
  const counts = decodeNumbers(await runInPage(session, rendererCounts, undefined));
  const heap = await heapReading(session);
  const allocations = await allocationsOver(session, ALLOCATION_FRAMES, repo);
  const metrics: Record<string, number> = {
    [`${view}.frameMs`]: frames.median,
    [`${view}.frameMsP95`]: frames.p95,
    [`${view}.frameMsMax`]: frames.max,
    [`${view}.allocBytesPerFrame`]: allocations.bytesPerFrame,
  };
  for (const [name, value] of Object.entries({ ...counts, ...heap })) metrics[`${view}.${name}`] = value;
  return {
    metrics,
    sites: allocations.sites.map((site) => `${view}: ${(site.bytes / ALLOCATION_FRAMES).toFixed(0)} B/frame at ${site.where}`),
  };
}

async function measure(
  context: ScenarioContext,
  project: string,
  pose: CameraPose,
  label: string,
): Promise<{ metrics: Record<string, number>; window: Record<string, number>; notes: string[] }> {
  const editor = await launchEditor({
    repo: context.repo,
    runDir: context.runDir,
    project,
    mode: 'uncapped',
    label,
    port: await freePort(),
  });
  try {
    await runInPage(editor.session, sceneLoaded, undefined);
    await runInPage(editor.session, poseEditorCamera, pose);
    await runInPage(editor.session, settleDraws, 30);
    const window = decodeNumbers(await runInPage(editor.session, windowShape, undefined));
    const edit = await readView(editor.session, 'edit', context.repo);
    if (context.shots !== null) await captureView(editor.session, 'edit', 'uncapped', join(context.shots, `${label}-edit.png`));

    await runInPage(editor.session, pressPlay, undefined, 180_000);
    await runInPage(editor.session, settleDraws, 30);
    const play = await readView(editor.session, 'play', context.repo);
    if (context.shots !== null) await captureView(editor.session, 'game', 'uncapped', join(context.shots, `${label}-play.png`));
    await runInPage(editor.session, pressStop, undefined);

    const exit = await editor.finish();
    checkExit(label, 'uncapped', exit);
    context.say(`${label}: edit ${edit.metrics['edit.frameMs']?.toFixed(2)} ms, play ${play.metrics['play.frameMs']?.toFixed(2)} ms`);
    return { metrics: { ...edit.metrics, ...play.metrics }, window, notes: [...edit.sites, ...play.sites] };
  } catch (error) {
    editor.kill();
    throw error;
  }
}

export async function renderScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const projects = join(context.runDir, 'projects', 'S3');
  await mkdir(projects, { recursive: true });
  try {
    const project = await writeRenderProject(projects);
    const pose = await mainCameraPose(project);
    // Not recorded: compiles the pipelines, warms the disk cache and the
    // harness's application data, as a person's second launch would find them.
    await measure(context, project, pose, 'S3-warmup');
    const launches: Record<string, number>[] = [];
    let window: Record<string, number> | null = null;
    let notes: string[] = [];
    for (let n = 1; n <= context.launches; n += 1) {
      const reading = await measure(context, project, pose, `S3-${n}`);
      launches.push(reading.metrics);
      if (window === null) {
        window = reading.window;
        notes = reading.notes;
      }
    }
    return { metrics: metricsOf(METRICS, launches), window, notes };
  } finally {
    await rm(projects, { recursive: true, force: true });
  }
}
