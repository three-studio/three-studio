import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Player Controller',
  fields: [
    { path: ['mode'], label: 'Mode', params: { options: { FPS: 'fps', TPS: 'tps', Fly: 'fly' } } },
    { path: ['moveSpeed'], label: 'Move speed', params: { min: 0.1, max: 40, step: 0.1 } },
    {
      path: ['sprintMultiplier'],
      label: 'Sprint ×',
      params: { min: 1, max: 5, step: 0.1 },
    },
    { path: ['jumpHeight'], label: 'Jump height', params: { min: 0, max: 10, step: 0.1 } },
    {
      path: ['mouseSensitivity'],
      label: 'Mouse sensitivity',
      params: { min: 0.0002, max: 0.01, step: 0.0001 },
    },
    {
      path: ['eyeHeight'],
      label: 'Eye height',
      params: { min: 0, max: 4, step: 0.05 },
      visibleWhen: (c) => c.type === 'playerController' && c.mode === 'fps',
    },
    {
      path: ['cameraDistance'],
      label: 'Camera distance',
      params: { min: 0.5, max: 25, step: 0.1 },
      visibleWhen: (c) => c.type === 'playerController' && c.mode === 'tps',
    },
  ],
};
