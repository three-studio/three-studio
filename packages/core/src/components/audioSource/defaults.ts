import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { AudioSourceComponent } from './schema';

export function createAudioSource(): AudioSourceComponent {
  return {
    id: createId(),
    type: 'audioSource',
    assetId: '',
    // Defaults to fully positional: a sound placed on an entity in 3D space is
    // almost always meant to come from there.
    spatialBlend: 1,
    volume: 1,
    pitch: 1,
    loop: false,
    playOnStart: false,
    bus: 'sfx',
    distanceModel: 'inverse',
    refDistance: 1,
    maxDistance: 50,
    rolloffFactor: 1,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 0,
    mute: false,
    detune: 0,
    startOffset: 0,
    delay: 0,
    fadeIn: 0,
    fadeOut: 0,
    // Unity's default sits in the middle of its 0–256 range, which leaves room
    // to say "this one matters" in both directions without editing everything
    // else first.
    priority: 128,
  };
}

/**
 * An entity whose whole job is to make a noise somewhere.
 *
 * Named after the clip when there is one, because the alternative — six entities
 * called "Audio Source" in the hierarchy — is what a designer has to rename by
 * hand every single time. The same reason a dropped model is named after its
 * file.
 */
export function createAudioSourceEntity(assetId = '', name = 'Audio Source'): EntityTemplate {
  const component = createAudioSource();
  component.assetId = assetId;
  return createEntity(name, [component]);
}
