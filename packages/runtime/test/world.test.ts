import {
  createAudioListenerEntity,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createRenderingSettings,
  fixedId,
  type Disposable,
  type SubsystemId,
} from '@three-studio/core';
import { OrthographicCamera, PerspectiveCamera } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import { AssetCache } from '../src/assets/AssetCache';
import { audioOf } from '../src/audio/audioOf';
import { Input } from '../src/input/Input';
import { inputOf } from '../src/input/inputOf';
import { collisionsOf, physicsOf } from '../src/physics/physicsOf';
import { Behaviour } from '../src/scripting/ScriptHost';
import { CAMERA_PRIORITY, CameraClaims } from '../src/world/cameras';
import { EntityChannel } from '../src/world/channel';
import { World, type Phase, type Subsystem, type SubsystemDefinition } from '../src/world/World';
import { FakeContext, FakeListener, type FakeParam } from './audio/fakeContext';
import {
  bundleOf,
  ground,
  nest,
  physicsRig,
  physicsRigOn,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withScript,
} from './physics/rig';
import { builtInRegistries, withoutPhysics } from './registries';

/*
 * A world in Play runs its registered subsystems: each built once, in the order
 * it was registered, its hooks run in the world's fixed phases by their order
 * keys, what it finds wrong said among the world's warnings, and each taken
 * down last first. Audio is the first of the kernel's.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A subsystem that writes what it is asked to do into `log`, under its id. */
function logging(
  id: SubsystemId,
  log: string[],
  hooks: readonly (Phase | 'diagnose')[],
  order?: SubsystemDefinition['order'],
): SubsystemDefinition {
  const name: string = id;
  return {
    id,
    ...(order === undefined ? {} : { order }),
    create() {
      log.push(`${name} created`);
      const subsystem: Subsystem = { dispose: () => void log.push(`${name} disposed`) };
      for (const hook of hooks) {
        if (hook === 'diagnose') subsystem.diagnose = () => [`${name} finds the scene wanting.`];
        else subsystem[hook] = (value: number) => void log.push(`${name}.${hook}(${value})`);
      }
      return subsystem;
    },
  };
}

/** Kernel registries with these subsystems registered after the kernel's own. */
function registriesWith(...definitions: readonly SubsystemDefinition[]) {
  const registries = builtInRegistries();
  for (const definition of definitions) registries.subsystems.register(definition);
  return registries;
}

