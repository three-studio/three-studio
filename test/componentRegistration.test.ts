import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_TYPES, activateCore, createCoreRegistries } from '@three-studio/core';
import { activateRuntime, createRuntimeRegistries } from '@three-studio/runtime';
import { describe, expect, it } from 'vitest';

/*
 * A component type is folders — one per package that has a part of it — and
 * the lists that have to name them: core's activation and `COMPONENT_TYPES`, the
 * runtime's activation. This checks the lists against the folders.
 *
 * **What it catches that nothing else does.** `tsc` refuses an icon outside
 * `ComponentIcon` or a factory missing from the package's front door, and a type
 * registered twice throws. All of those start from a declaration and look for
 * the code. Nothing at all throws for a definition no activation lists: nothing
 * registers by being imported any more, so this test is where a forgotten line
 * fails — in CI, before anything ships.
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

describe('core knows about every component folder it has', () => {
  it('activates a definition for each one', () => {
    // A folder whose definition the activation leaves out throws nothing: the
    // type silently does not exist, and a scene holding one keeps it as a type
    // of no module, exactly as found.
    const registries = createCoreRegistries();
    activateCore(registries);
    const activated = registries.components.values().map(({ id }) => id);

    expect([...activated].sort()).toEqual(typeFolders('core'));
  });

  it('activates them in the order the Add Component menu offers them', () => {
    // The menu lists what is addable in registration order, which used to be
    // the order of the registering imports: moving a line reordered the menu.
    const registries = createCoreRegistries();
    activateCore(registries);

    expect(registries.components.values().map(({ id }) => id)).toEqual([
      'mesh',
      'model',
      'light',
      'camera',
      'rigidbody',
      'collider',
      'joint',
      'audioSource',
      'audioListener',
      'script',
      'prefabInstance',
      'playerController',
      'water',
      'particleEmitter',
    ]);
  });

  it('names each one in `COMPONENT_TYPES`', () => {
    // The union `ComponentType` is derived from the schema and `tsc` keeps this
    // list inside it, but nothing makes it *complete*: a type can be in the
    // union, have a folder, and be absent here.
    expect([...COMPONENT_TYPES].sort()).toEqual(typeFolders('core'));
  });

  it('leaves its registries empty once the activation is disposed', () => {
    const registries = createCoreRegistries();
    activateCore(registries).dispose();

    expect(registries.components.values()).toEqual([]);
  });
});

describe('the runtime knows about every component folder it has', () => {
  it('activates a system for each one', () => {
    // A folder whose system the activation leaves out throws nothing: the type
    // is quietly unbuilt, and the entity shows nothing in the viewport, which
    // reads as a broken asset rather than as a missing line.
    const registries = createRuntimeRegistries();
    activateRuntime(registries);
    const activated = registries.systems.values().map(({ id }) => id);

    expect([...activated].sort()).toEqual(typeFolders('runtime'));
  });

  it('leaves its registries empty once the activation is disposed', () => {
    const registries = createRuntimeRegistries();
    activateRuntime(registries).dispose();

    expect(registries.systems.values()).toEqual([]);
    expect(registries.behaviours.values()).toEqual([]);
  });

  it('draws a subset of what core declares, never something core has never heard of', () => {
    const unknown = typeFolders('runtime').filter(
      (type) => !COMPONENT_TYPES.some((declared) => declared === type),
    );
    expect(unknown).toEqual([]);
  });
});
