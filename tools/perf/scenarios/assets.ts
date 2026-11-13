import { rm } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { ASSETS_DIR, CACHE_DIR, isRecord } from '@three-studio/core';
import { readMaterialAssets, readPhysicsMaterialAssets, readPrefabAssets } from '../../../apps/desktop/src/main/assetLibraries';
import { moveAsset, renameAssetFolder } from '../../../apps/desktop/src/main/assetMutations';
import { scanAssets } from '../../../apps/desktop/src/main/assetScan';
import { ASSETS, assetTextures, writeAssetsProject } from '../generate/projects';
import { decodeNumbers, freePort, numberAt, recordAt, runInPage, stringAt } from '../launch/cdp';
import { launchEditor } from '../launch/electron';
import { assetAction, assetsLoaded, listAssets } from '../page/editor';
import { type MetricSpec, metricsOf, type ScenarioResult } from '../report/results';
import { median } from '../report/stats';
import { type ScenarioContext, finished, prepared } from './context';
import { checkExit } from './readings';

/*
 * S5 — Assets: 3 000 textures in 30 folders. The scan in Node, warm and
 * cold; the editor's own gestures on them, timed end to end; and what each
 * carries over IPC, counted as its JSON.
 *
 * The bytes are taken in Node, with the very functions the IPC handlers call
 * with the project's path: `window.studio` is frozen, so the renderer cannot
 * be shown what crossed, and the main process's answer is what crosses.
 */

/**
 * Each gesture this many times, there and back: a move takes a few
 * milliseconds, and six samples left its median moving by a fifth from one run
 * to the next.
 */
const GESTURES = 10;

const METRICS: ReadonlyMap<string, MetricSpec> = new Map<string, MetricSpec>([
  ['node.scanWarmMs', { kind: 'timing', unit: 'ms' }],
  ['node.scanColdMs', { kind: 'timing', unit: 'ms' }],
  ['ipc.listMs', { kind: 'timing', unit: 'ms' }],
  ['ipc.listBytes', { kind: 'count', unit: 'B' }],
  ['move.ms', { kind: 'timing', unit: 'ms' }],
  ['move.bytes', { kind: 'count', unit: 'B' }],
  ['renameFolder.ms', { kind: 'timing', unit: 'ms' }],
  ['renameFolder.bytes', { kind: 'count', unit: 'B' }],
  ['refresh.ms', { kind: 'timing', unit: 'ms' }],
  ['refresh.bytes', { kind: 'count', unit: 'B' }],
]);

/** What a value weighs as the JSON that carries it, in UTF-8 bytes. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

interface Subject {
  /** One texture, by its path in the project. */
  readonly asset: string;
  /** Where it is moved to and back from, under `assets/`. */
  readonly to: string;
  /** A folder of textures, under `assets/`, renamed and back. */
  readonly folder: string;
}

/** The folder an asset sits in, under `assets/`. */
function folderOf(assetPath: string): string {
  return posix.dirname(assetPath).slice(ASSETS_DIR.length + 1);
}

/**
 * What each gesture carries over IPC, made in Node by the functions the
 * handlers call, each undone after: a move there and back, a folder renamed
 * and back. A refresh is four answers — the manifest and the three libraries.
 */
export async function ipcBytes(
  project: string,
  subject: Subject,
): Promise<{ list: number; move: number; renameFolder: number; refresh: number }> {
  const manifest = await scanAssets(project);
  const moved = await moveAsset(project, subject.asset, subject.to);
  const landed = moved.moved[0]?.to;
  if (landed === undefined) throw new Error(`moving ${subject.asset} moved nothing`);
  await moveAsset(project, landed, folderOf(subject.asset));
  const renamed = await renameAssetFolder(project, subject.folder, `${basename(subject.folder)}-renamed`);
  const newName = renamed.addedFolders[0];
  if (newName === undefined) throw new Error(`renaming ${subject.folder} renamed nothing`);
  await renameAssetFolder(project, newName, basename(subject.folder));
  const libraries = [
    await readMaterialAssets(project, manifest),
    await readPhysicsMaterialAssets(project, manifest),
    await readPrefabAssets(project, manifest),
  ];
  return {
    list: jsonBytes(manifest),
    move: jsonBytes(moved),
    renameFolder: jsonBytes(renamed),
    refresh: jsonBytes(manifest) + libraries.reduce((sum, library) => sum + jsonBytes(library), 0),
  };
}

