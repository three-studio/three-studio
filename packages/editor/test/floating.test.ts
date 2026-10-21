import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Everything that floats above the editor is drawn by `ui/Floating`, asserted
 * rather than documented.
 *
 * On macOS the page's own title bar drags the window, and over a drag region the
 * OS takes the pointer whatever is painted on top. A surface gets the pointer
 * back only by subtracting itself from the region, from a place in the document
 * after every box that drags. `Floating` does both, and nothing else knows to.
 * The Scene menu was drawn in place — an absolute list on the menu scale, inside
 * the menu bar, back when the menu bar and the toolbar both dragged — and its
 * rows went dead wherever they lay over the toolbar.
 *
 * So the three ways something floats are allowed in that one file: a portal, an
 * element appended to the body, and a place on the z-index scale.
 */

const editorSrc = fileURLToPath(new URL('../src', import.meta.url));
const FLOATING = join(editorSrc, 'ui', 'Floating.tsx');

const FLOATS: readonly RegExp[] = [
  /\bcreatePortal\s*\(/,
  /\bdocument\.body\.(?:append|appendChild|prepend|insertBefore)\s*\(/,
  // The scale's utilities, and the variables behind them for inline styles.
  /\bz-(?:dialog|menu|toast|prompt)\b/,
  /--z-index-(?:dialog|menu|toast|prompt)\b/,
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

describe('the floating layer', () => {
  it('is the only place anything floats from', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(editorSrc).sort()) {
      if (file === FLOATING) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (FLOATS.some((pattern) => pattern.test(line))) {
            offenders.push(`${relative(editorSrc, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
