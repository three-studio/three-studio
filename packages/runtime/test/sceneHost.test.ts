import {
  createComponent,
  createEntity,
  createRenderingSettings,
  type SceneDoc,
  type ScriptComponent,
} from '@three-studio/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import type { SceneApi } from '../src/behaviour/Behaviour';
import { SceneHost } from '../src/SceneHost';
import { Behaviour, clearScripts, registerScript } from '../src/scripting/ScriptHost';

/*
 * Where a script is, as it asks `scenes.current`.
 *
 * It read `null` in the first scene's `onStart`, and the name of the scene just
 * left in every later one: every `onAwake` and `onStart` runs while the engine
 * is being built, and the host named a scene only once it ran. A level that
 * restarted itself from `onStart` restarted the previous one, or failed on
 * `No scene "null"`.
 */

/** `Input` listens on `window` and `document`, and nothing on this path reads them back. */
const eventTarget = { addEventListener() {}, removeEventListener() {} };

beforeAll(() => {
  Object.assign(globalThis, { window: eventTarget, document: eventTarget });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

const WHERE = 'script-where';

const seen: [phase: string, current: string | null][] = [];
const held: SceneApi[] = [];

class Where extends Behaviour {
  override onAwake() {
    seen.push(['awake', this.scenes?.current ?? null]);
  }

  override onStart() {
    seen.push(['start', this.scenes?.current ?? null]);
    if (this.scenes) held.push(this.scenes);
  }
}

function sceneWithWhere(): SceneDoc {
  const script: ScriptComponent = { ...createComponent('script'), assetId: WHERE };
  return sceneWith([createEntity('Holder', [script])]);
}

function hostOf(scenes: Record<string, SceneDoc>): SceneHost {
  return new SceneHost({
    source: {
      read: async (name) => {
        const scene = scenes[name];
        if (!scene) throw new Error(`No scene "${name}".`);
        return structuredClone(scene);
      },
    },
    resolver: NULL_ASSET_RESOLVER,
    rendering: createRenderingSettings(),
    domElement: eventTarget as unknown as HTMLElement,
    // Rapier is not what this is about, and it is the one slow thing to load.
    enablePhysics: false,
  });
}

beforeEach(() => {
  registerScript(WHERE, Where);
  seen.length = 0;
  held.length = 0;
});

afterEach(() => {
  clearScripts();
});

describe('scenes.current, as a script sees it', () => {
  it('names the first scene from its first onAwake and onStart', async () => {
    const host = hostOf({});
    await host.adopt('Menu', sceneWithWhere());

    expect(seen).toEqual([
      ['awake', 'Menu'],
      ['start', 'Menu'],
    ]);
    host.dispose();
  });

  it('names the scene moved to, not the one left', async () => {
    const host = hostOf({ Level: sceneWithWhere() });
    await host.adopt('Menu', sceneWithWhere());
    seen.length = 0;

    await host.go('Level');

    expect(seen).toEqual([
      ['awake', 'Level'],
      ['start', 'Level'],
    ]);
    expect(host.current).toBe('Level');
    host.dispose();
  });

  it('answers each scene’s scripts with their own scene, whatever the host is doing', async () => {
    // Two scenes can be under construction at once — a loading scene and the
    // one it stands in for — so a single name on the host would answer one of
    // them with the other's.
    const host = hostOf({ Level: sceneWithWhere() });
    await host.adopt('Menu', sceneWithWhere());
    await host.go('Level');

    expect(held.map((scenes) => scenes.current)).toEqual(['Menu', 'Level']);
    host.dispose();
  });
});
