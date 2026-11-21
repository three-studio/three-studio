import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CACHE_DIR,
  SCRIPT_API_VERSION,
  isRecord,
  type AssetEntry,
  type CoreRegistries,
  type ScriptBuildResult,
} from '@three-studio/core';
import type { Plugin } from 'esbuild';
import { scanAssets } from './assetScan';
import { atomicWrite } from './atomicWrite';
import { resolveInside } from './paths';

// The shape is defined once, in @three-studio/core, because it crosses the bridge:
// two copies drifting apart is how the build cache field went missing on one
// side and broke the typecheck.
export type { ScriptBuildResult };

/**
 * `@three-studio/runtime` as seen from a user script.
 *
 * The bundle cannot import the real runtime — that would pull a second copy of
 * three.js into it. Instead the host publishes a tiny surface on a global, and
 * this shim re-exports it. One mechanism, identical in the editor and in an
 * exported build; no import map to keep in sync.
 */
const SHIM_SOURCE = `const api = globalThis.__STUDIO_SCRIPT_API__;
if (!api) throw new Error('The studio script API is not available on this page.');
// Baked in when the bundle was compiled, compared against what is running.
if (api.version !== ${SCRIPT_API_VERSION}) {
  throw new Error(
    'These scripts were compiled against version ${SCRIPT_API_VERSION} of the studio API, but version ' +
      api.version +
      ' is running. Rebuild the project\\'s scripts.',
  );
}
export const Behaviour = api.Behaviour;
export default api;
`;

/**
 * Serves `@three-studio/runtime` to the bundle as {@link SHIM_SOURCE}, from
 * memory, as the entry is. Both were files under the project's `.studio/`, and
 * now that every build compiles, every build would rewrite them: two builds of
 * one project at once — Play and a device launch — could each read the other's
 * half-written copy.
 */
