import {
  audioListenerType,
  audioSourceType,
  createEntity,
  createRenderingSettings,
  fixedId,
  type AudioSourceComponent,
} from '@three-studio/core';
import { Group, Object3D } from 'three/webgpu';
import { describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { AssetCache } from '../../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import {
  audioListenerBehaviour,
  audioListenerOn,
  audioSourceBehaviour,
  audioSourceOn,
  playRequestFor,
} from '../../src/behaviour/audio';
import { World } from '../../src/world/World';
import { builtInRegistries, withoutPhysics } from '../registries';
import { flush, rig } from './rig';
import { StudioTime } from '../../src/time/StudioTime';

/*
 * The glue: a component becomes a request, and a request becomes a voice.
 *
 * Built on an engine of the test's own, through what the definitions build
 * with once their world has one: the same code, with the mix in the test's
 * hands. The definitions are the ones the runtime's activation registers.
 */

const STEP = fixedId('asset', 'step');

function source(overrides: Partial<AudioSourceComponent> = {}): AudioSourceComponent {
  return { ...audioSourceType.create(), assetId: STEP, ...overrides };
}

function at(x: number, y: number, z: number): Object3D {
  const object = new Group();
  object.position.set(x, y, z);
  object.updateMatrixWorld(true);
  return object;
}

describe('playRequestFor', () => {
  it('leaves a flat source with no spatial block at all', () => {
    const request = playRequestFor(source({ spatialBlend: 0 }), at(5, 0, 0));
    expect(request.spatial).toBeNull();
  });

  it('reads the entity`s world position', () => {
    const request = playRequestFor(source(), at(1, 2, 3));
    expect(request.spatial?.position).toEqual([1, 2, 3]);
  });

  it('faces −Z, the way everything else in this editor faces', () => {
    const object = at(0, 0, 0);
    // A quarter turn about Y takes −Z onto −X.
    object.rotation.y = Math.PI / 2;
    object.updateMatrixWorld(true);

    const forward = playRequestFor(source(), object).spatial?.forward ?? [0, 0, 0];
    expect(forward[0]).toBeCloseTo(-1);
    expect(forward[2]).toBeCloseTo(0);
  });

  it('carries the falloff and the cone across unchanged', () => {
    const request = playRequestFor(
      source({ refDistance: 4, maxDistance: 90, coneInnerAngle: 30, coneOuterGain: 0.2 }),
      at(0, 0, 0),
    );
    expect(request.spatial?.refDistance).toBe(4);
    expect(request.spatial?.maxDistance).toBe(90);
    expect(request.spatial?.coneInnerAngle).toBe(30);
    expect(request.spatial?.coneOuterGain).toBe(0.2);
  });

  it('turns mute into a volume of zero, keeping the volume that was set', () => {
    const component = source({ volume: 0.8, mute: true });
    expect(playRequestFor(component, at(0, 0, 0)).volume).toBe(0);
    // The document still says 0.8, which is what unmuting has to give back.
    expect(component.volume).toBe(0.8);
  });
});

describe('the audioSource behaviour', () => {
  it('is registered, which is what `runtime: true` claims', () => {
    const registries = builtInRegistries();
    expect(registries.behaviours.get('audioSource')).toBe(audioSourceBehaviour);
    expect(registries.behaviours.get('audioListener')).toBe(audioListenerBehaviour);
  });

  it('declines to build in a world the host handed no audio', async () => {
    const registries = builtInRegistries();
    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([]),
      registries: withoutPhysics(registries),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
    });
    onTestFinished(() => world.dispose());

    const built = audioSourceBehaviour.create(
      { entity: createEntity('noise').entity, object: at(0, 0, 0), component: source() },
      world,
    );
    expect(built).toBeNull();
  });

  it('plays on start only when the component says so', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const entity = createEntity('noise').entity;

    const quiet = audioSourceOn(engine, {
      entity,
      object: at(0, 0, 0),
      component: source({ playOnStart: false }),
    });
    quiet?.start?.();
    await flush();
    expect(engine.voices).toHaveLength(0);

    const loud = audioSourceOn(engine, { entity, object: at(0, 0, 0), component: source({ playOnStart: true }) });
    loud?.start?.();
    await flush();
    expect(engine.voices).toHaveLength(1);
  });

  it('follows its entity, and does so after physics rather than before', async () => {
    const { context: audioContext, engine } = rig({ step: { duration: 10 } });
    const object = at(0, 0, 0);
    const behaviour = audioSourceOn(engine, {
      entity: createEntity('noise').entity,
      object,
      component: source({ playOnStart: true }),
    });
    behaviour?.start?.();
    await flush();

    object.position.set(7, 0, 0);
    // Deliberately not `updateMatrixWorld`: the behaviour has to ask for it
    // itself, because `postUpdate` runs before the render traversal that would
    // otherwise have refreshed it — and a sound one frame behind its object is
    // the bug this guards.
    behaviour?.postUpdate?.();

    expect(audioContext.panners[0]?.positionX.target).toBe(7);
    // And it is `postUpdate` that does it, not `update`.
    expect(behaviour?.update).toBeUndefined();
  });

  it('stops what it started when the scene is left', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const behaviour = audioSourceOn(engine, {
      entity: createEntity('noise').entity,
      object: at(0, 0, 0),
      component: source({ playOnStart: true }),
    });
    behaviour?.start?.();
    await flush();
    expect(engine.voices).toHaveLength(1);

    behaviour?.onSceneUnload?.();
    engine.update();
    expect(engine.voices).toHaveLength(0);
  });
});

describe('the audioListener behaviour', () => {
  it('places the ear where its entity is, and takes the master volume with it', () => {
    const { context: audioContext, engine } = rig();
    const listener = audioListenerType.create();
    listener.masterVolume = 0.5;

    const behaviour = audioListenerOn(engine, {
      entity: createEntity('ear').entity,
      object: at(2, 3, 4),
      component: listener,
    });
    behaviour?.start?.();

    const ear = audioContext.listener as unknown as { positionY: { target: number } };
    expect(ear.positionY.target).toBe(3);
    expect(engine.mixer.gains().root).toBe(0.5);
  });
});
