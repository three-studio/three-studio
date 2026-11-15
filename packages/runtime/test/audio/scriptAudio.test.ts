import {
  audioSourceType,
  createEntity,
  fixedId,
  type AudioSourceComponent,
  type EntityId,
} from '@three-studio/core';
import { Group, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine';
import { audioSourceBehaviour } from '../../src/behaviour/audio';
import type { BehaviourContext } from '../../src/behaviour/Behaviour';
import { audioApiFor } from '../../src/scripting/audioApi';
import { flush, rig } from './rig';

/*
 * What a script can reach.
 *
 * The api drives the *behaviours*, not the engine, and that is the whole design:
 * a script asking a source to play is asking for the sound someone configured in
 * the Inspector, with its volume, its falloff and its bus. Building a parallel
 * voice instead would mean `playOnStart` and `this.audio.play()` produce two
 * copies of one clip and `stop()` stops the wrong one.
 */

const STEP = fixedId('asset', 'step');
const ME = fixedId('entity', 'me');
const DOOR = fixedId('entity', 'door');

function context(audio: AudioEngine | null): BehaviourContext {
  return { audio, warn: () => {} } as unknown as BehaviourContext;
}

/** Builds a source behaviour the way the engine does, so it registers itself. */
function mountSource(
  engine: AudioEngine,
  entityId: EntityId,
  overrides: Partial<AudioSourceComponent> = {},
): Object3D {
  const object = new Group();
  const entity = { ...createEntity('noise').entity, id: entityId };
  const component = { ...audioSourceType.create(), assetId: STEP, ...overrides };
  audioSourceBehaviour.create({ entity, object, component }, context(engine));
  return object;
}

describe('this.audio', () => {
  it('plays the source on the script`s own entity when told nothing else', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, ME);
    const api = audioApiFor(engine, ME);

    const voice = api.play();
    await flush();
    expect(voice?.state).toBe('playing');
    expect(engine.voices).toHaveLength(1);
  });

  it('plays another entity`s source when named', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, ME);
    mountSource(engine, DOOR);
    const api = audioApiFor(engine, ME);

    api.play('door');
    await flush();
    expect(engine.voices).toHaveLength(1);
  });

  it('plays nothing for a target that is not an id', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, ME);
    const api = audioApiFor(engine, ME);

    // What a script passes is text, and `''` names no entity, so no source is
    // found on it — the entity the script sits on is not played in its place.
    expect(api.play('')).toBeNull();
    await flush();
    expect(engine.voices).toHaveLength(0);
  });

  it('plays every source on an entity, because two is legal', async () => {
    // A door that creaks and slams carries one component each, and "play" means
    // the entity rather than whichever was added first.
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, DOOR);
    mountSource(engine, DOOR);
    const api = audioApiFor(engine, DOOR);

    api.play();
    await flush();
    expect(engine.voices).toHaveLength(2);
  });

  it('restarts rather than layering a second copy, as Unity does', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, ME);
    const api = audioApiFor(engine, ME);

    api.play();
    await flush();
    api.play();
    await flush();
    engine.update();

    expect(engine.voices).toHaveLength(1);
  });

  it('stops what it started', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    mountSource(engine, ME);
    const api = audioApiFor(engine, ME);

    api.play();
    await flush();
    api.stop();
    engine.update();
    expect(engine.voices).toHaveLength(0);
  });

  it('plays a clip nothing in the scene refers to', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const api = audioApiFor(engine, ME);

    const voice = api.playClip('step', { volume: 0.5, bus: 'ui' });
    await flush();
    expect(voice?.state).toBe('playing');
  });

  it('plays nothing for an id that is not one', async () => {
    const { engine } = rig({ step: { duration: 10 } });
    const api = audioApiFor(engine, ME);

    // What a script passes is whatever it made of a value: `''` is no clip, and
    // asked of the engine it would be a voice that can only fail.
    expect(api.playClip('')).toBeNull();
    await flush();
    expect(engine.voices).toHaveLength(0);
  });

  it('reaches the buses, which is what a settings screen needs', () => {
    const { engine } = rig();
    const api = audioApiFor(engine, ME);

    api.setBusVolume('music', 0.25);
    expect(api.bus('music')?.volume).toBe(0.25);

    api.setBusMute('music', true);
    expect(engine.mixer.gains().buses.music).toBe(0);

    api.setMasterVolume(0.5);
    expect(engine.mixer.gains().root).toBe(0.5);
  });

  it('does nothing at all, quietly, when the host handed over no audio', () => {
    // A browser with no Web Audio, or a test. A script must not have to ask
    // whether sound exists before asking for it.
    const api = audioApiFor(null, ME);
    expect(() => {
      api.play();
      api.stop();
      api.pause();
      api.resume();
      api.restart();
      api.setVolume(undefined, 0.5);
      api.setPitch(undefined, 2);
      api.setBusVolume('sfx', 0);
      api.setMasterVolume(0);
      api.stopAll();
    }).not.toThrow();
    expect(api.play()).toBeNull();
    expect(api.playClip('step')).toBeNull();
    expect(api.bus('sfx')).toBeUndefined();
  });
});
