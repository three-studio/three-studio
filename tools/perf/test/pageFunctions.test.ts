import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageFunctionProblems } from '../launch/cdp';
import * as editor from '../page/editor';
import * as frames from '../page/frames';
import * as player from '../page/player';

/*
 * A page function is serialised with `toString()` and run in a page, so it
 * must be whole in itself. Checked here, under the same Vitest transform the
 * harness runs under: a function that read an imported value would come out
 * as `__vite_ssr_import_0__.x`, and one that called a helper of its module
 * would throw a ReferenceError in the page — twenty minutes into a run.
 */

const MODULES = [
  { file: 'page/editor.ts', functions: editor },
  { file: 'page/frames.ts', functions: frames },
  { file: 'page/player.ts', functions: player },
];

/** The names a module declares at its top level: what its page functions must not reach for. */
function topLevelNames(source: string): string[] {
  const declarations = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm;
  return [...source.matchAll(declarations)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

describe('every page function', () => {
  for (const { file, functions } of MODULES) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const names = topLevelNames(source);

    it(`${file} imports types and nothing else`, () => {
      expect(source.match(/^import\s+(?!type\b)/gm) ?? []).toEqual([]);
    });

    for (const [name, fn] of Object.entries(functions)) {
      it(`${name} survives being run elsewhere`, () => {
        const text = fn.toString();
        expect(pageFunctionProblems(text, names, name)).toEqual([]);
        // An expression on its own: what `runInPage` wraps in `(…)(arg)`.
        expect(() => new Function(`return (${text});`)).not.toThrow();
      });
    }
  }
});

describe('the check itself', () => {
  it('sees a transform helper and a helper of the module', () => {
    const source = 'function read() { return __vite_ssr_import_0__.x + helper(); }';
    expect(pageFunctionProblems(source, ['read', 'helper'], 'read')).toEqual([
      'carries the transform helper __vite_ssr_',
      'reads helper from its module',
    ]);
  });
});
