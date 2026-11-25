import { assertDefined, createEntity, fixedId } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Behaviour } from '../src/scripting/ScriptApi';
import { scriptClassesOf } from '../src/scripting/scriptBundle';
import { physicsRig, standInForTheBrowser, takeTheBrowserBack, withScript } from './physics/rig';

/*
 * A compiled bundle's classes are what its module exports, and a bundle is
 * written by a build of the author's code: nothing checks what it holds before
 * the host reads it, so the host decodes it. The classes then go to the world
 * that runs them, and to no other: a world made from another bundle finds
 * nothing of the first.
 */

const DOOR = fixedId('asset', 'script-door');

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe("a bundle's classes", () => {
  it('keeps each pair of an asset id and a Behaviour subclass', () => {
    class Door extends Behaviour {}

    expect([...scriptClassesOf({ scripts: [[DOOR, Door]] })]).toEqual([[DOOR, Door]]);
  });

  it('drops a function that is no Behaviour, an id that is none, and what is no pair', () => {
    class Door extends Behaviour {}
    // A helper's default export: a function, and no script. Taken for one, it
    // failed at its first hook.
    function lerp(): number {
      return 0;
    }

    const classes = scriptClassesOf({
      scripts: [[DOOR, lerp], ['', Door], ['script-gate', undefined], 'script-wall', ['script-arch', Door]],
    });

    expect([...classes.keys()]).toEqual(['script-arch']);
  });

  it('holds nothing for a module that exports no scripts', () => {
    for (const bundle of [{}, { scripts: 'none' }, null, 'export {}']) {
      expect(scriptClassesOf(bundle).size).toBe(0);
    }
  });
});

describe('two worlds, given a bundle each', () => {
  /** Which class woke, in order. */
  const woke: string[] = [];

  class First extends Behaviour {
    override onAwake() {
      woke.push('first');
    }
  }
  class Second extends Behaviour {
    override onAwake() {
      woke.push('second');
    }
  }

  it('each run their own class', async () => {
    woke.length = 0;
    await physicsRig([withScript(createEntity('Door', []), First)]);
    await physicsRig([withScript(createEntity('Gate', []), Second)]);

    expect(woke).toEqual(['first', 'second']);
  });

  it('finds nothing of another world’s bundle in its own', async () => {
    woke.length = 0;
    const door = withScript(createEntity('Door', []), First);
    await physicsRig([door]);
    // The same script, naming the class the first world was given, in an
    // world whose bundle does not hold it.
    const { world } = await physicsRig([createEntity('Door', [assertDefined(door.components[0], 'the script')])]);

    expect(woke).toEqual(['first']);
    expect(world.warnings).toContain('"Door" references a script that is not compiled.');
  });
});
