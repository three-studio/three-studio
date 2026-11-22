import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildScripts, esbuildBinaryPath } from '../src/main/scripts';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * Play compiles what is on disk, whatever was edited since the last build. A
 * cache keyed on the script assets alone answered with the old bundle after an
 * edit to anything a script imports — a `.json` data asset, a helper outside
 * `assets/` — and since it lived in the main process, closing the window did not
 * clear it: only relaunching the app did.
 */

const scriptLogging = (imports: string, logged: string): string =>
  `import { Behaviour } from '@three-studio/runtime';\n${imports}\n` +
  `export default class Spin extends Behaviour { onStart(): void { this.log(${logged}); } }\n`;

async function projectWithScript(source: string): Promise<{ project: string; script: string }> {
  const project = await mkdtemp(join(tmpdir(), 'studio-script-build-'));
  await mkdir(join(project, 'assets/scripts'), { recursive: true });
  const script = join(project, 'assets/scripts/Spin.ts');
  await writeFile(script, source);
  return { project, script };
}

describe('a build after an edit made on disk', () => {
  it('compiles an edited script whose size changed', async () => {
    const { project, script } = await projectWithScript(scriptLogging('', "'VERSION_ONE'"));
    expect((await buildScripts(registries, project)).code).toContain('VERSION_ONE');

    await writeFile(script, scriptLogging('', "'VERSION_TWO_LONGER'"));
    expect((await buildScripts(registries, project)).code).toContain('VERSION_TWO_LONGER');
  });

  it('compiles an edited script whose size stayed the same', async () => {
    const { project, script } = await projectWithScript(scriptLogging('', "'VERSION_ONE'"));
    expect((await buildScripts(registries, project)).code).toContain('VERSION_ONE');

    await writeFile(script, scriptLogging('', "'VERSION_TWO'"));
    expect((await buildScripts(registries, project)).code).toContain('VERSION_TWO');
  });

  it('compiles an edited JSON data asset that the script imports', async () => {
    const { project } = await projectWithScript(
      scriptLogging("import tuning from '../data/tuning.json';", 'tuning.tag'),
    );
    await mkdir(join(project, 'assets/data'), { recursive: true });
    const data = join(project, 'assets/data/tuning.json');
    await writeFile(data, JSON.stringify({ tag: 'DATA_ONE' }));
    expect((await buildScripts(registries, project)).code).toContain('DATA_ONE');

    await writeFile(data, JSON.stringify({ tag: 'DATA_TWO' }));
    expect((await buildScripts(registries, project)).code).toContain('DATA_TWO');
  });

  it('compiles an edited helper outside assets/ that the script imports', async () => {
    const { project } = await projectWithScript(
      scriptLogging("import { tag } from '../../src/helper';", 'tag'),
    );
    await mkdir(join(project, 'src'), { recursive: true });
    const helper = join(project, 'src/helper.ts');
    await writeFile(helper, `export const tag = 'HELPER_ONE';\n`);
    expect((await buildScripts(registries, project)).code).toContain('HELPER_ONE');

    await writeFile(helper, `export const tag = 'HELPER_TWO';\n`);
    expect((await buildScripts(registries, project)).code).toContain('HELPER_TWO');
  });
});

/*
 * What a bundle hands the page is its classes, as data: the host decodes them
 * and gives them to the world that runs them. A bundle that registered its
 * classes itself filled a table of the page's, which every world then read.
 */
describe('what a bundle exports', () => {
  it('exports its classes as `scripts`, and registers nothing', async () => {
    const { project } = await projectWithScript(scriptLogging('', "'EXPORTED'"));
    const { code, errors } = await buildScripts(registries, project);

    expect(errors).toEqual([]);
    expect(code).toMatch(/export\s*\{[^}]*\bscripts\b/);
    expect(code).not.toContain('registerScript');
  });

  it('builds a helper with no default export beside the scripts without a warning', async () => {
    // Every .ts under assets/scripts is in the entry, helpers included; reading
    // a helper's missing default made esbuild warn at every build, and the
    // editor printed each warning to its Console.
    const { project } = await projectWithScript(scriptLogging("import { clamp } from './lib/mathx';", 'clamp(2)'));
    await mkdir(join(project, 'assets/scripts/lib'), { recursive: true });
    await writeFile(join(project, 'assets/scripts/lib/mathx.ts'), 'export function clamp(value: number): number { return Math.min(value, 1); }\n');
    const { errors, warnings, scriptCount } = await buildScripts(registries, project);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(scriptCount).toBe(2);
  });

  it('checks for version 5 of the script API, the first with entity handles', async () => {
    const { project } = await projectWithScript(scriptLogging('', "'VERSIONED'"));
    const { code } = await buildScripts(registries, project);

    expect(code).toContain('api.version !== 5');
  });
});

describe('a build of an unchanged project', () => {
  it('compiles the same code twice', async () => {
    // The renderer skips importing a bundle equal to the one it holds, which
    // keeps a running script's state and keeps a second copy of the same code
    // out of memory. Without a cache, that rests on esbuild's output being the
    // same for the same input.
    const { project } = await projectWithScript(scriptLogging('', "'SAME'"));
    const first = await buildScripts(registries, project);
    const second = await buildScripts(registries, project);

    expect(first.errors).toEqual([]);
    expect(second.code).toBe(first.code);
  });
});

describe("esbuild's binary", () => {
  it('is where esbuild installed it for this platform', () => {
    // A packaged app names this path under `app.asar.unpacked` for esbuild,
    // which would otherwise spawn it from inside the archive. An esbuild that
    // moves its binary fails here, rather than in an installed editor that
    // compiles no script.
    const esbuildMain = createRequire(import.meta.url).resolve('esbuild');
    const nodeModules = dirname(dirname(dirname(esbuildMain)));

    expect(existsSync(esbuildBinaryPath(nodeModules))).toBe(true);
  });
});
