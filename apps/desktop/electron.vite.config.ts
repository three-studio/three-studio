import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const monorepoRoot = resolve(__dirname, '../..');

/**
 * Workspace packages are consumed as TypeScript *source*. So they must be bundled
 * rather than externalized, and Vite must be allowed to serve files from outside
 * apps/desktop.
 *
 * The build step those packages do have exists only for npm: their `exports` point
 * at a `dist/` that is a publishing artefact, absent on a fresh clone and stale the
 * moment anyone edits a source file. These aliases mirror the `paths` in
 * tsconfig.base.json so Vite resolves the same files the typechecker does.
 */
const workspaceNames = ['core', 'runtime', 'editor'];
const workspacePackages = workspaceNames.map((name) => `@three-studio/${name}`);
const workspaceAliases = workspaceNames.flatMap((name) => [
  {
    find: new RegExp(`^@three-studio/${name}$`),
    replacement: resolve(monorepoRoot, `packages/${name}/src/index.ts`),
  },
  {
    find: new RegExp(`^@three-studio/${name}/(.*)$`),
    replacement: resolve(monorepoRoot, `packages/${name}/src/$1`),
  },
]);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias: workspaceAliases },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias: workspaceAliases },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        ...workspaceAliases,
        { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
        // three's addons import the bare `three` specifier while our code imports
        // `three/webgpu`. Without this the bundle would contain two copies of the
        // library and `instanceof` checks across the boundary would fail.
        // Anchored so `three/addons/*` still resolves normally.
        { find: /^three$/, replacement: 'three/webgpu' },
      ],
    },
    server: {
      fs: { allow: [monorepoRoot] },
    },
    build: {
      // electron-vite leaves the renderer unminified by default. three.js alone
      // makes that a multi-megabyte parse on every cold start.
      minify: 'esbuild',
      sourcemap: true,
      chunkSizeWarningLimit: 4096,
    },
  },
});
