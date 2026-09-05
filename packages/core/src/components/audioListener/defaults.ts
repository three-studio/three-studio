import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { AudioListenerComponent } from './schema';

export function createAudioListener(): AudioListenerComponent {
  return { id: createId(), type: 'audioListener', masterVolume: 1 };
}

/** The ear, as its own entity, for a scene that wants it off the camera. */
export function createAudioListenerEntity(): EntityTemplate {
  return createEntity('Audio Listener', [createAudioListener()]);
}
