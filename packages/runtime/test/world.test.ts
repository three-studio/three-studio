import {
  createAudioListenerEntity,
  createCameraEntity,
  createRenderingSettings,
  fixedId,
  type SubsystemId,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { NULL_ASSET_RESOLVER } from '../src/assets/AssetResolver';
import { AssetCache } from '../src/assets/AssetCache';
import { audioOf } from '../src/audio/audioOf';
import { Input } from '../src/input/Input';
import { inputOf } from '../src/input/inputOf';
import { World, type Phase, type Subsystem, type SubsystemDefinition } from '../src/world/World';
import { FakeContext, FakeListener, type FakeParam } from './audio/fakeContext';
import { physicsRig, physicsRigOn, player, standInForTheBrowser, takeTheBrowserBack } from './physics/rig';
import { builtInRegistries } from './registries';

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
      registries,
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
      enablePhysics: false,
    });
    onTestFinished(() => world.dispose());

    expect(inputOf(world)).toBeNull();
    expect(world.behaviours).toEqual([]);
  });
});
