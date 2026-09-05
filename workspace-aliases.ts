import { fileURLToPath } from 'node:url';

/*
 * Where every bundler in this repo is told to find the workspace packages.
 *
 * This mapping used to be written out four times — in `vitest.config.ts`, in
 * both Vite configs, and in `tsconfig.base.json` — and it had already drifted:
 * `three -> three/webgpu` was in the two Vite configs and missing from the
 * Vitest one, so every test ran against a copy of three the product never
 * loads, and an `instanceof` across that boundary proved nothing.
 *
 * `tsconfig.base.json` keeps its own copy, because it is JSON that TypeScript
 * reads long before anything here could run. `test/workspaceAliases.test.ts`
 * compares the two and fails when they part company again.
 */

export const WORKSPACE_PACKAGE_NAMES = ['core', 'runtime', 'editor'] as const;

/** The published names, for anything that has to name the packages themselves. */
export const WORKSPACE_PACKAGES = WORKSPACE_PACKAGE_NAMES.map((name) => `@three-studio/${name}`);

/** Absolute path to a package's `src/`, with a trailing separator. */
function packageSrc(name: string): string {
  return fileURLToPath(new URL(`./packages/${name}/src/`, import.meta.url));
}

/*
 * The packages are consumed as TypeScript *source*, so they must be bundled
 * rather than externalized. The build step they do have exists only for npm:
 * their `exports` point at a `dist/` that is a publishing artefact — absent on
 * a fresh clone, and stale the moment anyone edits a source file. A test run or
 * a dev server must never depend on whether someone happened to build it.
 */
export const workspaceAliases = WORKSPACE_PACKAGE_NAMES.flatMap((name) => [
  {
    find: new RegExp(`^@three-studio/${name}$`),
    replacement: `${packageSrc(name)}index.ts`,
  },
  {
    find: new RegExp(`^@three-studio/${name}/(.*)$`),
    replacement: `${packageSrc(name)}$1`,
  },
]);

/*
 * three's addons import the bare `three` specifier while our code imports
 * `three/webgpu`. Without this there are two copies of the library in play and
 * `instanceof` checks across the boundary fail. Anchored so `three/addons/*`
 * still resolves normally.
 *
 * Separate from the workspace aliases because it belongs only where three is
 * actually loaded — the renderer, the web template, and the tests. Electron's
 * main and preload processes never touch it.
 */
export const threeWebgpuAlias = { find: /^three$/, replacement: 'three/webgpu' };

/**
 * The same mapping in `tsconfig.base.json`'s shape: relative to this file, which
 * is where TypeScript resolves `paths` from now that `baseUrl` is gone.
 */
export const WORKSPACE_TSCONFIG_PATHS: Record<string, string[]> = Object.fromEntries(
  WORKSPACE_PACKAGE_NAMES.flatMap((name) => [
    [`@three-studio/${name}`, [`./packages/${name}/src/index.ts`]],
    [`@three-studio/${name}/*`, [`./packages/${name}/src/*`]],
  ]),
);
