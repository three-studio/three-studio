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
// Type-only, so nothing of the runtime — three included — reaches the main
// process. What is needed is the class's key set, and only the compiler reads it.
import type { BehaviourMember } from '@three-studio/runtime';
import type { Plugin } from 'esbuild';
import { scanAssets } from './assetScan';
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
  // the classes to the engine that runs them. A helper's default export, or
  // none, is in the list too, and the decoding drops it.
  const pairs = scripts.map((script, index) => `[${JSON.stringify(script.id)}, module${index}.default]`);
  lines.push(`export const scripts = [${pairs.join(', ')}];`);

  return `${lines.join('\n')}\n`;
}

/**
 * The types a script may name, as text.
 *
 * A user's project cannot resolve `three` or `@three-studio/core`, so this is
 * not the runtime's own declarations narrowed by a compiler — it is a
 * deliberately smaller contract: `Object3D` becomes `any`, an `EntityDoc`
 * becomes the two fields a script reads off it. Which is exactly why it has to
 * be checked against the real thing rather than trusted; see
 * `apps/desktop/test/scriptTypings.test.ts`, which compiles what this produces
 * against `ScriptApi` and fails on the first divergence. It found two: the
 * property vocabulary was missing `vec2` altogether, and its `vec3` had lost
 * the `min`/`max`/`step` a slider needs.
 */
