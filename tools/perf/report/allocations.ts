import { readFile } from 'node:fs/promises';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@three-studio/core';

/*
 * What a frame allocates, and where, from V8's sampling heap profile.
 *
 * Read with the two flags that keep what was collected, so a frame's garbage
 * counts — garbage is what a per-frame allocation is. The profile names a
 * position in the renderer bundle; the bundle's source map names the file and
 * line that wrote it.
 */

export interface ProfileNode {
  readonly functionName: string;
  readonly url: string;
  /** 0-based, as V8 gives them. */
  readonly lineNumber: number;
  readonly columnNumber: number;
  /** Bytes sampled here, children excluded. */
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}

/** A node of `HeapProfiler.stopSampling`'s `profile.head`, and everything under it. */
export function decodeProfileNode(value: unknown): ProfileNode {
  if (!isRecord(value) || !isRecord(value['callFrame'])) throw new Error('a profile node without its call frame');
  const frame = value['callFrame'];
  const { functionName, url, lineNumber, columnNumber } = frame;
  const { selfSize, children } = value;
  if (
    typeof functionName !== 'string' ||
    typeof url !== 'string' ||
    typeof lineNumber !== 'number' ||
    typeof columnNumber !== 'number' ||
    typeof selfSize !== 'number'
  ) {
    throw new Error('a profile node whose call frame is not one');
  }
  return {
    functionName,
    url,
    lineNumber,
    columnNumber,
    selfSize,
    children: Array.isArray(children) ? children.map((child: unknown) => decodeProfileNode(child)) : [],
  };
}

function* nodesOf(head: ProfileNode): Generator<ProfileNode> {
  for (const { node } of nodesWithCallers(head)) yield node;
}

/**
 * Every node, with the nearest node above it that has a script. A builtin —
 * `sort`, an iterator's `next` — has none of its own, and what it allocates is
 * its caller's doing: that is the line to read.
 */
function* nodesWithCallers(head: ProfileNode): Generator<{ node: ProfileNode; caller: ProfileNode | null }> {
  const pending: { node: ProfileNode; caller: ProfileNode | null }[] = [{ node: head, caller: null }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    yield next;
    const caller = next.node.url === '' ? next.caller : next.node;
    for (const child of next.node.children) pending.push({ node: child, caller });
  }
}

export function sampledBytes(head: ProfileNode): number {
  let total = 0;
  for (const node of nodesOf(head)) total += node.selfSize;
  return total;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item: unknown): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : null;
}

/** A source map file's JSON, checked before Node's `SourceMap` reads it. */
export function decodeSourceMap(value: unknown): SourceMapPayload {
  if (!isRecord(value) || value['version'] !== 3) throw new Error('not a version 3 source map');
  const sources = stringList(value['sources']);
  if (sources === null) throw new Error('a source map whose sources are not strings');
  const mappings = value['mappings'];
  if (typeof mappings !== 'string') throw new Error('a source map without its mappings');
  const names = stringList(value['names']) ?? [];
  return { file: '', version: 3, sourceRoot: '', sources, sourcesContent: [], names, mappings };
}

/**
 * Where a bundle position is in source — `path:line` from the repository, and
 * the original name there when the map has one — or `null` when no map says.
 */
export type Locate = (url: string, line: number, column: number) => { where: string; name: string | null } | null;

export interface LoadedMap {
  readonly map: SourceMap;
  /** What the map's sources are relative to. */
  readonly directory: string;
}

export function locatorFrom(repo: string, maps: ReadonlyMap<string, LoadedMap>): Locate {
  return (url, line, column) => {
    const loaded = maps.get(url);
    if (!loaded) return null;
    const entry = loaded.map.findEntry(line, column);
    if (!('originalSource' in entry)) return null;
    const source = entry.originalSource.startsWith('file://')
      ? fileURLToPath(entry.originalSource)
      : resolve(loaded.directory, entry.originalSource);
    // Node gives the segment's original name, which its typings leave out.
    const name = 'name' in entry && typeof entry.name === 'string' ? entry.name : null;
    return { where: `${relative(repo, source)}:${entry.originalLine + 1}`, name };
  };
}

/** The maps of every bundle a profile names: a `file://` script with a `.map` beside it. */
export async function loadMaps(urls: Iterable<string>): Promise<Map<string, LoadedMap>> {
  const maps = new Map<string, LoadedMap>();
  for (const url of new Set(urls)) {
    if (!url.startsWith('file://') || !url.endsWith('.js')) continue;
    const path = fileURLToPath(url);
    try {
      const payload = decodeSourceMap(JSON.parse(await readFile(`${path}.map`, 'utf8')));
      maps.set(url, { map: new SourceMap(payload), directory: dirname(path) });
    } catch {
      // No map, or one this cannot read: the site keeps its bundle position.
    }
  }
  return maps;
}

export function urlsOf(head: ProfileNode): Set<string> {
  const urls = new Set<string>();
  for (const node of nodesOf(head)) urls.add(node.url);
  return urls;
}

export interface AllocationSite {
  /** The source line, with the functions that allocated there. */
  readonly where: string;
  readonly bytes: number;
}

/**
 * The `count` lines that allocated the most, in source where a map knows the
 * bundle. Positions that map to one line are one site: a bundle splits a line
 * of source into many columns, and the reader asks about the line.
 */
export function heaviestSites(head: ProfileNode, count: number, locate: Locate): AllocationSite[] {
  const sites = new Map<string, { bytes: number; functions: Set<string> }>();
  const nameOf = (node: ProfileNode, mapped: string | null): string =>
    mapped ?? (node.functionName === '' ? '(anonymous)' : node.functionName);
  for (const { node, caller } of nodesWithCallers(head)) {
    if (node.selfSize === 0) continue;
    const owner = node.url === '' ? caller : node;
    const located = owner === null ? null : locate(owner.url, owner.lineNumber, owner.columnNumber);
    const where =
      located?.where ??
      (owner === null ? node.functionName : `${owner.url}:${owner.lineNumber + 1}:${owner.columnNumber + 1}`);
    const site = sites.get(where) ?? { bytes: 0, functions: new Set<string>() };
    site.bytes += node.selfSize;
    if (owner !== null) {
      site.functions.add(nameOf(owner, located?.name ?? null));
      if (owner !== node) site.functions.add(node.functionName);
    }
    sites.set(where, site);
  }
  return [...sites]
    .sort(([, a], [, b]) => b.bytes - a.bytes)
    .slice(0, count)
    .map(([where, site]) => ({
      where: site.functions.size === 0 ? where : `${where} (${[...site.functions].sort().join(', ')})`,
      bytes: site.bytes,
    }));
}
