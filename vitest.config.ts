import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * Same mapping as the `paths` in tsconfig.base.json. The packages' own `exports`
 * point at a built `dist/`, which is a publishing artefact: a test run must never
 * depend on whether someone happened to build it.
 */
const workspaceAliases = ['core', 'runtime', 'editor'].flatMap((name) => [
  {
    find: new RegExp(`^@three-studio/${name}$`),
    replacement: fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  },
  {
    find: new RegExp(`^@three-studio/${name}/(.*)$`),
    replacement: fileURLToPath(new URL(`./packages/${name}/src/`, import.meta.url)) + '$1',
  },
]);

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
