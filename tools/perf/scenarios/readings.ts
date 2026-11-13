import { writeFile } from 'node:fs/promises';
import { type CdpSession, recordAt, runInPage } from '../launch/cdp';
import type { EditorExit, LaunchMode } from '../launch/electron';
import { canvasImage } from '../page/editor';
import { waitFrames } from '../page/frames';
import {
  type AllocationSite,
  decodeProfileNode,
  heaviestSites,
  loadMaps,
  locatorFrom,
  sampledBytes,
  urlsOf,
} from '../report/allocations';
import { heapOf } from '../report/results';

/*
 * Readings taken over CDP rather than in the page, which several scenarios
 * share.
 */

/** JS memory after two full collections: what is held, not what is waiting to be collected. */
export async function heapReading(
  session: CdpSession,
): Promise<{ heapBytes: number; heapUsedBytes: number; heapBackingBytes: number }> {
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  return heapOf(await session.send('Runtime.getHeapUsage'));
}

/**
 * What `frames` frames allocate, and the five source lines that allocated most.
 *
 * Sampled every 1 024 bytes, with the two flags that keep what was collected:
 * a frame's allocations are garbage by the next one, and without them the
 * profile counts only what survived. A window of its own, never during frame
 * timings: the sampler costs the frames it watches.
 */
export async function allocationsOver(
  session: CdpSession,
  frames: number,
  repo: string,
): Promise<{ bytesPerFrame: number; sites: AllocationSite[] }> {
  await session.send('HeapProfiler.startSampling', {
    samplingInterval: 1024,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await runInPage(session, waitFrames, frames);
  const head = decodeProfileNode(recordAt(await session.send('HeapProfiler.stopSampling'), 'profile')['head']);
  const maps = await loadMaps(urlsOf(head));
  return { bytesPerFrame: sampledBytes(head) / frames, sites: heaviestSites(head, 5, locatorFrom(repo, maps)) };
}

/**
 * Writes what a view shows to `path`. A displayed launch is captured by the
 * compositor, the whole window; in an uncapped one the compositor never
 * answers, and the view's canvas is read instead.
 */
export async function captureView(session: CdpSession, view: 'edit' | 'game', mode: LaunchMode, path: string): Promise<void> {
  if (mode === 'display') {
    const shot = await session.send('Page.captureScreenshot', { format: 'png' }, 20_000);
    const data = shot['data'];
    if (typeof data === 'string') await writeFile(path, Buffer.from(data, 'base64'));
    return;
  }
  const url = await runInPage(session, canvasImage, view);
  if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) {
    await writeFile(path, Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
  }
}

/**
 * Refuses a launch whose numbers cannot be trusted: one that did not exit
 * cleanly, that printed a renderer error, or whose GPU process died beyond the
 * one start an uncapped launch costs (see `EditorExit.gpuProcessCrashes`).
 */
export function checkExit(label: string, mode: LaunchMode, exit: EditorExit): void {
  const allowed = mode === 'uncapped' ? 1 : 0;
  if (exit.code !== 0) throw new Error(`${label} exited ${String(exit.code)}`);
  if (exit.rendererErrors !== 'none') throw new Error(`${label} printed renderer errors: ${exit.rendererErrors}`);
  if (exit.gpuProcessCrashes > allowed) throw new Error(`${label}: the GPU process died ${exit.gpuProcessCrashes} times`);
}
