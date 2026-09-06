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
 * The decisions that describe a seam nothing has come through yet.
 *
 * `0001` says where compression would enter and no compression exists; `0018`
 * says where a third-party extension would, and none exists either. **Being
 * uncited is the state those documents describe** — a citation would mean the
 * thing had been built.
 *
 * A class, not a list of exceptions: an ADR belongs here when its subject is
 * deliberately unbuilt, and comes out of it the day something cites it. Every
 * other ADR is about code that is here, so silence about one of those would mean
 * a decision has drifted out of the codebase with nobody noticing.
 */
const UNCITED_BY_DESIGN = new Set(['0001', '0018']);

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

/**
 * The bugs the comments name, from the register that answers for them.
 *
 * One file rather than one per bug, because a bug is history: it is read when a
 * citation is met, never navigated to on its own. The decisions in `docs/adr/`
 * are the opposite, and are a file each.
 */
const registeredBugs = new Set(
  [...readFileSync(join(repoRoot, 'docs/bugs.md'), 'utf8').matchAll(/^## (B\d+)\b/gm)].map(
    (match) => match[1]!,
  ),
);

/**
 * Every `Bn` a comment names, with the file it was found in.
 *
 * A bare pattern, and it is right for this codebase today — nothing else here
 * spells a capital B beside one or two digits. Should something start to, the
 * fix is to name the false positive rather than to loosen the check: the whole
 * value is that a citation cannot quietly point at nothing.
 */
function bugCitations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(join(repoRoot, root))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bB\d{1,2}\b/g)) {
        const where = found.get(match[0]) ?? [];
        where.push(relative(repoRoot, file));
        found.set(match[0], where);
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

describe('the bugs the comments name', () => {
  it('every citation resolves to the register', () => {
    // "which is B6" with no B6 anywhere is a lookup with no destination, and
    // the comment that carries it reads as if the reader is expected to know.
    const missing = [...bugCitations().entries()]
      .filter(([bug]) => !registeredBugs.has(bug))
      .map(([bug, where]) => `${bug} (${where[0]})`);

    expect(missing).toEqual([]);
  });

  it('every entry is cited by the code it shaped', () => {
    const cited = new Set(bugCitations().keys());
    const orphans = [...registeredBugs].filter((bug) => !cited.has(bug));

    // A bug nobody names any more is one whose guard has been removed or
    // rewritten past recognition — which is the moment to find out, not later.
    expect(orphans).toEqual([]);
  });
});
