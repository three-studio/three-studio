/**
 * `scanAssets` on its own, outside Electron, with and without its index.
 *
 * Bundle it and run it — esbuild is already a dependency, and nothing here
 * touches `electron`, which is the whole reason this is possible:
 *
 * ```bash
 * npx esbuild docs/chantier/baseline/scan-direct.ts \
 *   --bundle --format=esm --platform=node --packages=external \
 *   --outfile=/tmp/scan-direct.mjs
 * node /tmp/scan-direct.mjs <project-dir>
 * ```
 *
 * **Why this exists beside `measure-assets.js`.** That one times a scan the way
 * the Project panel pays for it — across IPC, from the renderer — which is the
 * honest number for "what does a rename cost the author". It is not the number
 * for "what does the index save", because it carries the process boundary and a
 * manifest of every asset in the project with it. This one is the scan alone, so
 * the difference between the two is the bridge, and both can be acted on
 * separately. Run them on the same project or the comparison says nothing.
 *
 * It deletes `.studio/assets.index.json` between readings, which is the one
 * thing a renderer cannot do and the only way to measure a scan that has no
 * index rather than one whose entries all miss.
 *
 * Not type-checked: `docs/` is outside the root tsconfig's `include`. It is a
 * measurement script, and the moment it stops resolving `scanAssets` is the
 * moment someone runs it.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scanAssets } from '../../../apps/desktop/src/main/assetScan';

const project = process.argv[2];
if (!project) {
  console.error('usage: node scan-direct.mjs <project-dir>');
  process.exit(1);
}

const indexFile = join(project, '.studio', 'assets.index.json');

const time = async (run: () => Promise<unknown>): Promise<number> => {
  const started = performance.now();
  await run();
  return Math.round((performance.now() - started) * 10) / 10;
};

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!;

// Warm first. The index has to exist and the OS page cache has to hold the
// sidecars, because that is the state the editor scans in — a first reading on a
// cold cache measures the disk, not the code.
await scanAssets(project);

const warm: number[] = [];
for (let i = 0; i < 5; i++) warm.push(await time(() => scanAssets(project)));

// Two rounds of "no index at all", each followed by a warm one, so the pair is
// read twice rather than once.
const noIndex: number[] = [];
const warmAfter: number[] = [];
for (let i = 0; i < 2; i++) {
  await rm(indexFile, { force: true });
  noIndex.push(await time(() => scanAssets(project)));
  warmAfter.push(await time(() => scanAssets(project)));
}

const manifest = await scanAssets(project);

console.log(
  JSON.stringify(
    {
      assets: manifest.assets.length,
      folders: manifest.folders.length,
      warm,
      warmMedian: median(warm),
      noIndex,
      warmAfter,
    },
    null,
    2,
  ),
);
