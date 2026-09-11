import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_TYPES } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * A component type is three folders that register themselves, and three lists
 * that have to name them. This checks the lists against the folders.
 *
 * **What it catches that nothing else does.** Both `index.ts` files already
 * throw at load when a type in `COMPONENT_TYPES` was never registered, and `tsc`
 * refuses an icon outside `ComponentIcon` or a factory missing from the package's
 * front door. All of those start from a declaration and look for the code.
 *
 * This goes the other way: it starts from the **folders on disk** and looks for
 * the declarations. A folder nobody listed throws nothing and fails nothing — the
 * type simply does not exist, and the author who wrote nine files finds out by
 * noticing their component is absent from a menu.
 *
 * It is also the shape of the lists that stands between this codebase and
 * third-party extension: a plugin cannot add a line to `COMPONENT_TYPES` inside a
 * compiled `core`. Deriving them is the work; agreeing about them is the least
 * that can be done today, and it is what makes the derivation checkable when it
 * comes.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The type folders under a package's `components/`, which are the source of truth. */
function typeFolders(pkg: string): string[] {
  const dir = join(repoRoot, 'packages', pkg, 'src/components');
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .sort();
}

/** The `import './<type>';` lines of a registering index, in order. */
function registeringImports(pkg: string): string[] {
  const source = readFileSync(join(repoRoot, 'packages', pkg, 'src/components/index.ts'), 'utf8');
  return [...source.matchAll(/^import '\.\/([A-Za-z]+)';$/gm)].map((match) => match[1]!).sort();
}

describe('core knows about every component folder it has', () => {
  it('imports each one, which is how it registers', () => {
    // Registration *is* the import — there is no table to fill in — so a folder
    // missing from this list is a type that silently does not exist.
    expect(registeringImports('core')).toEqual(typeFolders('core'));
  });

  it('names each one in `COMPONENT_TYPES`', () => {
    // The union `ComponentType` is derived from the schema and `tsc` keeps this
    // list inside it, but nothing makes it *complete*: a type can be in the
    // union, have a folder, and be absent here.
    expect([...COMPONENT_TYPES].sort()).toEqual(typeFolders('core'));
  });
});

describe('the runtime knows about every component folder it has', () => {
  it('imports each one', () => {
    expect(registeringImports('runtime')).toEqual(typeFolders('runtime'));
  });

  it('lists each one in `DRAWN_TYPES`, which is the imports written twice', () => {
    // Read as text on purpose. `DRAWN_TYPES` is deliberately a second statement
    // of the imports above it — the runtime has no `COMPONENT_TYPES` of its own
    // to check against — and a second statement is only worth having while
    // something compares the two.
    const source = readFileSync(
      join(repoRoot, 'packages/runtime/src/components/index.ts'),
      'utf8',
    );
    const block = /const DRAWN_TYPES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const listed = [...block.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]!).sort();

    expect(listed).toEqual(typeFolders('runtime'));
  });

  it('draws a subset of what core declares, never something core has never heard of', () => {
    const unknown = typeFolders('runtime').filter(
      (type) => !(COMPONENT_TYPES as readonly string[]).includes(type),
    );
    expect(unknown).toEqual([]);
  });
});
