import type { ScriptBuildResult } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * What Play imports. The main process keeps one compiled build, shared by
 * every window, the export and the device launches, so the `unchanged` it
 * answers says nothing about what this window has imported: once a launch had
 * compiled an edited script, Play was told `unchanged` and kept running the
 * classes from before the edit.
 *
 * An import is counted where the bundle is turned into a URL. The URL handed
 * back is a `data:` module, which Node imports where a `blob:` one cannot be.
 */

type Store = typeof import('../src/state/scriptStore').useScriptStore;

let answers: ScriptBuildResult[] = [];
let imports = 0;
let store: Store;

function build(code: string, overrides: Partial<ScriptBuildResult> = {}): ScriptBuildResult {
  return { code, errors: [], warnings: [], scriptCount: 1, ...overrides };
}

async function run(result: ScriptBuildResult): Promise<boolean> {
  answers.push(result);
  return store.getState().build();
}

beforeEach(async () => {
  answers = [];
  imports = 0;
  vi.stubGlobal('window', {
    studio: {
      scripts: {
        build: async () => {
          const next = answers.shift();
          if (next === undefined) throw new Error('scripts.build was not expected');
          return next;
        },
      },
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    imports += 1;
    return 'data:text/javascript,export%20%7B%7D%3B';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // A module of its own for each case: what was imported is the module's.
  vi.resetModules();
  ({ useScriptStore: store } = await import('../src/state/scriptStore'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Play’s scripts', () => {
  it('imports the first build, and says the classes changed', async () => {
    expect(await run(build('A'))).toBe(true);

    expect(imports).toBe(1);
    expect(store.getState().revision).toBe(1);
    expect(store.getState().errors).toEqual([]);
  });

  it('does not import the same code again, whatever the build says', async () => {
    await run(build('A'));
    expect(await run(build('A', { unchanged: false }))).toBe(true);

    expect(imports).toBe(1);
    expect(store.getState().revision).toBe(1);
  });

  it('imports new code the main process calls unchanged, compiled first for someone else', async () => {
    await run(build('A'));
    expect(await run(build('B', { unchanged: true }))).toBe(true);

    expect(imports).toBe(2);
    expect(store.getState().revision).toBe(2);
  });

  it('imports the same code again after a failed build dropped its classes', async () => {
    await run(build('A'));
    expect(await run(build('', { errors: ['Fresh.ts: Expected ";"'] }))).toBe(false);
    expect(await run(build('A', { unchanged: true }))).toBe(true);

    expect(imports).toBe(2);
    expect(store.getState().errors).toEqual([]);
  });
});
