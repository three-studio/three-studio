import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { exportBuild } from '../../../apps/desktop/src/main/build/exportBuild';
import { readProject } from '../../../apps/desktop/src/main/project';
import { writeRenderProject } from '../generate/projects';
import { serveFolder } from '../launch/serve';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import type { ScenarioContext } from './context';
import { measureBuild, oneWindow, warmFiles } from './readings';

/*
 * S7 — Player: the render scene exported, as a person's browser first sees it.
 *
 * The chunks' bytes say what a network would add; the first frame is measured
 * from a local server, unthrottled, in a fresh Chrome profile per launch —
 * every launch a first visit, so there is no warm-up to throw away.
 */

/** A chunk's file name less the hash Vite puts before `.js`: `main.023189e1.js` is `main`. */
const HASHED_CHUNK = /^(.+)\.[A-Za-z0-9_-]{8}\.js$/;

/**
 * Every `.js` of the given folders by its name without the hash, with its raw
 * and gzipped bytes. The hash changes with every edit, and a metric named after
 * it would be a new metric each time, compared with nothing.
 */
export async function chunkTable(folders: readonly string[]): Promise<Map<string, { bytes: number; gzipBytes: number }>> {
  const table = new Map<string, { bytes: number; gzipBytes: number }>();
  for (const folder of folders) {
    for (const file of (await readdir(folder)).sort()) {
      if (!file.endsWith('.js')) continue;
      const name = HASHED_CHUNK.exec(file)?.[1] ?? file.slice(0, -'.js'.length);
      if (table.has(name)) throw new Error(`two chunks would be named ${name}, the second in ${folder}/${file}`);
      const bytes = await readFile(join(folder, file));
      table.set(name, { bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length });
    }
  }
  return new Map([...table].sort(([a], [b]) => a.localeCompare(b)));
}

async function folderBytes(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await folderBytes(join(path, entry));
  return total;
}

function metricTable(chunks: Iterable<string>): ReadonlyMap<string, MetricSpec> {
  return new Map<string, MetricSpec>([
    ...[...chunks].flatMap((name): [string, MetricSpec][] => [
      [`chunk.${name}.bytes`, { kind: 'count', unit: 'B' }],
      [`chunk.${name}.gzipBytes`, { kind: 'count', unit: 'B' }],
    ]),
    ['export.bytes', { kind: 'count', unit: 'B' }],
    ['firstFrameMs', { kind: 'timing', unit: 'ms' }],
    ['longestTaskMs', { kind: 'timing', unit: 'ms' }],
    ['heapBytes', { kind: 'memory', unit: 'B' }],
    ['heapUsedBytes', { kind: 'reported', unit: 'B' }],
    ['heapBackingBytes', { kind: 'reported', unit: 'B' }],
    ['gpuBytes', { kind: 'memory', unit: 'B' }],
    ['drawCalls', { kind: 'count', unit: '' }],
    ['allocBytesPerFrame', { kind: 'reported', unit: 'B' }],
  ]);
}

export async function playerScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const projects = join(context.runDir, 'projects', 'S7');
  const out = join(context.runDir, 'exports', 'S7');
  await mkdir(projects, { recursive: true });
  try {
    const project = await writeRenderProject(projects);
    const { build } = (await readProject(project)).settings;
    const profile = build.profiles[build.active];
    if (!profile) throw new Error('the render project has no active build profile');
    await exportBuild(project, profile, out, [context.repo]);

    const chunks = await chunkTable([
      join(context.repo, 'apps/web-template/dist/player'),
      join(context.repo, 'apps/web-template/dist-device'),
    ]);
    const fixed: Record<string, number> = { 'export.bytes': await folderBytes(out) };
    for (const [name, sizes] of chunks) {
      fixed[`chunk.${name}.bytes`] = sizes.bytes;
      fixed[`chunk.${name}.gzipBytes`] = sizes.gzipBytes;
    }

    await warmFiles(out);
    const server = await serveFolder(out);
    try {
      const launches: Record<string, number>[] = [];
      const windows: Record<string, number>[] = [];
      let notes: string[] = [];
      for (let n = 1; n <= context.launches; n += 1) {
        const reading = await measureBuild(context, server.url, `S7-${n}`, { allocations: true });
        launches.push({ ...fixed, ...reading.metrics });
        windows.push(reading.window);
        if (n === 1) notes = reading.notes;
      }
      return { metrics: metricsOf(metricTable(chunks.keys()), launches), window: oneWindow('S7', windows), notes };
    } finally {
      await server.close();
    }
  } finally {
    await rm(projects, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
}