const PUBLISHED_TYPES = `  export type ScriptPropertyDef =
    | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
    | { type: 'boolean'; default?: boolean; label?: string }
    | { type: 'string'; default?: string; label?: string }
    | { type: 'color'; default?: string; label?: string }
    | { type: 'vec2'; default?: [number, number]; min?: number; max?: number; step?: number; label?: string }
    | { type: 'vec3'; default?: [number, number, number]; min?: number; max?: number; step?: number; label?: string }
    | { type: 'enum'; options: readonly (string | { value: string; label: string })[]; default?: string; label?: string }
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

  /** A scene being fetched. */
  export interface SceneLoadHandle {
    readonly path: string;
    /** 0 to 1 across the assets the scene needs. */
    readonly progress: number;
    /** Settles when it could be shown. */
    readonly ready: Promise<void>;
    readonly activated: boolean;
    /** Shows it, waiting for \`ready\` first if it has to. */
    activate(): Promise<void>;
    cancel(): void;
  }

  /** Moving between scenes. Both take a scene's name or its id. */
  export interface SceneApi {
    /** The running scene's name. Hold its id instead if a rename must not break this. */
    readonly current: string | null;
    /** Starts fetching, without showing. Poll \`progress\`, then \`activate()\`. */
    load(scene: string): SceneLoadHandle;
    /** Fetches and shows, for a transition with nothing to display meanwhile. */
    go(scene: string): Promise<void>;
  }

  /** A point, a direction or a velocity: metres, metres per second. three's \`Vector3\` is one. */
  export interface Vec3Like { x: number; y: number; z: number }
  /** A rotation. three's \`Quaternion\` is one. */
  export interface QuatLike { x: number; y: number; z: number; w: number }

  /**
   * A body in the physics world, in world space: metres, seconds, kilograms, radians.
   *
   * Forces, impulses and velocities move a Dynamic body only: a Kinematic body is moved by
   * its transform, a Fixed one stays put, and a character's by its controller. A vector or
   * a rotation holding a NaN or an infinity is ignored, with the rest of the call.
   */
  export interface StudioBody {
    /** Where the solver holds it, as of the last physics tick. */
    readonly position: Readonly<Vec3Like>;
    /** How the solver has it turned, as of the last physics tick. */
    readonly rotation: Readonly<QuatLike>;
    /** In kilograms: its Rigid Body's Mass. */
    readonly mass: number;
    /** \`false\` holds it out of the world: it touches nothing, and nothing touches it, and its joints hold nothing. */
    enabled: boolean;
    /** Metres per second. Assign a whole vector: \`body.linearVelocity = { x: 0, y: 5, z: 0 }\`. */
    linearVelocity: Readonly<Vec3Like>;
    /** Radians per second, about the world's axes. */
    angularVelocity: Readonly<Vec3Like>;
    /** Pushes it through the next physics tick, in newtons; at a world point \`at\` it turns it too. Call it in onFixedUpdate to push steadily. */
    addForce(force: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
    /** A kick: changes its velocity at once by impulse / mass, in newton-seconds; at a world point \`at\` it turns it too. */
    applyImpulse(impulse: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void;
    /** Turns it through the next physics tick, in newton-metres. */
    addTorque(torque: Readonly<Vec3Like>): void;
    /** Changes its spin at once, in newton-metre-seconds. */
    applyTorqueImpulse(impulse: Readonly<Vec3Like>): void;
    /** Puts it, and its entity, there at once, keeping its velocities. Without a rotation it is moved, not turned. A joint holding it pulls it back: teleport what it is joined to as well. */
    teleport(position: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>): void;
  }

  /** A joint, as of the last physics tick. */
  export interface StudioJoint {
    /** How far it has moved since it was built: a hinge's angle in radians, right-handed about its axis, between -π and π; a slider's offset in metres. 0 for a Fixed or Spring joint. */
    readonly position: number;
    /** Whether its motor drives it. A Fixed or Spring joint has none. */
    motorEnabled: boolean;
    /** Radians per second for a hinge, metres per second for a slider. */
    motorSpeed: number;
    /** The most it pushes with: newton-metres for a hinge, newtons for a slider. */
    motorMaxForce: number;
  }

  /** How a character meets the world. Every number is yours: the Player Controller's are 0.02, 0.87 (50°), 0.4, 0.2 and 0.4. */
  export interface CharacterSettings {
    /** The gap kept between it and what it touches, in metres. Small, never zero. */
    readonly offset: number;
    /** The steepest slope it walks up, in radians. */
    readonly maxSlope: number;
    /** The highest step it walks onto, in metres. */
    readonly stepHeight: number;
    /** How much free floor a step needs on top, in metres. */
    readonly stepWidth: number;
    /** How far below its feet the ground still holds it while it is not rising, in metres. */
    readonly snapToGround: number;
  }

  /** A character its script moves. Its body is kinematic from the moment it is made. */
  export interface CharacterController {
    /** Moves it by up to \`translation\` this tick, sliding along what it meets, and turns it to \`rotation\`. Once per onFixedUpdate. Returns the part allowed. */
    move(translation: Readonly<Vec3Like>, rotation: Readonly<QuatLike>): Readonly<Vec3Like>;
    /** It stood on something after its last move, and was not leaving it. */
    readonly grounded: boolean;
  }

  /** The physics world. An entity's id names the body it moves with: its own Rigid Body, or the nearest one above it. */
  export interface StudioPhysics {
    /** The project's gravity, in m/s². */
    readonly gravity: Readonly<Vec3Like>;
    /** \`null\` when the entity moves with no body. */
    body(entityId: string): StudioBody | null;
    /** The Joint on that entity, exactly the one that carries it, or null when it carries none or holds nothing. */
    joint(entityId: string): StudioJoint | null;
    /** Takes the body: from then on only \`move\` moves it. \`null\` with no body, no Collider on the body's own entity, or a controller already there — a Player Controller's included. Once, in onStart. */
    createCharacterController(entityId: string, settings: CharacterSettings): CharacterController | null;
    /** The project's collision layers, Default first. A query names a layer by its id: find it here by its name. */
    readonly layers: readonly { readonly id: string; readonly name: string }[];
    /**
     * The nearest Collider along a ray, within maxDistance metres, or null. Leaves out this entity's own body, and
     * passes out of anything it starts inside. Sees the world as the last physics tick left it.
     */
    raycast(origin: Readonly<Vec3Like>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A ball swept from origin, its centre. As raycast. */
    sphereCast(origin: Readonly<Vec3Like>, radius: number, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A box of full size, turned by rotation, swept from origin, its centre. As raycast. */
    boxCast(origin: Readonly<Vec3Like>, size: Readonly<Vec3Like>, rotation: Readonly<QuatLike>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** A capsule, its height from end to end along its own y, turned by rotation, swept from its centre. As raycast. */
    capsuleCast(origin: Readonly<Vec3Like>, radius: number, height: number, rotation: Readonly<QuatLike>, direction: Readonly<Vec3Like>, maxDistance: number, filter?: QueryFilter): RaycastHit | null;
    /** The entities whose Colliders are in the ball or touch it, each once, but this entity's own body. */
    overlapSphere(center: Readonly<Vec3Like>, radius: number, filter?: QueryFilter): readonly string[];
    /** The same, for a box of full size, turned by rotation when one is given. */
    overlapBox(center: Readonly<Vec3Like>, size: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>, filter?: QueryFilter): readonly string[];
  }

  /** A collision that has just begun, as one side hears it. */
  export interface Collision {
    /** The entity whose Collider touched this one. this.physics.body(other) is the body it moves with. */
    readonly other: string;
    /** Where they touch, in world space: the middle of their contact points. */
    readonly point: Readonly<Vec3Like>;
    /** Unit, in world space: the way this side was pushed, away from the other. */
    readonly normal: Readonly<Vec3Like>;
    /** How hard they met, in newton-seconds: at least m·v for a body of mass m stopped from speed v. */
    readonly impulse: number;
  }

  /** What a query sees. Left out, every layer and no sensor. */
  export interface QueryFilter {
    /** Ids of the collision layers it sees: find one by its name in this.physics.layers. A Collider is seen by its own layer. */
    readonly layers?: readonly string[];
    /** Sensors too. Left out, a ray passes through a trigger zone. */
    readonly sensors?: boolean;
  }

  /** What a ray or a cast met first, in world space. */
  export interface RaycastHit {
    /** The entity whose Collider it met. this.physics.body(entity) is the body it moves with. */
    readonly entity: string;
    /** Where, on that Collider's surface. */
    readonly point: Readonly<Vec3Like>;
    /** Unit, out of that surface. */
    readonly normal: Readonly<Vec3Like>;
    /** How far it travelled to get there, in metres. */
    readonly distance: number;
  }
`;

