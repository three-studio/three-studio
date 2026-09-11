import { PLAYER_CONTROLLER_MODE_LABELS, optionsFrom } from '@three-studio/core';
import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Player Controller',
  fields: [
    {
      path: ['mode'],
      label: 'Mode',
      type: 'enum',
      options: optionsFrom(PLAYER_CONTROLLER_MODE_LABELS),
    },
    { path: ['moveSpeed'], label: 'Move speed', type: 'number', min: 0.1, max: 40, step: 0.1 },
    {
      path: ['sprintMultiplier'],
      label: 'Sprint ×',
      type: 'number', min: 1, max: 5, step: 0.1,
    },
    { path: ['jumpHeight'], label: 'Jump height', type: 'number', min: 0, max: 10, step: 0.1 },
    {
      path: ['mouseSensitivity'],
      label: 'Mouse sensitivity',
      type: 'number', min: 0.0002, max: 0.01, step: 0.0001,
    },
    {
      path: ['eyeHeight'],
      label: 'Eye height',
      type: 'number', min: 0, max: 4, step: 0.05,
      visibleWhen: (c) => c.type === 'playerController' && c.mode === 'fps',
    },
    {
      path: ['cameraDistance'],
      label: 'Camera distance',
      type: 'number', min: 0.5, max: 25, step: 0.1,
      visibleWhen: (c) => c.type === 'playerController' && c.mode === 'tps',
    },
  ],
};
