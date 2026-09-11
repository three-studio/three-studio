import { createAudioListenerEntity } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

export const menu: AddMenuGroup = {
  label: 'Audio',
  order: 4,
  entries: [
    // Rarely reached for, and worth having: without one the ear rides the
    // camera, which is right until the camera is not where the player is.
    { label: 'Audio Listener', create: () => createAudioListenerEntity() },
  ],
};
