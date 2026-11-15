import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { threeWebgpuAlias, workspaceAliases } from '../../workspace-aliases';

/*
 * The harness itself, which `npm run perf` runs — not `npm test`, which runs
 * its unit tests in `test/` with everything else. A run launches the
 * production editor some thirty times, so it gets a worker of its own, one
 * scenario after another, and timeouts in minutes.
 */
export default defineConfig({
  // The repository, so the workspace aliases and every path a scenario names
  // resolve exactly as they do in `npm test`.
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: [...workspaceAliases, threeWebgpuAlias] },
  test: {
    include: ['tools/perf/run.ts'],
    environment: 'node',
    // Two scenarios at once would measure each other.
    fileParallelism: false,
    testTimeout: 30 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