/**
 * The body of the published `Behaviour`, one entry per name the class occupies.
 *
 * Keyed on `BehaviourMember`, which is `keyof Behaviour` — so a hook added to
 * the runtime and forgotten here does not compile, and a member published here
 * that the class does not have does not compile either. That is the whole point
 * of the table. It replaces a hundred lines of TypeScript in a template
 * literal that nothing checked, and which had already fallen two members
 * behind: `scenes` and `onSceneUnload` existed on the class, were reserved
 * against, and were not published — so every editor told the author they did
 * not exist.
 *
 * `null` is a member the host owns and a script may not call. The order is the
 * order of the emitted file, because a record keeps the order it was written
 * in, and this is what somebody reads in their editor — which is also why an
 * entry opening on a newline is how the blank lines between the groups survive.
 */
const BEHAVIOUR_BODY: Record<BehaviourMember | 'properties', string | null> = {
  properties: `    /** Editable in the Inspector, saved per instance with the scene. */
    static properties: Record<string, ScriptPropertyDef>;`,
  entity: `
    /** The entity this script is attached to. */
    readonly entity: { id: string; name: string };`,
  transform: `    /**
     * Its three.js object. Mutate \`position\`, \`rotation\`, \`scale\` to move it.
     * A dynamic body, or the player, is put there and keeps its speed; a
     * kinematic one moves there at the next tick, carrying what rests on it; a
     * fixed one's collider stays where it is, and so does a collider riding an
     * ancestor's body: it sits where the world was built.
     */
    readonly transform: any;`,
  body: `
    /**
     * The body this entity moves with: its own Rigid Body, or the nearest one above it — a
     * wheel's is its car's. With no body behind it, it moves nothing, and its first change
     * raises a warning.
     */
    readonly body: StudioBody;`,
  physics: `    /**
     * The physics world: gravity, any entity's body, the scene's joints, character controllers,
     * the project's collision layers, and rays, casts and overlaps that leave out this entity's
     * own body.
     */
    readonly physics: StudioPhysics;`,
  input: `    readonly input: StudioInput;`,
  audio: `    /** This entity's sounds, one-shot clips, and the buses. */
    readonly audio: StudioAudio;`,
  scenes: `    /** Moving between scenes. \`null\` when nothing is hosting this engine. */
    readonly scenes: SceneApi | null;`,
  time: `    /** Seconds since play started. */
    time: number;`,
  onAwake: `
    /** Set this script up alone. Other entities may not exist yet. */
    onAwake?(): void;`,
  onStart: `    /** Every script now exists. Cross-references belong here. */
    onStart?(): void;`,
  onUpdate: `    /** Once per displayed frame. */
    onUpdate?(delta: number): void;`,
  onFixedUpdate: `    /** Once per physics tick. Anything commanding a body belongs here. */
    onFixedUpdate?(step: number): void;`,
  onLateUpdate: `    /** After physics. Anything following a subject belongs here. */
    onLateUpdate?(): void;`,
  onCollisionEnter: `
    /**
     * A Collider of this entity, or of a child riding its body, began touching another, after
     * the physics tick it happened in. One side needs a Dynamic Rigid Body: a character walking
     * into a wall hears nothing.
     */
    onCollisionEnter?(collision: Collision): void;`,
  onCollisionExit: `    /** They stopped touching. \`other\` is the entity whose Collider it was. */
    onCollisionExit?(other: string): void;`,
  onTriggerEnter: `    /** A sensor of this entity was entered, or this entity entered one. A sensor sees whatever moves. */
    onTriggerEnter?(other: string): void;`,
  onTriggerExit: `    /** It left. */
    onTriggerExit?(other: string): void;`,
  onSceneUnload: `    /** The scene is being left, and everything is still here to read. */
    onSceneUnload?(): void;`,
  onDestroy: `    onDestroy?(): void;`,
  resolve: `
    protected resolve(entityId: string | null | undefined): EntityHandle | null;`,
  log: `    protected log(...args: unknown[]): void;`,
  wait: `    /** setTimeout tied to this script's lifetime. */
    protected wait(callback: () => void, ms: number): void;`,
  repeat: `    /** setInterval tied to this script's lifetime; returns a canceller. */
    protected repeat(callback: () => void, ms: number): () => void;`,
  // Called by the host after `onDestroy`. Reserved so a property cannot take
  // the name, and unpublished so a script cannot cancel its own timers early.
  cancelTimers: null,
};

/**
 * Type declarations for `@three-studio/runtime` as scripts see it, written into the
 * project so an external editor gives autocompletion and type errors.
 *
 * Unity generates a .csproj for the same reason: without it a user script is
 * just untyped text, and the editor is the only place any mistake shows up.
 */
const RUNTIME_DTS = `// Generated by Three Studio. Do not edit.
declare module '@three-studio/runtime' {
${PUBLISHED_TYPES}
  export abstract class Behaviour {
${Object.values(BEHAVIOUR_BODY)
  .filter((member): member is string => member !== null)
  .join('\n')}
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
