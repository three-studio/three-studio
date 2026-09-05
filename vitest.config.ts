import { defineConfig } from 'vitest/config';
import { threeWebgpuAlias, workspaceAliases } from './workspace-aliases';

export default defineConfig({
  // `three` included, which it was not: the two Vite configs aliased it and
  // this one did not, so the tests were the one place running against a second
  // copy of the library. See `workspace-aliases.ts`.
  resolve: { alias: [...workspaceAliases, threeWebgpuAlias] },
  test: {
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
