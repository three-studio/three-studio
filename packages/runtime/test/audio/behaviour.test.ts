import { createAudioSource, createComponent, createEntity, type AudioSourceComponent } from '@three-studio/core';
import { Group, Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { playRequestFor } from '../../src/behaviour/audio';
import { behaviourFactoryFor, type BehaviourContext } from '../../src/behaviour/Behaviour';
import type { AudioEngine } from '../../src/audio/AudioEngine';
import { flush, rig } from './rig';

/*
 * The glue: a component becomes a request, and a request becomes a voice.
 *
 * `Engine` itself is not built here — it wants a DOM element and a Rapier
 * world, neither of which exists under node. The registration is real though,
 * so asking the registry for the factory exercises exactly what the engine
 * would call.
 */

function source(overrides: Partial<AudioSourceComponent> = {}): AudioSourceComponent {
  return { ...createAudioSource(), assetId: 'step', ...overrides };
}

function at(x: number, y: number, z: number): Object3D {
  const object = new Group();
  object.position.set(x, y, z);
  object.updateMatrixWorld(true);
  return object;
}

function context(audio: AudioEngine | null): BehaviourContext {
  return { audio, warn: () => {} } as unknown as BehaviourContext;
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
    expect(behaviourFactoryFor('audioSource')).toBeTypeOf('function');
    expect(behaviourFactoryFor('audioListener')).toBeTypeOf('function');
  });

  it('declines to build when the host handed over no audio', () => {
    const factory = behaviourFactoryFor('audioSource');
    const built = factory?.(
      { entity: createEntity('noise').entity, object: at(0, 0, 0), component: source() },
      context(null),
    );
    expect(built).toBeNull();
  });

  it('plays on start only when the component says so', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const factory = behaviourFactoryFor('audioSource');
    const entity = createEntity('noise').entity;

    const quiet = factory?.(
      { entity, object: at(0, 0, 0), component: source({ playOnStart: false }) },
      context(engine),
    );
    quiet?.start?.(context(engine));
    await flush();
    expect(engine.voices).toHaveLength(0);

    const loud = factory?.(
      { entity, object: at(0, 0, 0), component: source({ playOnStart: true }) },
      context(engine),
    );
    loud?.start?.(context(engine));
    await flush();
    expect(engine.voices).toHaveLength(1);
  });

  it('follows its entity, and does so after physics rather than before', async () => {
    const { context: audioContext, engine } = rig({ step: { duration: 10 } });
    const object = at(0, 0, 0);
    const factory = behaviourFactoryFor('audioSource');
    const behaviour = factory?.(
      { entity: createEntity('noise').entity, object, component: source({ playOnStart: true }) },
      context(engine),
    );
    behaviour?.start?.(context(engine));
    await flush();

    object.position.set(7, 0, 0);
    // Deliberately not `updateMatrixWorld`: the behaviour has to ask for it
    // itself, because `postUpdate` runs before the render traversal that would
    // otherwise have refreshed it — and a sound one frame behind its object is
    // the bug this guards.
    behaviour?.postUpdate?.(context(engine));

    expect(audioContext.panners[0]?.positionX.target).toBe(7);
    // And it is `postUpdate` that does it, not `update`.
    expect(behaviour?.update).toBeUndefined();
  });

  it('stops what it started when the scene is left', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const factory = behaviourFactoryFor('audioSource');
    const behaviour = factory?.(
      {
        entity: createEntity('noise').entity,
        object: at(0, 0, 0),
        component: source({ playOnStart: true }),
      },
      context(engine),
    );
    behaviour?.start?.(context(engine));
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
    const factory = behaviourFactoryFor('audioListener');
    const listener = createComponent('audioListener');
    listener.masterVolume = 0.5;

    const behaviour = factory?.(
      { entity: createEntity('ear').entity, object: at(2, 3, 4), component: listener },
      context(engine),
    );
    behaviour?.start?.(context(engine));

    const ear = audioContext.listener as unknown as { positionY: { target: number } };
    expect(ear.positionY.target).toBe(3);
    expect(engine.mixer.gains().root).toBe(0.5);
  });
});
