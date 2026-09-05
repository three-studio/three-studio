import { createCameraEntity } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

export const menu: AddMenuGroup = {
  label: 'Camera',
  order: 3,
  entries: [
    { label: 'Perspective', create: () => createCameraEntity('perspective') },
    { label: 'Orthographic', create: () => createCameraEntity('orthographic') },
  ],
};
