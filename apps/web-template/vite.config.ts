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
    /*
     * `player/`, which says what it holds to whoever opens the folder.
     *
     * Not `assets/`, which is where the exporter puts the project's own files:
     * two things writing into one directory is a collision waiting for the
     * first texture named like a chunk.
     *
     * And no leading underscore, which it had: GitHub Pages runs Jekyll, which
     * leaves out every path starting with `_`. The page deployed, loaded, and
     * 404'd on its own player unless the author knew to add a `.nojekyll`.
     */
    assetsDir: 'player',
    rollupOptions: {
      output: {
        // Named for a person reading the folder: both chunks used to be called
        // `index-<hash>.js`, one for the entry and one for nipplejs's own
        // `index.js`.
        entryFileNames: 'player/main.[hash].js',
        chunkFileNames: 'player/[name].[hash].js',
        assetFileNames: 'player/[name].[hash][extname]',
        // Hex, the alphabet the exporter names the project's files in: no two
        // names that differ only by case, which a case-blind volume would store
        // as one file.
        hashCharacters: 'hex',
        // The touch sticks, loaded on the first touch and not before: a chunk
        // of their own, under a name that says so.
        manualChunks: { touch: ['nipplejs'] },
      },
    },
  },
});