const shimPlugin: Plugin = {
  name: 'studio-runtime-shim',
  setup(builder) {
    builder.onResolve({ filter: /^@three-studio\/runtime$/ }, (args) => ({
      path: args.path,
      namespace: 'studio',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'studio' }, () => ({
      contents: SHIM_SOURCE,
      loader: 'js',
    }));
  },
};

/**
 * Where esbuild's install puts its native binary under a `node_modules`: in the
 * package for this platform and architecture, as `esbuild.exe` on Windows.
 *
 * A packaged app has to say so. esbuild finds the binary with `require.resolve`,
 * which answers a path inside `app.asar`, and spawns it from there:
 * electron-builder unpacks the binary to `app.asar.unpacked`, but Electron
 * redirects only `execFile` into it, never `spawn`, so every build failed with
 * `spawn ENOTDIR` and an installed editor compiled no script at all.
 */
export function esbuildBinaryPath(nodeModules: string): string {
  const binary = process.platform === 'win32' ? 'esbuild.exe' : join('bin', 'esbuild');
  return join(nodeModules, '@esbuild', `${process.platform}-${process.arch}`, binary);
}

/**
 * What a bundle is compiled for, which decides what it carries besides the code.
 *
 * - `play`: Play and a device launch, on the author's machine. An inline source
 *   map, so a stack trace and a breakpoint land in the author's TypeScript.
 * - `export`: a build that strangers download. No source map: an inline one
 *   carried every script's source, comments and all, into the published bundle.
 */
export type ScriptBuildPurpose = 'play' | 'export';

/**
 * Compiles every script asset in the project into one ES module, from what is
 * on disk, on every call.
 *
 * A generated entry imports each script and exports it beside its asset id, as
 * `scripts`, so the host resolves a `script` component without knowing anything
 * about how the code was built.
 *
 * There is no cache. The one this replaced was keyed on the script assets'
 * paths, sizes and times, while esbuild also bundles whatever a script imports:
 * after an edit to a `.json` data asset or to a helper outside `assets/`, Play
 * kept running the old code, and since the cache lived in the main process,
 * closing the window did not clear it — only relaunching the app did. All it
 * saved was esbuild's run, measured at 13 ms for 100 files and 50 ms for 350 on
 * an M1 Pro. The renderer still imports nothing when the code is the code it
 * already holds, so an unchanged project keeps its scripts' state and no second
 * copy of the bundle — which rests on the same input compiling to the same
 * text, as esbuild's does.
 */
export async function buildScripts(
  registries: CoreRegistries,
  projectPath: string,
  purpose: ScriptBuildPurpose = 'play',
): Promise<ScriptBuildResult> {
  const manifest = await scanAssets(registries, projectPath);
  const scripts = manifest.assets.filter((asset) => asset.kind === 'script');

  if (scripts.length === 0) {
    return { code: 'export {};\n', errors: [], warnings: [], scriptCount: 0 };
  }

  try {
    // Loaded here rather than at the top of the file: esbuild reads
    // `ESBUILD_BINARY_PATH` once, as it loads, and the main bundle requires its
    // imports before any line of `index.ts` runs — before a packaged app has set
    // it (`esbuildBinaryPath`).
    const { build } = await import('esbuild');
    const result = await build({
      // Left unnamed, so the bundle calls it `<stdin>`. Given a `sourcefile`,
      // esbuild writes it relative to the working directory resolved through
      // symlinks — and a project behind one, as every temp folder on macOS is
      // (`/var` is `/private/var`), put the author's own path into the bundle.
      stdin: { contents: generateEntry(projectPath, scripts), resolveDir: projectPath, loader: 'js' },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      sourcemap: purpose === 'play' ? 'inline' : false,
      // Paths in the bundle's comments are written relative to this. It was
      // the editor's own working directory, so a published bundle opened with
      // `// ../../Users/<the author>/Documents/<the game>/assets/scripts/…`.
      absWorkingDir: projectPath,
      logLevel: 'silent',
      // Scripts are authored in TypeScript; types are stripped, not checked.
      // Type errors surface in the editor's own typecheck, not at play time.
      loader: { '.ts': 'ts', '.js': 'js' },
      plugins: [shimPlugin],
    });

    return {
      code: result.outputFiles[0]?.text ?? 'export {};\n',
      errors: [],
      warnings: result.warnings.map(formatMessage),
      scriptCount: scripts.length,
    };
  } catch (cause) {
    return {
      code: 'export {};\n',
      errors: buildErrorsOf(cause),
      warnings: [],
      scriptCount: scripts.length,
    };
  }
}

/** What a message to the author needs of an esbuild message. esbuild's `Message` is one. */
interface BuildMessage {
  readonly text: string;
  readonly location: { readonly file: string; readonly line: number; readonly column: number } | null;
}

function isBuildMessage(value: unknown): value is BuildMessage {
  if (!isRecord(value) || typeof value['text'] !== 'string') return false;
  const location = value['location'];
  return (
    location === null ||
    (isRecord(location) &&
      typeof location['file'] === 'string' &&
      typeof location['line'] === 'number' &&
      typeof location['column'] === 'number')
  );
}

/**
 * The errors a failed build gives the author. esbuild rejects with an error
 * whose `errors` are its messages; whatever else throws — the service failing to
 * start, a file it could not read — is reported in its own words.
 */
function buildErrorsOf(cause: unknown): string[] {
  const reported = isRecord(cause) ? cause['errors'] : undefined;
  const messages = Array.isArray(reported) ? reported.filter(isBuildMessage) : [];
  if (messages.length > 0) return messages.map(formatMessage);
  return [cause instanceof Error ? cause.message : String(cause)];
}

function generateEntry(projectPath: string, scripts: readonly AssetEntry[]): string {
  const lines: string[] = [];

  scripts.forEach((script, index) => {
    // Paths come from the manifest, but they still go through the guard: a
    // crafted asset path must not pull a file from outside the project into the
    // bundle that then runs in the renderer.
    const absolute = resolveInside(projectPath, script.path);
    // A namespace import rather than a default import, because not every .ts
    // file under assets/scripts is a behaviour. Shared helpers, constants and
    // type-only modules are perfectly ordinary things to write, and a default
    // import of one of those failed the build for *every* script in the
    // project — one helper file and nothing ran.
    lines.push(`import * as module${index} from ${JSON.stringify(absolute)};`);
  });

  // Exported as data, and nothing called: the host decodes the pairs and hands
  // the classes to the world that runs them. A helper's default export, or
  // none, is in the list too, and the decoding drops it.
  const pairs = scripts.map((script, index) => `[${JSON.stringify(script.id)}, module${index}.default]`);
  lines.push(`export const scripts = [${pairs.join(', ')}];`);

  return `${lines.join('\n')}\n`;
}

/**
 * What the editor guarantees, written to `.studio/` on every open so it tracks
 * the editor rather than whatever shipped when the project was created.
 */
const STUDIO_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2023', 'DOM'],
    strict: true,
    noEmit: true,
    allowJs: true,
    skipLibCheck: true,
  },
  include: ['assets/**/*.ts', 'assets/**/*.js', '.studio/studio-runtime.d.ts'],
};

