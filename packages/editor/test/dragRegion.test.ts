import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Only the title bar moves an editor window, asserted rather than documented.
 *
 * Over a drag region the OS takes a press before the page sees it. The menu bar
 * and the toolbar both used to drag the window, so a press on the toolbar never
 * reached an open menu's outside-press listener: the Window menu could not be
 * closed from there. Every other box the editor draws has to reach the page.
 *
 * The launcher is a window of its own, with drag strips of its own and no menu
 * to close.
 */

const editorSrc = fileURLToPath(new URL('../src', import.meta.url));

const ALLOWED = new Set([join('shell', 'TitleBar.tsx'), join('launcher', 'LauncherApp.tsx')]);

/** A box made to drag: the utility in a class list, or the property written inline. */
const DRAGS: readonly RegExp[] = [
  /className=(?:"[^"]*|\{`[^`]*)\bapp-drag\b/,
  /classList\.add\([^)]*['"]app-drag['"]/,
  /WebkitAppRegion:\s*['"]drag['"]/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function dragLines(source: string): number[] {
  return source
    .split('\n')
    .flatMap((line, index) => (DRAGS.some((pattern) => pattern.test(line)) ? [index + 1] : []));
}

describe('the window drag region', () => {
  it('is the title bar alone', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(editorSrc).sort()) {
      const name = relative(editorSrc, file);
      if (ALLOWED.has(name)) continue;
      for (const line of dragLines(readFileSync(file, 'utf8'))) offenders.push(`${name}:${line}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is found in the title bar, so the check above can see one', () => {
    // A pattern that matched nothing would let the test above pass for ever.
    expect(dragLines(readFileSync(join(editorSrc, 'shell', 'TitleBar.tsx'), 'utf8'))).not.toEqual([]);
  });
});
