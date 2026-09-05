import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Camera',
  fields: [
    {
      path: ['projection'],
      label: 'Projection',
      params: { options: { Perspective: 'perspective', Orthographic: 'orthographic' } },
    },
    {
      path: ['fov'],
      label: 'Field of view',
      params: { min: 10, max: 130, step: 1 },
      visibleWhen: (c) => c.type === 'camera' && c.projection === 'perspective',
    },
    {
      path: ['frustumSize'],
      label: 'Size',
      params: { min: 0.1, step: 0.5 },
      visibleWhen: (c) => c.type === 'camera' && c.projection === 'orthographic',
    },
    { path: ['near'], label: 'Near', params: { min: 0.001, step: 0.01 } },
    { path: ['far'], label: 'Far', params: { min: 1, step: 10 } },
    { path: ['isMain'], label: 'Main camera' },
  ],
};
