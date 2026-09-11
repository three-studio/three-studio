import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import {
  WORKSPACE_PACKAGES,
  threeWebgpuAlias,
  workspaceAliases,
} from '../../workspace-aliases';

/*
 * The workspace packages are bundled rather than externalized, which is also
 * why Vite has to be allowed to serve files from outside apps/desktop — hence
 * this. The mapping itself lives in `workspace-aliases.ts`, next to the reason.
 */
const monorepoRoot = resolve(__dirname, '../..');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    resolve: { alias: workspaceAliases },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    resolve: { alias: workspaceAliases },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        ...workspaceAliases,
        { find: '@', replacement: resolve(__dirname, 'src/renderer/src') },
        threeWebgpuAlias,
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
