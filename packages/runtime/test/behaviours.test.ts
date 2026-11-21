import { createEntity, fixedId, type ComponentType, type EntityId } from '@three-studio/core';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Behaviour, BehaviourDefinition } from '../src/behaviour/Behaviour';
import { physicsOf } from '../src/physics/physicsOf';
import { Behaviour as ScriptBehaviour } from '../src/scripting/ScriptHost';
import type { SubsystemDefinition, World } from '../src/world/World';
import { physicsRigOn, standInForTheBrowser, takeTheBrowserBack, withBody, withScript } from './physics/rig';
import { builtInRegistries } from './registries';

/*
 * The behaviours are a subsystem of their world: built from the registry they
 * are handed, after input, physics and audio; run in the world's phases at 0,
 * so a body ticks after their fixed hook and is drawn before their late one;
 * claiming the view for a camera they drive; told the scene is left before
 * they are taken down.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);
afterEach(() => {
  vi.restoreAllMocks();
});

/** Kernel registries with this behaviour registered for `type`, beside the kernel's own. */
function registriesWith(type: ComponentType, create: BehaviourDefinition['create']) {
  const registries = builtInRegistries();
  registries.behaviours.register({ id: type, create });
  return registries;
}

describe('the behaviours, a subsystem', () => {
  it('run their hooks where they always ran around physics: a tick after the fixed one, the body drawn before the late one', async () => {
    const log: string[] = [];
    const ball = withBody('sphere', [0, 5, 0], { interpolate: false });
    const registries = registriesWith('rigidbody', () => ({
      update: () => void log.push('update'),
      fixedUpdate: () => void log.push('fixedUpdate'),
      postUpdate: () => void log.push('postUpdate'),
    }));
    // Either side of physics in the two phases it claims: where its body is
    // solved, and where its entity is drawn.
    let world: World | null = null;
    const solved = () => physicsOf(world ?? fail())?.body(ball.entity.id)?.position.y ?? NaN;
    const drawn = () =>
      (world ?? fail()).binder.getObject(ball.entity.id)?.getWorldPosition(new Vector3()).y ?? NaN;
    const probe: SubsystemDefinition = {
      id: fixedId('subsystem', 'probe'),
      order: { fixed: 99, lateUpdate: -101 },
      create: () => ({
        fixed: () => void log.push(`before tick ${solved()}`),
        lateUpdate: () => void log.push(`before draw ${drawn()}`),
        dispose() {},
      }),
    };
    registries.subsystems.register(probe);
    const rig = await physicsRigOn(registries)([ball]);
    world = rig.world;
    log.length = 0;

    rig.world.frame(rig.world.fixedStep);

    expect(log).toEqual(['update', 'fixedUpdate', 'before tick 5', 'before draw 5', 'postUpdate']);
    // The tick ran after the probe's fixed hook, and the draw after its late one.
    expect(solved()).toBeLessThan(5);
    expect(drawn()).toBeLessThan(5);
  });

  it('claim the view for a camera they drive, the first of two winning, and say there are two', async () => {
    const cameras = new Map<EntityId, PerspectiveCamera>();
    const registries = registriesWith('rigidbody', ({ entity }) => {
      const camera = new PerspectiveCamera();
      cameras.set(entity.id, camera);
      return { camera };
    });
    const first = withBody('box', [0, 0, 0]);
    const second = withBody('box', [3, 0, 0]);
    const rig = await physicsRigOn(registries)([first, second]);

    expect(rig.world.cameras.active).toBe(cameras.get(first.entity.id));
    expect(rig.world.warnings).toContain('2 components want to drive the camera; the first one wins.');
  });

  it('hear the scene is left before they are taken down, one that throws stopping none', async () => {
    const log: string[] = [];
    const registries = registriesWith('rigidbody', ({ entity }): Behaviour => ({
      onSceneUnload: () => {
        log.push(`${entity.name} leaves`);
        if (entity.name === 'Stubborn') throw new Error('Not leaving.');
      },
      dispose: () => void log.push(`${entity.name} goes`),
    }));
    const stubborn = withBody('box', [0, 0, 0]);
    stubborn.entity.name = 'Stubborn';
    const calm = withBody('box', [3, 0, 0]);
    calm.entity.name = 'Calm';
    const rig = await physicsRigOn(registries)([stubborn, calm]);

    // What one refusing to leave prints is not this test's to show.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rig.world.notifySceneUnload();
    rig.world.dispose();

    expect(log).toEqual(['Stubborn leaves', 'Calm leaves', 'Stubborn goes', 'Calm goes']);
  });

  it('tell a script the scene is left, before it is destroyed', async () => {
    const calls: string[] = [];
    class Leaving extends ScriptBehaviour {
      override onSceneUnload() {
        calls.push('unload');
      }

      override onDestroy() {
        calls.push('destroy');
      }
    }
    const rig = await physicsRigOn(builtInRegistries())([withScript(createEntity('Holder'), Leaving)]);

    rig.world.notifySceneUnload();
    rig.world.dispose();

    expect(calls).toEqual(['unload', 'destroy']);
  });

  it('disable a script whose hook throws, say so once, and still let it clean up', async () => {
    const calls: string[] = [];
    class Faulty extends ScriptBehaviour {
      override onUpdate() {
        calls.push('update');
        throw new Error('Broken.');
      }

      override onDestroy() {
        calls.push('destroy');
      }
    }
    const holder = withScript(createEntity('Holder'), Faulty);
    const rig = await physicsRigOn(builtInRegistries())([holder]);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    rig.run(0.1);
    rig.world.dispose();

    expect(calls).toEqual(['update', 'destroy']);
    expect(rig.world.warnings.filter((line) => line.includes('failed in onUpdate'))).toEqual([
      'Holder/Faulty failed in onUpdate: Broken.',
    ]);
  });
});

function fail(): never {
  throw new Error('The world is not built yet.');
}
