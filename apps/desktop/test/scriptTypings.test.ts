import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CACHE_DIR, activateCore, assertDefined } from '@three-studio/core';
import { activateRuntime, createRuntimeRegistries, reservedScriptNames, scriptTypings } from '@three-studio/runtime';
import { describe, expect, it } from 'vitest';
import { writeScriptTypings } from '../src/main/scripts';

/*
 * The typings the editor writes into a project, compiled against the runtime
 * they claim to describe.
 *
 * Generated from the registries the editor window runs — the kernel's members,
 * then each contribution's, physics' and audio's — and written by the main
 * process. They are not the runtime's own declarations: a user's project
 * cannot resolve `three` or `@three-studio/core`, so `Object3D` is published
 * as `any` and three's vectors as the fields and the methods a script writes
 * them with. That makes them a second statement of the same API — and the only
 * reason the copy is acceptable is this test, which fails the moment the two
 * stop agreeing.
 *
 * TypeScript 7 has no JS API (see `packages/core/package.json`), so the check
 * is the compiler itself, run over a probe file. It costs about a quarter of a
 * second, and it is the difference between a script author reading an API and
 * reading a description of one.
 */

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** The editor window's runtime registries, as its root activates them: the typings are theirs. */
function runtimeRegistries() {
  const registries = createRuntimeRegistries();
  activateCore(registries);
  activateRuntime(registries);
  return registries;
}

const registries = runtimeRegistries();

/** A path a TypeScript import can carry, on a machine whose separator is `\`. */
const importable = (...parts: string[]): string =>
  JSON.stringify(join(repoRoot, ...parts).split(sep).join('/'));

/**
 * What the published types must accept.
 *
 * Assignability one way only — the real thing must satisfy what was published —
 * because the narrowing is deliberate and the reverse would fail on every bit
 * of it. `StudioInput` and `StudioAudio` exist under no other name, so a probe
 * that somehow resolved the real `@three-studio/runtime` instead of the
 * generated module fails to compile rather than passing on nothing.
 */
const PROBE = `import type {
  Behaviour as Published,
  Entity as PublishedEntity,
  EntityTransform as PublishedTransform,
  ScriptWorld as PublishedWorld,
  Vec3 as PublishedVector,
  Euler as PublishedEuler,
  Quat as PublishedRotation,
  SceneApi as PublishedScenes,
  AudioBus as PublishedBus,
  ScriptPropertyDef as PublishedProperty,
  StudioAudio,
  StudioInput,
  StudioBody,
  StudioJoint,
  StudioPhysics,
  Vec3Like as PublishedVec,
  QuatLike as PublishedQuat,
  CharacterController as PublishedCharacter,
  CharacterSettings as PublishedSettings,
  Collision as PublishedCollision,
  QueryFilter as PublishedFilter,
  RaycastHit as PublishedHit,
  ComponentTypes as PublishedComponents,
  PlaceOptions as PublishedPlace,
  SpawnOptions as PublishedSpawn,
  Message as PublishedMessage,
} from '@three-studio/runtime';
import type { Behaviour } from ${importable('packages/runtime/src/scripting/ScriptApi')};
import type { Entity, EntityTransform, Message, PlaceOptions, ScriptWorld, SpawnOptions } from ${importable('packages/runtime/src/scripting/Entity')};
import type { SceneApi } from ${importable('packages/runtime/src/sceneApi')};
import type { Input } from ${importable('packages/runtime/src/input/Input')};
import type { AudioApi } from ${importable('packages/runtime/src/audio/scriptMembers')};
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  Collision,
  JointHandle,
  QuatLike,
  QueryFilter,
  RaycastHit,
  Vec3Like,
} from ${importable('packages/runtime/src/physics/PhysicsApi')};
import type { ScriptPhysics } from ${importable('packages/runtime/src/physics/scriptMembers')};
import type { FieldDef } from ${importable('packages/core/src/fields')};
import type { AudioBus, ComponentTypes } from ${importable('packages/core/src/index')};

// The public half of a type. A class carrying a protected member is assignable
// from nothing but a subclass, so the two \`Behaviour\`s cannot be compared
// whole; a mapped type is keyed on \`keyof\`, which leaves the protected
// helpers out. Those three are covered by name, by the kernel's record of its
// members in \`typings.ts\`.
type PublicPart<T> = { [K in keyof T]: T[K] };

declare const behaviour: Behaviour;
declare const entity: Entity;
declare const transform: EntityTransform;
declare const world: ScriptWorld;
declare const scenes: SceneApi;
declare const input: Input;
declare const audio: AudioApi;
declare const property: FieldDef;
declare const bus: AudioBus;
declare const publishedBus: PublishedBus;
declare const publishedScenes: PublishedScenes;

export const a: PublicPart<Published> = behaviour;
export const b: PublishedEntity = entity;
export const b1: PublishedTransform = transform;
export const b2: PublishedWorld = world;
// three's own, which the transform hands out: what is published of them is a
// part of each, the fields and what writes them in place.
export const b3: PublishedVector = transform.position;
export const b4: PublishedEuler = transform.rotation;
export const b5: PublishedRotation = transform.quaternion;
export const c: PublishedScenes = scenes;
// Both ways: what a script is told it may call — an additive load, an unload,
// the data between scenes — is what the game gives it.
export const c1: SceneApi = publishedScenes;
export const d: StudioInput = input;
export const e: StudioAudio = audio;
export const f: PublishedProperty = property;
// Both ways, and this one alone: a closed union that gained a member nobody
// published would leave a script unable to name a bus that exists, and one
// that lost a member would let a script name a bus that does not.
export const g: PublishedBus = bus;
export const h: AudioBus = publishedBus;

declare const body: BodyHandle;
declare const physics: ScriptPhysics;
declare const character: CharacterController;
declare const vec: Vec3Like;
declare const publishedVec: PublishedVec;
declare const quat: QuatLike;
declare const publishedQuat: PublishedQuat;
declare const settings: CharacterSettings;
declare const publishedSettings: PublishedSettings;

export const i: StudioBody = body;
export const j: StudioPhysics = physics;
export const k: PublishedCharacter = character;
// Both ways: what a script builds is what the runtime reads, field for field.
export const l: PublishedVec = vec;
export const m: Vec3Like = publishedVec;
export const n: PublishedQuat = quat;
export const o: QuatLike = publishedQuat;
export const p: PublishedSettings = settings;
export const q: CharacterSettings = publishedSettings;

declare const collision: Collision;
declare const publishedCollision: PublishedCollision;

// Both ways: what the runtime hands a hook is what the script reads.
export const r: PublishedCollision = collision;
export const s: Collision = publishedCollision;

declare const hit: RaycastHit;
declare const filter: QueryFilter;
declare const publishedFilter: PublishedFilter;

export const t: PublishedHit = hit;

declare const joint: JointHandle;

export const w: StudioJoint = joint;
// Both ways: the filter a script builds is the one the runtime reads.
export const u: PublishedFilter = filter;
export const v: QueryFilter = publishedFilter;

declare const components: ComponentTypes;

// Every type the build defines is published, and each component as the
// runtime holds it is one a script may read: keyed on the kernel's own types,
// so a type left out fails here rather than vanishing from an author's editor.
export const x: { [K in keyof ComponentTypes]: PublishedComponents[K] } = components;

declare const place: PlaceOptions;
declare const spawn: SpawnOptions;

// One way, as \`Entity\` is: the published parent is a part of the runtime's
// handle, whose private fields no published type can have.
export const y1: PublishedPlace = place;
export const y2: PublishedSpawn = spawn;

declare const message: Message;
declare const publishedMessage: PublishedMessage;

// Both ways: what the runtime hands \`onMessage\` is what the script reads.
export const z1: PublishedMessage = message;
export const z2: Message = publishedMessage;
`;

