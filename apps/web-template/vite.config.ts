import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/*
 * The workspace packages are consumed as TypeScript source, mirroring the `paths`
 * in tsconfig.base.json. Their package `exports` point at a built `dist/` that only
 * exists to be published — absent on a fresh clone, stale as soon as a source file
 * changes.
 */
const workspaceAliases = ['core', 'runtime', 'editor'].flatMap((name) => [
  {
    find: new RegExp(`^@three-studio/${name}$`),
    replacement: fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url)),
  },
  {
    find: new RegExp(`^@three-studio/${name}/(.*)$`),
    replacement: fileURLToPath(new URL(`../../packages/${name}/src/`, import.meta.url)) + '$1',
  },
]);

export default defineConfig({
  // Relative, so the exported folder runs from any path — a subdirectory of a
  // site, or a bare `npx serve` at its root.
  base: './',
  resolve: {
    alias: [
      ...workspaceAliases,
      // three's addons import the bare `three` specifier while our code imports
      // `three/webgpu`. Without this the bundle carries two copies of three and
      // `instanceof` fails across the boundary.
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    // Not `assets/`, which is where the exporter copies the project's own
    // files. Two things writing into one directory is a collision waiting for
    // the first texture named like a chunk.
    assetsDir: '_studio',
  },
});
