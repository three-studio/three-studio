import {
  assertDefined,
  createEntity,
  createLightEntity,
  findComponent,
  fixedId,
  instancedId,
  type ComponentType,
  type EntityId,
  type EntityTemplate,
} from '@three-studio/core';
import { PerspectiveCamera, Vector3, type Object3D } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import type { Behaviour, BehaviourDefinition } from '../src/behaviour/Behaviour';
import { collisionsOf, physicsOf } from '../src/physics/physicsOf';
import { Behaviour as ScriptBehaviour } from '../src/scripting/ScriptHost';
import type { SubsystemDefinition, World } from '../src/world/World';
import { nest, physicsRigOn, standInForTheBrowser, takeTheBrowserBack, withBody, withScript } from './physics/rig';
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

/** A light named for a log. */
function lamp(name: string): EntityTemplate {
  const template = createLightEntity('point');
  template.entity.name = name;
  return template;
}

/*
 * A behaviour is made for its component: those of the scene once the whole
 * scene is built, every `onAwake` then every `onStart`; those a running game
 * spawns at the end of the pass that mounts them, before their first update;
 * and taken down at the pass that unmounts them.
 */
describe('behaviours mounted per entity', () => {
  it('are all awake, then all started, once the scene is built, types in registry then entities in table order', async () => {
    const log: string[] = [];
    const registries = registriesWith('light', ({ entity }) => {
      log.push(`awake ${entity.name}`);
      return { start: () => void log.push(`start ${entity.name}`) };
    });
    let ids: readonly EntityId[] = [];
    let resolved = 0;
    class Logged extends ScriptBehaviour {
      override onAwake() {
        log.push(`awake ${this.entity.name}`);
      }

      override onStart() {
        log.push(`start ${this.entity.name}`);
        resolved = ids.filter((id) => this.resolve(id) !== null).length;
      }
    }
    const scene = [
      lamp('Lamp A'),
      withScript(createEntity('First'), Logged),
      lamp('Lamp B'),
      withScript(createEntity('Second'), Logged),
    ];
    ids = scene.map((template) => template.entity.id);

    await physicsRigOn(registries)(scene);

    expect(log).toEqual([
      'awake First',
      'awake Second',
      'awake Lamp A',
      'awake Lamp B',
      'start First',
      'start Second',
      'start Lamp A',
      'start Lamp B',
    ]);
    expect(resolved).toBe(4);
  });

  it('make a spawned script awake, then started, at the frame’s pass, before its first update', async () => {
    const log: string[] = [];
    class Spawned extends ScriptBehaviour {
      override onAwake() {
        log.push('awake');
      }

      override onStart() {
        log.push('start');
      }

      override onUpdate() {
        log.push('update');
      }
    }
    const later = withScript(createEntity('Later'), Spawned);
    const rig = await physicsRigOn(builtInRegistries(), { spawnable: [later] })([]);

    rig.world.spawn(later);
    expect(log).toEqual([]);
    rig.world.frame(rig.world.fixedStep);
    expect(log).toEqual(['awake', 'start']);
    rig.world.frame(rig.world.fixedStep);
    expect(log).toEqual(['awake', 'start', 'update']);
  });

  it('start the scripts of a placed prefab once all of it is there, each resolving the other', async () => {
    const pairId = fixedId('asset', 'pair');
    const left = fixedId('entity', 'left');
    const right = fixedId('entity', 'right');
    const seen: string[] = [];
    let placed: EntityId | null = null;
    class Twin extends ScriptBehaviour {
      override onStart() {
        const other = instancedId(assertDefined(placed, 'the placement'), this.entity.name === 'Left' ? right : left);
        seen.push(`${this.entity.name} sees ${this.resolve(other)?.name ?? 'nothing'}`);
      }
    }
    const holder = createEntity('Pair');
    const leftTwin = withScript(createEntity('Left'), Twin);
    leftTwin.entity.id = left;
    const rightTwin = withScript(createEntity('Right'), Twin);
    rightTwin.entity.id = right;
    const prefab = {
      ...prefabWith('Pair', [nest(holder, leftTwin, rightTwin), leftTwin, rightTwin], holder.entity.id),
      id: pairId,
    };
    const rig = await physicsRigOn(builtInRegistries(), {
      spawnable: [leftTwin, rightTwin],
      prefabs: new Map([[pairId, prefab]]),
    })([]);

    placed = rig.world.instantiate(pairId);
    rig.world.frame(rig.world.fixedStep);

    expect(seen).toEqual(['Left sees Right', 'Right sees Left']);
  });

  it('run a spawned behaviour’s hooks after those of its type there before it, before the next type’s', async () => {
    const log: string[] = [];
    const registries = registriesWith('light', ({ entity }) => ({ update: () => void log.push(entity.name) }));
    class Named extends ScriptBehaviour {
      override onUpdate() {
        log.push(this.entity.name);
      }
    }
    const later = withScript(createEntity('Later'), Named);
    const rig = await physicsRigOn(registries, { spawnable: [later] })([
      lamp('Lamp'),
      withScript(createEntity('First'), Named),
    ]);

    rig.world.spawn(later);
    rig.world.frame(rig.world.fixedStep);
    log.length = 0;
    rig.world.frame(rig.world.fixedStep);

    expect(log).toEqual(['First', 'Later', 'Lamp']);
  });

  it('take an entity’s behaviours down at the pass destroying it, still in place, claim and listener too', async () => {
    const camera = new PerspectiveCamera();
    const registries = registriesWith('light', () => ({ camera }));
    let parentAtDestroy: Object3D | null = null;
    class Listening extends ScriptBehaviour {
      override onCollisionEnter() {}

      override onDestroy() {
        parentAtDestroy = this.transform.parent;
      }
    }
    const holder = createEntity('Holder');
    const child = withScript(lamp('Child'), Listening);
    const rig = await physicsRigOn(registries)([nest(holder, child), child]);
    const collisions = assertDefined(collisionsOf(rig.world), 'the collision channel');
    expect(rig.world.cameras.active).toBe(camera);
    expect(collisions.listenedEntities()).toEqual([child.entity.id]);

    rig.world.destroy(child.entity.id);
    rig.world.frame(rig.world.fixedStep);

    expect(parentAtDestroy).toBe(rig.world.binder.getObject(holder.entity.id));
    expect(rig.world.cameras.active).not.toBe(camera);
    expect(collisions.listenedEntities()).toEqual([]);
  });

  it('leave a behaviour as it was when its component is put again', async () => {
    const log: string[] = [];
    class Counted extends ScriptBehaviour {
      override onAwake() {
        log.push('awake');
      }

      override onDestroy() {
        log.push('destroy');
      }
    }
    const holder = withScript(createEntity('Holder'), Counted);
    const rig = await physicsRigOn(builtInRegistries())([holder]);
    const script = assertDefined(findComponent(rig.world.document, holder.entity.id, 'script'), 'the script');

    rig.world.putComponent(holder.entity.id, { ...script, props: { speed: 2 } });
    rig.world.frame(rig.world.fixedStep);

    expect(log).toEqual(['awake']);
  });
});
