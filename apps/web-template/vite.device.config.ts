import { defineConfig } from 'vite';
import { workspaceAliases } from '../../workspace-aliases';

/*
 * The device client, built apart from the player.
 *
 * Into a folder of its own, never into `dist/`: that folder is what an export
 * copies, and a game someone publishes must not carry a script that reports
 * to an editor. The device server adds this one to the pages it serves, in
 * memory.
 *
 * One classic script, without a chunk or a global of its own: the server puts
 * it first in `<head>`, where it runs before the player's deferred module and
 * hears everything the player says. `es2020`, since a phone's browser may be
 * older than the desktop's that the player targets, and this script has to
 * run wherever the page at least loads.
 */
export default defineConfig({
  resolve: {
    alias: [...workspaceAliases],
  },
  // `public/` holds the player's icon, which would otherwise land beside the
  // client.
  publicDir: false,
  build: {
    outDir: 'dist-device',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: 'src/device/main.ts',
      output: {
        format: 'iife',
        entryFileNames: 'client.js',
        inlineDynamicImports: true,
      },
    },
  },
});