describe('a world in Play', () => {
  it('builds each subsystem after those registered before it, which it may read', async () => {
    const log: string[] = [];
    const tallies = new WeakMap<object, number>();
    const counting: SubsystemDefinition = {
      id: fixedId('subsystem', 'counting'),
      create(world) {
        tallies.set(world, 3);
        return { dispose() {} };
      },
    };
    const reading: SubsystemDefinition = {
      id: fixedId('subsystem', 'reading'),
      // Awaited before the next one is built: a subsystem may need a module's
      // loading, as physics needs Rapier.
      async create(world) {
        await Promise.resolve();
        log.push(`read ${tallies.get(world)}`);
        return { dispose() {} };
      },
    };

    await physicsRigOn(registriesWith(counting, reading, logging(fixedId('subsystem', 'last'), log, [])))([]);

    expect(log).toEqual(['read 3', 'last created']);
  });

  it('runs each phase by its order keys, a tie in registration order', async () => {
    const log: string[] = [];
    const rig = await physicsRigOn(
      registriesWith(
        logging(fixedId('subsystem', 'a'), log, ['update', 'lateUpdate', 'renderPrep'], { update: 10, lateUpdate: -1 }),
        logging(fixedId('subsystem', 'b'), log, ['update', 'renderPrep', 'lateUpdate'], { update: -5 }),
        logging(fixedId('subsystem', 'c'), log, ['update', 'lateUpdate']),
      ),
    )([]);
    log.length = 0;

    rig.world.frame(0.5);

    expect(log).toEqual([
      'b.update(0.5)',
      'c.update(0.5)',
      'a.update(0.5)',
      'a.lateUpdate(0.5)',
      'b.lateUpdate(0.5)',
      'c.lateUpdate(0.5)',
      'a.renderPrep(0.5)',
      'b.renderPrep(0.5)',
    ]);
  });

  it('runs the fixed phase once per whole step, and not at all in a frame that holds none', async () => {
    const log: string[] = [];
    const rig = await physicsRigOn(registriesWith(logging(fixedId('subsystem', 'ticker'), log, ['fixed'])))([]);
    log.length = 0;
    const step = rig.world.fixedStep;

    rig.world.frame(0);
    expect(log).toEqual([]);

    rig.world.frame(step);
    expect(log).toEqual([`ticker.fixed(${step})`]);
  });

  it('says what each subsystem finds wrong, among the world’s warnings', async () => {
    const rig = await physicsRigOn(registriesWith(logging(fixedId('subsystem', 'fussy'), [], ['diagnose'])))([]);

    expect(rig.world.warnings).toContain('fussy finds the scene wanting.');
  });

  it('takes its subsystems down last first', async () => {
    const log: string[] = [];
    const rig = await physicsRigOn(
      registriesWith(
        logging(fixedId('subsystem', 'a'), log, []),
        logging(fixedId('subsystem', 'b'), log, []),
        logging(fixedId('subsystem', 'c'), log, []),
      ),
    )([]);
    log.length = 0;

    rig.world.dispose();

    expect(log).toEqual(['c disposed', 'b disposed', 'a disposed']);
  });

  it('refuses a second subsystem under an id already taken', () => {
    const registries = builtInRegistries();
    const audio: SubsystemId = fixedId('subsystem', 'audio');

    expect(() => registries.subsystems.register({ id: audio, create: () => ({ dispose() {} }) })).toThrow(
      /already registered/,
    );
  });

  it('takes down what it built when a subsystem cannot be built, and rejects', async () => {
    const log: string[] = [];
    const broken: SubsystemDefinition = {
      id: fixedId('subsystem', 'broken'),
      create() {
        throw new Error('No device for this one.');
      },
    };

    await expect(
      physicsRigOn(
        registriesWith(logging(fixedId('subsystem', 'a'), log, []), broken, logging(fixedId('subsystem', 'c'), log, [])),
      )([]),
    ).rejects.toThrow('No device for this one.');
    expect(log).toEqual(['a created', 'a disposed']);
  });
});

describe('audio, the first subsystem', () => {
  it('builds no engine for a world handed no audio context', async () => {
    const rig = await physicsRig([]);

    expect(audioOf(rig.world)).toBeNull();
  });

  it('places the ear on the camera the game is drawn through, when no entity carries a listener', async () => {
    const context = new FakeContext();
    const camera = createCameraEntity();
    camera.entity.transform.position = [3, 4, 5];
    const rig = await physicsRigOn(builtInRegistries(), { audioContext: context })([camera]);

    rig.world.frame(0);

    expect(audioOf(rig.world)).not.toBeNull();
    const ear = context.listener;
    if (!(ear instanceof FakeListener)) throw new Error('The fake context lent another listener.');
    // `+ 0` reads −0 as 0: forward is the camera's own −Z, negated.
    const triple = (...params: readonly FakeParam[]) => params.map((param) => param.target + 0);
    expect(triple(ear.positionX, ear.positionY, ear.positionZ)).toEqual([3, 4, 5]);
    expect(triple(ear.forwardX, ear.forwardY, ear.forwardZ)).toEqual([0, 0, -1]);
    expect(triple(ear.upX, ear.upY, ear.upZ)).toEqual([0, 1, 0]);
  });

  it('says so when two entities carry a listener', async () => {
    const rig = await physicsRigOn(builtInRegistries(), { audioContext: new FakeContext() })([
      createAudioListenerEntity(),
      createAudioListenerEntity(),
    ]);

    expect(rig.world.warnings).toContain(
      '2 entities carry an Audio Listener; only one ear is placed and the others are ignored.',
    );
  });
});

