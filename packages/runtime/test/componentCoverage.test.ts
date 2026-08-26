import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentDefinitions } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

const runtimeSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

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
 * How many times the runtime names a type **outside** its own `case` label.
 *
 * `SceneBinder.buildComponent` has a branch for all eleven, and nine of them
 * `return null` — so "the runtime mentions it" proves nothing. What proves
 * something is a mention somewhere other than that branch: `PhysicsWorld` naming
 * `collider`, `ScriptHost` naming `script`, the binder's own model path naming
 * `model`. A type whose only trace is the label of the branch that says "nothing
 * to build" has no system.
 */
function mentionsOutsideCaseLabel(type: string): number {
  let count = 0;
  for (const file of sourceFiles(runtimeSrc)) {
    const src = readFileSync(file, 'utf8').replaceAll(`case '${type}':`, '');
    count += src.split(`'${type}'`).length - 1;
  }
  return count;
}

/**
 * Resolved before the runtime ever sees the scene.
 *
 * `expandPrefabs` turns an instance's contents into real entities in core, so the
 * component is honoured — just not here. It is the one type where `runtime: true`
 * and "nothing in this package builds it" are both true.
 */
const RESOLVED_IN_CORE = new Set(['prefabInstance']);

/*
 * The registry's `runtime` flag, checked against the package it makes a claim
 * about. Written in phase 9 for one reason: `audioSource` and `audioListener`
 * spent months editable and inert, and no test could have said so — the fact was
 * spread across a schema, a defaults file, an inspector table and a `switch`
 * branch that quietly returned null.
 *
 * This is what makes the flag mean something. It fails when a type is added with
 * no system, and it fails when one claims a system it does not have.
 */
describe('component coverage', () => {
  it('every type claiming a runtime has one outside its no-build branch', () => {
    const missing = componentDefinitions()
      .filter((definition) => definition.runtime && !RESOLVED_IN_CORE.has(definition.type))
      .filter((definition) => mentionsOutsideCaseLabel(definition.type) === 0)
      .map((definition) => definition.type);

    expect(missing).toEqual([]);
  });

  it('no type marked without a runtime turns out to have one', () => {
    const surprises = componentDefinitions()
      .filter((definition) => !definition.runtime)
      .filter((definition) => mentionsOutsideCaseLabel(definition.type) > 0)
      .map((definition) => definition.type);

    expect(surprises).toEqual([]);
  });
});
