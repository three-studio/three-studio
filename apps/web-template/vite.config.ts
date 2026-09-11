import { defineConfig } from 'vite';
import { threeWebgpuAlias, workspaceAliases } from '../../workspace-aliases';

export default defineConfig({
  // Relative, so the exported folder runs from any path — a subdirectory of a
  // site, or a bare `npx serve` at its root.
  base: './',
  resolve: {
    alias: [...workspaceAliases, threeWebgpuAlias],
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