describe('input, a subsystem', () => {
  it('is the world’s `Input`, hearing the element it was handed, and goes with the world', async () => {
    const rig = await physicsRig([]);
    const input = inputOf(rig.world);

    expect(input).toBeInstanceOf(Input);
    rig.press('KeyW');
    expect(input?.isDown('KeyW')).toBe(true);
    rig.release('KeyW');

    rig.world.dispose();
    rig.press('KeyW');
    expect(inputOf(rig.world)).toBeNull();
    expect(input?.isDown('KeyW')).toBe(false);
  });

  it('is absent from a world handed no element, where a player controller drives nothing', async () => {
    const registries = builtInRegistries();
    const world = await World.play({
      document: sceneWith([player([0, 1, 0])]),
      registries: withoutPhysics(registries),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
    });
    onTestFinished(() => world.dispose());

    expect(inputOf(world)).toBeNull();
    // No player was built to claim the view.
    expect(world.warnings).toContain('No camera and no player controller; using a default view.');
  });
});

describe('the fixed step', () => {
  it('runs one tick per whole step, keeps the rest, and says how far into the next it is', async () => {
    const log: string[] = [];
    const rig = await physicsRigOn(registriesWith(logging(fixedId('subsystem', 'ticker'), log, ['fixed'])))([]);
    log.length = 0;
    const step = rig.world.fixedStep;

    rig.world.frame(step * 2.5);
    expect(log).toHaveLength(2);
    expect(rig.world.fixedAlpha).toBeCloseTo(0.5, 6);

    rig.world.frame(step);
    expect(log).toHaveLength(3);
    expect(rig.world.fixedAlpha).toBeCloseTo(0.5, 6);
  });

  it('runs no more ticks in a frame than the project’s substeps, and drops the rest', async () => {
    const log: string[] = [];
    const rig = await physicsRigOn(registriesWith(logging(fixedId('subsystem', 'ticker'), log, ['fixed'])))([], {
      maxSubsteps: 3,
    });
    log.length = 0;

    rig.world.frame(rig.world.fixedStep * 10);

    expect(log).toHaveLength(3);
    expect(rig.world.fixedAlpha).toBeLessThan(1);
  });

  it('runs the behaviours’ fixed hooks in a world with no physics', async () => {
    const ticks: number[] = [];
    class Ticking extends Behaviour {
      override onFixedUpdate(step: number) {
        ticks.push(step);
      }
    }
    const ticker = withScript(createEntity('Ticker'), Ticking);
    const registries = builtInRegistries();
    const world = await World.play({
      document: sceneWith([ticker]),
      registries: withoutPhysics(registries),
      scripts: bundleOf([ticker]),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
    });
    onTestFinished(() => world.dispose());

    world.frame(world.fixedStep);

    expect(physicsOf(world)).toBeNull();
    expect(ticks).toEqual([world.fixedStep]);
  });
});

describe('an entity channel', () => {
  const door = fixedId('entity', 'door');
  const lamp = fixedId('entity', 'lamp');

  it('tells an entity’s listeners in the order they began, and no other entity’s', () => {
    const channel = new EntityChannel<string>();
    const heard: string[] = [];
    channel.listen(door, (event) => heard.push(`first ${event}`));
    channel.listen(lamp, (event) => heard.push(`lamp ${event}`));
    channel.listen(door, (event) => heard.push(`second ${event}`));

    channel.publish(door, 'opens');

    expect(heard).toEqual(['first opens', 'second opens']);
    expect(channel.listenedEntities()).toEqual([door, lamp]);
  });

  it('stops telling a listener once it is disposed, and forgets an entity nobody listens on', () => {
    const channel = new EntityChannel<string>();
    const heard: string[] = [];
    const listening = channel.listen(door, (event) => heard.push(event));

    channel.publish(door, 'once');
    listening.dispose();
    listening.dispose();
    channel.publish(door, 'twice');

    expect(heard).toEqual(['once']);
    expect(channel.listenedEntities()).toEqual([]);
  });

  it('finishes the publish in hand when a listener stops another', () => {
    const channel = new EntityChannel<string>();
    const heard: string[] = [];
    let later: Disposable | null = null;
    channel.listen(door, () => {
      heard.push('first');
      later?.dispose();
    });
    later = channel.listen(door, () => heard.push('later'));

    channel.publish(door, 'one');
    channel.publish(door, 'two');

    expect(heard).toEqual(['first', 'later', 'first']);
  });
});

