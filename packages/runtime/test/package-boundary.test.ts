import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const runtimeSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const coreSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'core', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every `from '...'` / `import('...')` specifier in a source file.
 *
 * The leading delimiter is not decoration. Without it the keyword matches
 * inside a string too, and `'studio-import'` — the URL scheme the import dialog
 * previews through — read as an import of everything up to the next quote,
 * which failed this test over a constant.
 */
function specifiers(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const found: string[] = [];
  const re = /(?:^|[\s;}])(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) found.push(m[1]!);
  return found;
}

/*
 * These two rules are what make the "export to web" build a plain bundle of
 * @three-studio/runtime rather than a refactor. They are cheap to keep and expensive
 * to restore once broken, so they are asserted rather than documented.
 */
describe('package boundaries', () => {
  it('runtime never imports the editor', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(runtimeSrc)) {
      for (const spec of specifiers(file)) {
        if (spec.startsWith('@three-studio/editor') || spec.includes('packages/editor')) {
          offenders.push(`${relative(runtimeSrc, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('core stays dependency-free', () => {
    const allowed = /^(\.|node:)/;
    const offenders: string[] = [];
    for (const file of sourceFiles(coreSrc)) {
      for (const spec of specifiers(file)) {
        if (!allowed.test(spec)) offenders.push(`${relative(coreSrc, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
