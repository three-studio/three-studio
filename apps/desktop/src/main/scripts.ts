import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CACHE_DIR,
  SCRIPT_API_VERSION,
  type AssetEntry,
  type ScriptBuildResult,
} from '@three-studio/core';
import { build, type Message } from 'esbuild';
import { scanAssets } from './assets';
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
export const registerScript = api.registerScript;
export default api;
`;

/**
 * Compiles every script asset in the project into one ES module.
 *
 * A generated entry file imports each script and registers it against its asset
 * id, so the runtime resolves a `script` component without knowing anything
 * about how the code was built.
 */
/**
 * Fingerprint of the script sources, so an unchanged project rebuilds nothing.
 *
 * Play compiles every time, which is what makes "edit, press Play" the whole
 * loop — but running esbuild and re-importing the bundle on a project nobody
 * has touched is pure latency on every single Play.
 */
let lastBuild: { projectPath: string; signature: string; result: ScriptBuildResult } | null = null;

export async function buildScripts(projectPath: string): Promise<ScriptBuildResult> {
  const manifest = await scanAssets(projectPath);
  const scripts = manifest.assets.filter((asset) => asset.kind === 'script');

  const signature = scripts
    .map((script) => `${script.path}:${script.sizeBytes}:${script.modifiedAt}`)
    .sort()
    .join('|');

  if (lastBuild && lastBuild.projectPath === projectPath && lastBuild.signature === signature) {
    return { ...lastBuild.result, unchanged: true };
  }

  const cacheDir = join(projectPath, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });

  const shimPath = join(cacheDir, 'studio-runtime-shim.mjs');
  await writeFile(shimPath, SHIM_SOURCE, 'utf8');

  const remember = (result: ScriptBuildResult): ScriptBuildResult => {
    // A failed build is cached too, so a broken file does not re-run esbuild on
    // every Play just to produce the same error.
    lastBuild = { projectPath, signature, result };
    return result;
  };

  if (scripts.length === 0) {
    return remember({ code: 'export {};\n', errors: [], warnings: [], scriptCount: 0 });
  }

  const entryPath = join(cacheDir, 'script-entry.mjs');
  await writeFile(entryPath, generateEntry(projectPath, scripts), 'utf8');

  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      sourcemap: 'inline',
      logLevel: 'silent',
      // Scripts are authored in TypeScript; types are stripped, not checked.
      // Type errors surface in the editor's own typecheck, not at play time.
      loader: { '.ts': 'ts', '.js': 'js' },
      alias: { '@three-studio/runtime': shimPath },
    });

    return remember({
      code: result.outputFiles[0]?.text ?? 'export {};\n',
      errors: [],
      warnings: result.warnings.map(formatMessage),
      scriptCount: scripts.length,
    });
  } catch (cause) {
    const failure = cause as { errors?: Message[] };
    const errors = failure.errors?.map(formatMessage) ?? [
      cause instanceof Error ? cause.message : String(cause),
    ];
    return remember({ code: 'export {};\n', errors, warnings: [], scriptCount: scripts.length });
  }
}

function generateEntry(projectPath: string, scripts: readonly AssetEntry[]): string {
  const lines = [`import { registerScript } from '@three-studio/runtime';`];

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

  scripts.forEach((script, index) => {
    lines.push(
      `if (typeof module${index}.default === 'function') registerScript(${JSON.stringify(script.id)}, module${index}.default);`,
    );
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Type declarations for `@three-studio/runtime` as scripts see it, written into the
 * project so an external editor gives autocompletion and type errors.
 *
 * Unity generates a .csproj for the same reason: without it a user script is
 * just untyped text, and the editor is the only place any mistake shows up.
 */
const RUNTIME_DTS = `// Generated by Three Studio. Do not edit.
declare module '@three-studio/runtime' {
  export type ScriptPropertyDef =
    | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
    | { type: 'boolean'; default?: boolean; label?: string }
    | { type: 'string'; default?: string; label?: string }
    | { type: 'color'; default?: string; label?: string }
    | { type: 'vec3'; default?: [number, number, number]; label?: string }
    | { type: 'enum'; options: readonly string[]; default?: string; label?: string }
    | { type: 'entity'; label?: string }
    | { type: 'asset'; kind?: string; label?: string };

  export interface EntityHandle {
    readonly id: string;
    readonly name: string;
    readonly object: any;
  }

  export interface StudioInput {
    isDown(code: string): boolean;
    isAnyDown(...codes: string[]): boolean;
    readonly pointerLocked: boolean;
    consumeMouseDelta(): { x: number; y: number };
    consumeWheel(): number;
  }