describe('physics, a subsystem', () => {
  it('publishes what a child’s collider touches to its entity, then to its body’s', async () => {
    const cart = withBody('box', [0, 3, 0], { lockRotation: { x: true, y: true, z: true } });
    const wheel = withCollider('sphere', [0, -1.5, 0]);
    nest(cart, wheel);
    const rig = await physicsRig([cart, wheel, ground()]);
    const heard: string[] = [];
    // Listened on body first: the order is physics', not the listeners'.
    collisionsOf(rig.world)?.listen(cart.entity.id, (touch) => heard.push(`cart ${touch.kind}`));
    collisionsOf(rig.world)?.listen(wheel.entity.id, (touch) => heard.push(`wheel ${touch.kind}`));

    rig.run(2);

    expect(heard).toEqual(['wheel collisionEnter', 'cart collisionEnter']);
  });
});

describe('camera claims', () => {
  it('give the view to the highest priority, the first to claim among equals, else a default view', () => {
    const claims = new CameraClaims();
    const authored = new PerspectiveCamera();
    const firstMain = new PerspectiveCamera();
    const secondMain = new PerspectiveCamera();
    const driven = new PerspectiveCamera();
    const fallback = claims.active;
    expect(fallback.position.toArray()).toEqual([8, 6, 12]);

    const byAuthored = claims.claim(authored, CAMERA_PRIORITY.authored);
    const byFirstMain = claims.claim(firstMain, CAMERA_PRIORITY.main);
    const bySecondMain = claims.claim(secondMain, CAMERA_PRIORITY.main);
    const byDriven = claims.claim(driven, CAMERA_PRIORITY.driven);
    expect(claims.active).toBe(driven);

    byDriven.dispose();
    expect(claims.active).toBe(firstMain);
    byFirstMain.dispose();
    byFirstMain.dispose();
    expect(claims.active).toBe(secondMain);
    bySecondMain.dispose();
    expect(claims.active).toBe(authored);
    byAuthored.dispose();
    expect(claims.active).toBe(fallback);
  });

  it('fit a perspective camera by its aspect and an orthographic one by its width, then each that claims later', () => {
    const claims = new CameraClaims();
    const perspective = new PerspectiveCamera(60, 1);
    claims.claim(perspective, CAMERA_PRIORITY.main);

    claims.setAspect(2);
    const orthographic = new OrthographicCamera(-5, 5, 5, -5);
    claims.claim(orthographic, CAMERA_PRIORITY.authored);

    expect(perspective.aspect).toBe(2);
    expect([orthographic.left, orthographic.right, orthographic.top, orthographic.bottom]).toEqual([-10, 10, 5, -5]);
  });

  it('say there is no camera only when nothing claims the view', () => {
    const claims = new CameraClaims();
    expect(claims.diagnose()).toEqual(['No camera and no player controller; using a default view.']);

    claims.claim(new PerspectiveCamera(), CAMERA_PRIORITY.authored);
    expect(claims.diagnose()).toEqual([]);
  });

  it('are made in Play by the scene’s cameras, its main one drawn through and two of them said', async () => {
    const first = createCameraEntity();
    const second = createCameraEntity();
    const plain = createCameraEntity();
    for (const camera of [first, second]) {
      const component = camera.components[0];
      if (component?.type !== 'camera') throw new Error('A camera entity holds a camera.');
      component.isMain = true;
    }
    const rig = await physicsRig([plain, first, second, createLightEntity('directional')]);

    expect(rig.world.cameras.active).toBe(rig.world.binder.getObject(first.entity.id)?.children[0]);
    expect(rig.world.warnings).toContain('2 cameras are marked main; the first one is used.');
    expect(rig.world.warnings.filter((line) => line.includes('No camera'))).toEqual([]);
  });

  it('say a scene with no light renders black, from the light system, and nothing of one lit', async () => {
    const dark = await physicsRig([createCameraEntity()]);
    const lit = await physicsRig([createCameraEntity(), createLightEntity('point')]);

    expect(dark.world.warnings).toContain(
      'This scene has no lights, so it renders black. While you edit, the Viewport lights it with a default light that Play and a build do not have.',
    );
    expect(lit.world.warnings.filter((line) => line.includes('no lights'))).toEqual([]);
  });
});