/** The scan, five times warm and three times with its index removed, the medians. */
async function scanTimings(project: string): Promise<{ warm: number; cold: number }> {
  const timed = async (): Promise<number> => {
    const started = performance.now();
    await scanAssets(project);
    return performance.now() - started;
  };
  const warm: number[] = [];
  for (let n = 0; n < 5; n += 1) warm.push(await timed());
  const cold: number[] = [];
  for (let n = 0; n < 3; n += 1) {
    // What a fresh checkout or a deleted cache finds: every sidecar read again.
    await rm(join(project, CACHE_DIR, 'assets.index.json'), { force: true });
    cold.push(await timed());
  }
  return { warm: median(warm), cold: median(cold) };
}

async function measureEditor(
  context: ScenarioContext,
  project: string,
  subject: Subject,
  label: string,
): Promise<Record<string, number>> {
  const editor = await launchEditor({
    repo: context.repo,
    runDir: context.runDir,
    project,
    mode: 'display',
    label,
    port: await freePort(),
  });
  try {
    await runInPage(editor.session, assetsLoaded, ASSETS.textures, 120_000);
    const ms = async (action: Parameters<typeof assetAction>[0]): Promise<number> =>
      decodeNumbers(await runInPage(editor.session, assetAction, action, 120_000))['ms'] ?? Number.NaN;
    const lists: number[] = [];
    for (let n = 0; n < 5; n += 1) {
      lists.push(decodeNumbers(await runInPage(editor.session, listAssets, undefined, 60_000))['ms'] ?? Number.NaN);
    }
    const moves: number[] = [];
    const renames: number[] = [];
    const refreshes: number[] = [];
    const landed = `${ASSETS_DIR}/${subject.to}/${basename(subject.asset)}`;
    const renamedTo = `${posix.dirname(subject.folder)}/${basename(subject.folder)}-renamed`;
    for (let n = 0; n < GESTURES; n += 1) {
      moves.push(await ms({ kind: 'move', path: subject.asset, folder: subject.to }));
      moves.push(await ms({ kind: 'move', path: landed, folder: folderOf(subject.asset) }));
      renames.push(await ms({ kind: 'renameFolder', folder: subject.folder, name: basename(renamedTo) }));
      renames.push(await ms({ kind: 'renameFolder', folder: renamedTo, name: basename(subject.folder) }));
      refreshes.push(await ms({ kind: 'refresh' }));
    }
    const exit = await editor.finish();
    checkExit(label, 'display', exit);
    context.say(`${label}: list ${median(lists).toFixed(0)} ms, move ${median(moves).toFixed(0)} ms, refresh ${median(refreshes).toFixed(0)} ms`);
    return {
      'ipc.listMs': median(lists),
      'move.ms': median(moves),
      'renameFolder.ms': median(renames),
      'refresh.ms': median(refreshes),
    };
  } catch (error) {
    editor.kill();
    throw error;
  }
}

interface Prepared {
  readonly project: string;
  readonly subject: Subject;
  readonly bytes: { readonly list: number; readonly move: number; readonly renameFolder: number; readonly refresh: number };
}

function decodePrepared(value: unknown): Prepared {
  if (!isRecord(value)) throw new Error('not a subject');
  const subject = recordAt(value, 'subject');
  const bytes = recordAt(value, 'bytes');
  return {
    project: stringAt(value, 'project'),
    subject: { asset: stringAt(subject, 'asset'), to: stringAt(subject, 'to'), folder: stringAt(subject, 'folder') },
    bytes: {
      list: numberAt(bytes, 'list'),
      move: numberAt(bytes, 'move'),
      renameFolder: numberAt(bytes, 'renameFolder'),
      refresh: numberAt(bytes, 'refresh'),
    },
  };
}

export async function assetsScenario(context: ScenarioContext): Promise<ScenarioResult> {
  const ready = await prepared(
    context,
    'S5',
    async (folder) => {
      const project = await writeAssetsProject(folder);
      const [first] = assetTextures(ASSETS);
      if (first === undefined) throw new Error('the assets recipe has no texture');
      const subject: Subject = { asset: first.path, to: 'textures/pack-01', folder: 'textures/pack-02' };
      const bytes = await ipcBytes(project, subject);
      await measureEditor(context, project, subject, 'S5-warmup');
      return { project, subject, bytes };
    },
    decodePrepared,
  );
  try {
    const launches: Record<string, number>[] = [];
    for (let n = 1; n <= context.launches; n += 1) {
      const scan = await scanTimings(ready.project);
      const editor = await measureEditor(context, ready.project, ready.subject, `S5-${n}`);
      launches.push({
        'node.scanWarmMs': scan.warm,
        'node.scanColdMs': scan.cold,
        'ipc.listBytes': ready.bytes.list,
        'move.bytes': ready.bytes.move,
        'renameFolder.bytes': ready.bytes.renameFolder,
        'refresh.bytes': ready.bytes.refresh,
        ...editor,
      });
    }
    return { metrics: metricsOf(METRICS, launches), window: null, notes: [] };
  } finally {
    await finished(context, 'S5');
  }
}
