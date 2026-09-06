import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Every decision the code cites exists, and every decision written down is
 * cited.
 *
 * There were sixty-eight citations across sixteen numbers and no ADR documents
 * at all — the reasoning was never lost, it is in the comments and often in
 * detail, but it had stopped being *addressable*. Worse, two of those numbers
 * were each doing duty for two unrelated decisions: one was both the audio
 * context and the undo invariants, another both component identity and the
 * audio listener. Nothing could have told you which one a citation meant except
 * reading the paragraph around it.
 *
 * Nothing in this file writes a citation of its own, deliberately: a test that
 * had to exempt itself from the rule it checks would be one exemption away from
 * exempting something else.
 *
 * A grep and an `ls` agreeing is the only thing that keeps that from happening
 * again, so it is a test rather than a habit.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const adrDir = join(repoRoot, 'docs/adr');

/**
 * Where a citation may appear.
 *
 * `docs/chantier/` is left out on purpose: its notes and task cards describe the
 * state the code was in *before* a task, and rewriting the numbers in them would
 * erase the record of the collision this test exists to prevent.
 */
const SOURCE_ROOTS = ['packages', 'apps', 'test'];
const SKIP = ['node_modules', 'dist', 'out', 'release', '.vite'];

/**
 * `0001` documents where compression *would* enter, and no compression exists —
 * being uncited is the state that document describes. Every other ADR is about
 * code that is here, so silence about it would mean the decision has drifted out
 * of the codebase without anyone noticing.
 */
const UNCITED_BY_DESIGN = new Set(['0001']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `ADR-NNNN` in the code, with the file it was found in. */
function citations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(repoRoot, root))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/ADR-(\d+)/g)) {
        const where = found.get(match[1]!) ?? [];
        where.push(relative(repoRoot, file));
        found.set(match[1]!, where);
      }
    }
  }
  return found;
}

const documents = new Set(
  readdirSync(adrDir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => name.slice(0, 4)),
);

describe('the decisions the code cites', () => {
  it('every citation resolves to a document', () => {
    const missing = [...citations().entries()]
      .filter(([number]) => !documents.has(number))
      .map(([number, where]) => `ADR-${number} (${where[0]})`);

    expect(missing).toEqual([]);
  });

  it('is written with four digits, so a citation and a file name match', () => {
    // A one-digit and a four-digit citation both read as "the fourth decision",
    // and only one of them can be grepped against `ls docs/adr/`.
    const short = [...citations().keys()].filter((number) => number.length !== 4);
    expect(short).toEqual([]);
  });

  it('every document is cited by the code it is about', () => {
    const cited = new Set(citations().keys());
    const orphans = [...documents].filter(
      (number) => !cited.has(number) && !UNCITED_BY_DESIGN.has(number),
    );

    // A document nothing cites is a decision that has drifted out of the code,
    // or one that was written for its own sake. Either is worth knowing.
    expect(orphans).toEqual([]);
  });

  it('numbers no document, since a gap reads as a lost decision', () => {
    const numbers = [...documents].map(Number).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });
});
