import { describe, expect, it } from 'vitest';
import { SourceMap } from 'node:module';
import {
  decodeProfileNode,
  decodeSourceMap,
  heaviestSites,
  locatorFrom,
  sampledBytes,
} from '../report/allocations';

/*
 * What a frame allocates, and where. V8's sampling profile names a bundle's
 * line and column; the renderer bundle's source map turns that into the file
 * that wrote the allocation. Held here on a profile and a map made by hand.
 */

const BUNDLE = 'file:///repo/apps/desktop/out/renderer/assets/index-abc.js';
const MAP_DIR = '/repo/apps/desktop/out/renderer/assets';

/**
 * Line 0: column 0 maps to `viewport.ts`, line 4 (0-based); column 10 to
 * `info.ts`, line 9. Written in base64 VLQ by hand: `AAIE` is 0, 0, +4, +2 and
 * `UCKF` is +10, +1, +5, -2.
 */
const MAP: unknown = {
  version: 3,
  sources: ['../../../../../packages/editor/src/viewport.ts', '../../../../../node_modules/three/src/info.ts'],
  names: [],
  mappings: 'AAIE,UCKF',
};

const node = (
  functionName: string,
  url: string,
  columnNumber: number,
  selfSize: number,
  children: unknown[] = [],
): unknown => ({ callFrame: { functionName, url, lineNumber: 0, columnNumber }, selfSize, children });

const PROFILE: unknown = node('(root)', '', 0, 0, [
  node('tick', BUNDLE, 2, 3000, [node('reportStats', BUNDLE, 12, 500)]),
  node('draw', BUNDLE, 4, 1000),
  node('(garbage collector)', '', 0, 200),
  // A builtin allocating for its caller: what it allocated is the caller's.
  node('update', BUNDLE, 15, 4000, [node('sort', '', 0, 300)]),
]);

describe('a sampling profile', () => {
  it('is decoded node by node, and refused when it is not one', () => {
    const head = decodeProfileNode(PROFILE);
    expect(head.children).toHaveLength(4);
    expect(head.children[0]?.children[0]?.functionName).toBe('reportStats');
    expect(() => decodeProfileNode({ callFrame: {}, selfSize: 1 })).toThrow();
  });

  it('sums every byte it sampled', () => {
    expect(sampledBytes(decodeProfileNode(PROFILE))).toBe(9000);
  });
});

describe('the heaviest sites', () => {
  const map = new SourceMap(decodeSourceMap(MAP));
  const locate = locatorFrom('/repo', new Map([[BUNDLE, { map, directory: MAP_DIR }]]));

  it('names the source line a bundle position comes from, merging what lands on one line', () => {
    // Columns 2 and 4 both fall in the segment that starts at 0: viewport.ts:5.
    // Columns 12 and 15 in the one that starts at 10: info.ts:10, with the
    // builtin `sort` that `update` called. The collector has no caller.
    expect(heaviestSites(decodeProfileNode(PROFILE), 5, locate)).toEqual([
      { where: 'node_modules/three/src/info.ts:10 (reportStats, sort, update)', bytes: 4800 },
      { where: 'packages/editor/src/viewport.ts:5 (draw, tick)', bytes: 4000 },
      { where: '(garbage collector)', bytes: 200 },
    ]);
  });

  it('takes a function’s name from the map when the map knows it', () => {
    // The production bundle is minified: V8 names `tick` something like `HS`.
    const named = new SourceMap(
      decodeSourceMap({ version: 3, sources: ['../../../../../packages/editor/src/viewport.ts'], names: ['tick'], mappings: 'AAIEA' }),
    );
    const located = locatorFrom('/repo', new Map([[BUNDLE, { map: named, directory: MAP_DIR }]]));
    const head = decodeProfileNode(node('(root)', '', 0, 0, [node('HS', BUNDLE, 0, 100)]));
    expect(heaviestSites(head, 5, located)).toEqual([{ where: 'packages/editor/src/viewport.ts:5 (tick)', bytes: 100 }]);
  });

  it('keeps only as many as asked for', () => {
    expect(heaviestSites(decodeProfileNode(PROFILE), 1, locate)).toHaveLength(1);
  });

  it('refuses a map that is not version 3', () => {
    expect(() => decodeSourceMap({ version: 2, sources: [], mappings: '' })).toThrow();
  });
});