/**
 * `import.meta.env` is Vite's, declared by `vite/client` in the repo's own
 * config. The probe reaches the runtime sources, one of which reads it, and it
 * resolves no types of its own — so the one it needs is stated here.
 */
const SHIMS = `interface ImportMeta { readonly env: Record<string, unknown> }\n`;

const TSCONFIG = {
  compilerOptions: {
    target: 'ES2023',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // Nothing ambient beyond what is listed: a project of someone's own has no
    // `@types/node` either.
    types: [],
    paths: {
      '@three-studio/core': [join(repoRoot, 'packages/core/src/index.ts')],
      '@three-studio/core/*': [join(repoRoot, 'packages/core/src/*')],
    },
  },
  include: ['probe.ts', 'shims.d.ts', `../${CACHE_DIR}/studio-runtime.d.ts`],
};

describe('the generated script typings', () => {
  it('compiles against the runtime they describe', { timeout: 60_000 }, async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-typings-'));
    await writeScriptTypings(project, scriptTypings(registries));

    const probe = join(project, 'probe');
    await mkdir(probe, { recursive: true });
    await writeFile(join(probe, 'probe.ts'), PROBE, 'utf8');
    await writeFile(join(probe, 'shims.d.ts'), SHIMS, 'utf8');
    await writeFile(join(probe, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2), 'utf8');

    // Through node rather than `.bin/tsc`, which is a shell script on one
    // platform and a `.cmd` on another.
    const compiler = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    const compiled = await run(process.execPath, [compiler, '--noEmit', '-p', join(probe, 'tsconfig.json')]).catch(
      (cause: { stdout?: string; stderr?: string }) => cause,
    );

    // tsc reports type errors on stdout and exits non-zero; both are shown, so
    // a failure here reads as the divergence it is rather than as an exit code.
    expect(`${compiled.stdout ?? ''}${compiled.stderr ?? ''}`).toBe('');
  });

  it('publishes every name the runtime reserves, and no other', async () => {
    // The names, checked as text, because the compiler above cannot see a
    // member that is *missing* from the published class — only one that is
    // there and wrong. This is the half that caught `scenes` and
    // `onSceneUnload`, which existed on `Behaviour` for two releases and were
    // published nowhere.
    const project = await mkdtemp(join(tmpdir(), 'studio-typings-'));
    await writeScriptTypings(project, scriptTypings(registries));
    const dts = await readFile(join(project, CACHE_DIR, 'studio-runtime.d.ts'), 'utf8');

    const reserved = reservedScriptNames(registries.scriptMembers.values());
    // The class body alone: the interfaces above it are indented the same, and
    // an `AudioVoice` with a `pause` is not a `Behaviour` with one.
    const body = dts.slice(dts.indexOf('export abstract class Behaviour {'));
    const published = new Set(
      [...body.matchAll(/^ {4}(?:(?:static|protected|readonly) )*(\w+)[?(:]/gm)].map((hit) =>
        assertDefined(hit[1], 'the name of a published member'),
      ),
    );

    // `cancelTimers` is the one the host owns: reserved so a property cannot
    // take the name, unpublished so a script cannot cancel its own timers.
    expect([...reserved].filter((name) => !published.has(name))).toEqual(['cancelTimers']);
    expect([...published].filter((name) => name !== 'properties' && !reserved.has(name))).toEqual([]);
    // Physics' and audio's among them, which the host names nowhere.
    expect(['body', 'physics', 'onCollisionEnter', 'onTriggerExit', 'audio'].filter((name) => !published.has(name))).toEqual(
      [],
    );
  });
});
