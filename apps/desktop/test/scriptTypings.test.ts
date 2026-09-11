import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CACHE_DIR } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { writeScriptTypings } from '../src/main/scripts';

/*
 * The typings the editor writes into a project, compiled against the runtime
 * they claim to describe.
 *
 * They are not the runtime's own declarations: a user's project cannot resolve
 * `three` or `@three-studio/core`, so `Object3D` is published as `any` and an
 * `EntityDoc` as the two fields a script reads off it. That makes them a second
 * statement of the same API — and the only reason the copy is acceptable is
 * this test, which fails the moment the two stop agreeing.
 *
 * TypeScript 7 has no JS API (see `packages/core/package.json`), so the check
 * is the compiler itself, run over a probe file. It costs about a quarter of a
 * second, and it is the difference between a script author reading an API and
 * reading a description of one.
 */

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

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
  EntityHandle as PublishedHandle,
  SceneApi as PublishedScenes,
  AudioBus as PublishedBus,
  ScriptPropertyDef as PublishedProperty,
  StudioAudio,
  StudioInput,
} from '@three-studio/runtime';
import type { Behaviour, EntityHandle } from ${importable('packages/runtime/src/scripting/ScriptApi')};
import type { SceneApi } from ${importable('packages/runtime/src/behaviour/Behaviour')};
import type { Input } from ${importable('packages/runtime/src/input/Input')};
import type { AudioApi } from ${importable('packages/runtime/src/scripting/audioApi')};
import type { FieldDef } from ${importable('packages/core/src/fields')};
import type { AudioBus } from ${importable('packages/core/src/index')};

// The public half of a type. A class carrying a protected member is assignable
// from nothing but a subclass, so the two \`Behaviour\`s cannot be compared
// whole; a mapped type is keyed on \`keyof\`, which leaves the protected
// helpers out. Those four are covered by name, by the table the body is keyed
// on in \`scripts.ts\`.
type PublicPart<T> = { [K in keyof T]: T[K] };

declare const behaviour: Behaviour;
declare const handle: EntityHandle;
declare const scenes: SceneApi;
declare const input: Input;
declare const audio: AudioApi;
declare const property: FieldDef;
declare const bus: AudioBus;
declare const publishedBus: PublishedBus;

export const a: PublicPart<Published> = behaviour;
export const b: PublishedHandle = handle;
export const c: PublishedScenes = scenes;
export const d: StudioInput = input;
export const e: StudioAudio = audio;
export const f: PublishedProperty = property;
// Both ways, and this one alone: a closed union that gained a member nobody
// published would leave a script unable to name a bus that exists, and one
// that lost a member would let a script name a bus that does not.
export const g: PublishedBus = bus;
export const h: AudioBus = publishedBus;
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
    await writeScriptTypings(project);

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
    await writeScriptTypings(project);
    const dts = await readFile(join(project, CACHE_DIR, 'studio-runtime.d.ts'), 'utf8');

    const { RESERVED_PROPERTY_NAMES } = await import('@three-studio/runtime');
    // The class body alone: the interfaces above it are indented the same, and
    // an `AudioVoice` with a `pause` is not a `Behaviour` with one.
    const body = dts.slice(dts.indexOf('export abstract class Behaviour {'));
    const published = new Set(
      [...body.matchAll(/^ {4}(?:(?:static|protected|readonly) )*(\w+)[?(:]/gm)].map((hit) => hit[1]!),
    );

    // `cancelTimers` is the one the host owns: reserved so a property cannot
    // take the name, unpublished so a script cannot cancel its own timers.
    expect([...RESERVED_PROPERTY_NAMES].filter((name) => !published.has(name))).toEqual([
      'cancelTimers',
    ]);
    expect([...published].filter((name) => name !== 'properties' && !RESERVED_PROPERTY_NAMES.has(name))).toEqual(
      [],
    );
  });
});
