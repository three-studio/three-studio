import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_TSCONFIG_PATHS } from '../workspace-aliases';

/*
 * `tsconfig.base.json` is the one copy of the workspace mapping that cannot
 * import the shared one: TypeScript reads it as JSON, before any module of ours
 * exists. So it is compared instead.
 *
 * This is not a formality. The mapping was written out four times, and the four
 * had already drifted — the `three` alias was in two of them and not the third,
 * and nothing said so. The copy that survives gets a test.
 */

/**
 * Reads the config as JSON with its line comments taken out.
 *
 * `JSON.parse` cannot see JSONC, and TypeScript 7 no longer ships the JS API
 * that used to parse it (`parseConfigFileTextToJson` is gone with the Go port).
 * Only whole-line comments are stripped, deliberately: a trailing `//` would
 * also match the one inside `"https://json.schemastore.org/tsconfig"`. If a
 * trailing comment ever appears in that file, this throws rather than lies.
 */
function readTsconfig(path: string): { compilerOptions?: { paths?: Record<string, string[]> } } {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const stripped = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(stripped) as ReturnType<typeof readTsconfig>;
}

describe('the workspace mapping', () => {
  it('is the same in tsconfig.base.json as in workspace-aliases.ts', () => {
    const paths = readTsconfig('../tsconfig.base.json').compilerOptions?.paths;

    expect(paths).toEqual(WORKSPACE_TSCONFIG_PATHS);
  });
});