  export type AudioBus = 'master' | 'music' | 'sfx' | 'ui' | 'ambience';

  /** A playing sound. Every method is safe to call after it has finished. */
  export interface AudioVoice {
    readonly state: 'pending' | 'playing' | 'paused' | 'stopped' | 'failed';
    /** Seconds advanced through the clip, loops included. */
    readonly elapsed: number;
    stop(fadeOut?: number): void;
    pause(): void;
    resume(): void;
    setVolume(volume: number, ramp?: number): void;
    setPitch(pitch: number, detune?: number): void;
    /** \`'ended'\` covers every way a sound can finish. Returns an unsubscribe. */
    on(event: 'started' | 'ended' | 'failed', listener: () => void): () => void;
  }

  export interface AudioClipOptions {
    bus?: AudioBus;
    volume?: number;
    pitch?: number;
    detune?: number;
    loop?: boolean;
    startOffset?: number;
    delay?: number;
    fadeIn?: number;
    /** 0 is the highest. Decides who is dropped when too many sounds play. */
    priority?: number;
  }

  export interface StudioAudio {
    /**
     * Plays the Audio Source on an entity, with everything the Inspector says
     * about it. Leaving \`target\` out means this script's own entity.
     *
     * A source that is already playing restarts rather than doubling up.
     */
    play(target?: string): AudioVoice | null;
    stop(target?: string, fadeOut?: number): void;
    pause(target?: string): void;
    resume(target?: string): void;
    restart(target?: string): void;
    setVolume(target: string | undefined, volume: number, ramp?: number): void;
    setPitch(target: string | undefined, pitch: number, detune?: number): void;

    /** A one-shot with no component behind it — an explosion, a UI click. */
    playClip(assetId: string, options?: AudioClipOptions): AudioVoice | null;

    bus(name: AudioBus): { volume: number; mute: boolean; solo: boolean } | undefined;
    setBusVolume(name: AudioBus, volume: number): void;
    setBusMute(name: AudioBus, mute: boolean): void;
    setMasterVolume(volume: number): void;
    stopAll(fadeOut?: number): void;
  }

  export abstract class Behaviour {
    /** Editable in the Inspector, saved per instance with the scene. */
    static properties: Record<string, ScriptPropertyDef>;

    /** The entity this script is attached to. */
    readonly entity: { id: string; name: string };
    /** Its three.js object. Mutate \`position\`, \`rotation\`, \`scale\` to move it. */
    readonly transform: any;
    readonly input: StudioInput;
    /** This entity's sounds, one-shot clips, and the buses. */
    readonly audio: StudioAudio;
    /** Seconds since play started. */
    time: number;

    /** Set this script up alone. Other entities may not exist yet. */
    onAwake?(): void;
    /** Every script now exists. Cross-references belong here. */
    onStart?(): void;
    /** Once per displayed frame. */
    onUpdate?(delta: number): void;
    /** Once per physics tick. Anything commanding a body belongs here. */
    onFixedUpdate?(step: number): void;
    /** After physics. Anything following a subject belongs here. */
    onLateUpdate?(): void;
    onDestroy?(): void;

    protected resolve(entityId: string | null | undefined): EntityHandle | null;
    protected log(...args: unknown[]): void;
    /** setTimeout tied to this script's lifetime. */
    protected wait(callback: () => void, ms: number): void;
    /** setInterval tied to this script's lifetime; returns a canceller. */
    protected repeat(callback: () => void, ms: number): () => void;
  }
}
`;

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

/** Written on project open so scripts are typed in whatever editor is used. */
export async function writeScriptTypings(projectPath: string): Promise<void> {
  const cacheDir = join(projectPath, CACHE_DIR);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'studio-runtime.d.ts'), RUNTIME_DTS, 'utf8');
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
  const safeName = name.replace(/[^A-Za-z0-9_]/g, '') || 'NewScript';
  const relative = `assets/scripts/${safeName}.ts`;
  const target = resolveInside(projectPath, relative);

  await mkdir(join(projectPath, 'assets', 'scripts'), { recursive: true });
  // `wx` fails rather than overwriting: a script is the user's own code.
  await writeFile(target, TEMPLATE.replaceAll('__NAME__', safeName), { encoding: 'utf8', flag: 'wx' });
  return relative;
}

function formatMessage(message: Message): string {
  const where = message.location
    ? `${message.location.file}:${message.location.line}:${message.location.column}`
    : '';
  return where ? `${where} — ${message.text}` : message.text;
}
