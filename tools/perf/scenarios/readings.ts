import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CdpSession, decodeNumberList, decodeNumbers, recordAt, runInPage } from '../launch/cdp';
import { launchChrome } from '../launch/chrome';
import type { EditorExit, LaunchMode } from '../launch/electron';
import { canvasImage } from '../page/editor';
import { animationFrames, waitFrames } from '../page/frames';
import { listenForPlayer, pageSize, playerCounts, playerShown, settlePlayer } from '../page/player';
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
import { longestInside } from '../report/stats';
import type { ScenarioContext } from './context';

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

const BUILD_ALLOCATION_FRAMES = 300;

/**
 * An exported build in a fresh Chrome: the first frame a person sees after
 * Play, from navigation; the longest task before it; what the game draws and
 * holds; and, when asked, what a frame allocates. Metric names unprefixed: the
 * scenario places them.
 */
export async function measureBuild(
  context: ScenarioContext,
  url: string,
  label: string,
  options: { readonly allocations: boolean },
): Promise<{ metrics: Record<string, number>; window: Record<string, number>; notes: string[] }> {
  const chrome = await launchChrome(context.runDir);
  try {
    // In place before the build's first byte: it hears the player announce
    // itself, presses Play, and stamps the first frame after.
    await chrome.session.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${listenForPlayer.toString()})();` });
    await chrome.session.send('Page.navigate', { url });
    const shown = decodeNumbers(await runInPage(chrome.session, playerShown, undefined, 600_000));
    const firstFrameMs = shown['firstFrameAt'] ?? Number.NaN;
    const longest = longestInside(decodeNumberList(await runInPage(chrome.session, animationFrames, undefined)), {
      from: 0,
      to: firstFrameMs,
    });
    await runInPage(chrome.session, settlePlayer, 30, 120_000);
    const window = decodeNumbers(await runInPage(chrome.session, pageSize, undefined));
    const counts = decodeNumbers(await runInPage(chrome.session, playerCounts, undefined));
    const heap = await heapReading(chrome.session);
    const metrics: Record<string, number> = { firstFrameMs, longestTaskMs: longest.longestMs, ...counts, ...heap };
    let notes: string[] = [];
    if (options.allocations) {
      const allocations = await allocationsOver(chrome.session, BUILD_ALLOCATION_FRAMES, context.repo);
      metrics['allocBytesPerFrame'] = allocations.bytesPerFrame;
      notes = allocations.sites.map(
        (site) => `${(site.bytes / BUILD_ALLOCATION_FRAMES).toFixed(0)} B/frame at ${site.where.replace(url, '')}`,
      );
    }
    if (context.shots !== null) await captureView(chrome.session, 'game', 'display', join(context.shots, `${label}.png`));
    if (chrome.errors.length > 0) throw new Error(`${label}: the page logged errors: ${chrome.errors.join(' | ')}`);
    context.say(`${label}: first frame at ${firstFrameMs.toFixed(0)} ms, longest task ${longest.longestMs.toFixed(0)} ms`);
    return { metrics, window, notes };
  } finally {
    await chrome.close();
  }
}

/** What a reading answers when the driver arrived after what it measures had happened. */
export const MISSED_START = 'missed start';

/**
 * Runs `attempt` until it gives a reading, twice at most. A first-frame
 * reading needs the driver in the page before the frame: one that arrived
 * after is refused and its launch made again, and a second miss is a failure —
 * something then draws faster than the driver attaches, which the harness has
 * to learn about rather than retry around.
 */
export async function readTwiceAtMost<T>(
  label: string,
  attempt: (number: number) => Promise<T | typeof MISSED_START>,
): Promise<T> {
  for (let number = 1; number <= 2; number += 1) {
    const reading = await attempt(number);
    if (reading !== MISSED_START) return reading;
  }
  throw new Error(`${label}: the driver arrived after the first frame, twice`);
}

/**
 * Reads every file of an export once, so the system holds them in memory
 * before the first measured launch. The editor's launches have a warm-up for
 * this; a Chrome launch has none — its fresh profile is the first visit it
 * measures — and without this the first launch of a 331 MB build read the
 * disk: 4.2 s to its first frame, then 2.2 and 1.8.
 */
export async function warmFiles(folder: string): Promise<void> {
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) await readFile(join(entry.parentPath, entry.name));
  }
}

/**
 * Refuses launches that did not see one window. A frame's work, a first
 * frame's and the GPU memory all follow the pixels, and a window on another
 * screen is another amount of work: those launches cannot share a median.
 */
export function oneWindow(label: string, windows: readonly Readonly<Record<string, number>>[]): Readonly<Record<string, number>> | null {
  const [first] = windows;
  if (first === undefined) return null;
  const shape = JSON.stringify(first);
  const other = windows.find((window) => JSON.stringify(window) !== shape);
  if (other !== undefined) throw new Error(`${label}: the launches saw ${shape} and ${JSON.stringify(other)}`);
  return first;
}

/** What a folder and everything in it weigh on disk, in bytes. */
export async function folderBytes(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await folderBytes(join(path, entry));
  return total;
}