/**
 * What the project gets, once.
 *
 * It only extends ours, so an author can add paths, turn a rule off, or point
 * an editor plugin at it, and the next open will not undo that. The previous
 * version rewrote the whole file every time a project was opened — a
 * customisation survived until the next launch, which is the kind of loss
 * nobody connects to its cause.
 */
const PROJECT_TSCONFIG = { extends: './.studio/tsconfig.json' };

/**
 * The project's TypeScript config, written on open so scripts are typed in
 * whatever editor is used: ours under `.studio/`, and the project's own once.
 */
export async function writeScriptTsconfig(projectPath: string): Promise<void> {
  const cacheDir = join(projectPath, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });
  // Paths are relative to the file that declares them, so what sits one level
  // down has to reach back up for the sources.
  await writeFile(
    join(cacheDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        ...STUDIO_TSCONFIG,
        include: STUDIO_TSCONFIG.include.map((pattern) => `../${pattern}`),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const projectFile = join(projectPath, 'tsconfig.json');
  try {
    await stat(projectFile);
    return; // Already there, and possibly edited. Leave it alone.
  } catch {
    // Absent: write the one-line file that points at ours.
  }
  await writeFile(projectFile, `${JSON.stringify(PROJECT_TSCONFIG, null, 2)}\n`, 'utf8');
}

/**
 * The declaration of `@three-studio/runtime` its scripts see, which the editor
 * window generates from the registries it runs (`scriptTypings`): what each
 * module gives scripts is known there, and this process activates core alone.
 *
 * Whole or not at all, as each window of a project writes it as it opens.
 */
export async function writeScriptTypings(projectPath: string, text: string): Promise<void> {
  const cacheDir = join(projectPath, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });
  await atomicWrite(join(cacheDir, 'studio-runtime.d.ts'), text);
}

/** New scripts start from a template so the shape is obvious from the first one. */
const TEMPLATE = `import { Behaviour } from '@three-studio/runtime';

export default class __NAME__ extends Behaviour {
  /** Shown in the Inspector, and saved per instance with the scene. */
  static properties = {
    speed: { type: 'number', default: 1, min: 0, max: 20, label: 'Speed' },
  };

  speed = 1;

  onStart() {
    this.log('ready');
  }

  /** Once per displayed frame. \`delta\` is in seconds. */
  onUpdate(delta) {
    this.transform.rotation.y += this.speed * delta;
  }
}
`;

export async function createScript(projectPath: string, name: string): Promise<string> {
  // Stricter than `safeFileName`, and for a different reason: the name is also
  // the class name in the template below, so it has to be a TypeScript
  // identifier and not merely something a file system will keep.
  const safeName = name.replace(/[^A-Za-z0-9_]/g, '') || 'NewScript';
  const relative = `assets/scripts/${safeName}.ts`;
  const target = resolveInside(projectPath, relative);

  await mkdir(join(projectPath, 'assets', 'scripts'), { recursive: true });
  // `wx` fails rather than overwriting: a script is the user's own code.
  await writeFile(target, TEMPLATE.replaceAll('__NAME__', safeName), { encoding: 'utf8', flag: 'wx' });
  return relative;
}

function formatMessage(message: BuildMessage): string {
  const where = message.location
    ? `${message.location.file}:${message.location.line}:${message.location.column}`
    : '';
  return where ? `${where} — ${message.text}` : message.text;
}
