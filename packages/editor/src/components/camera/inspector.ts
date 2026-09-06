import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Camera',
  fields: [
    {
      path: ['projection'],
      label: 'Projection',
      type: 'enum',
      options: [
        { value: 'perspective', label: 'Perspective' },
        { value: 'orthographic', label: 'Orthographic' },
      ],
    },
    {
      path: ['fov'],
      label: 'Field of view',
      type: 'number', min: 10, max: 130, step: 1,
      visibleWhen: (c) => c.type === 'camera' && c.projection === 'perspective',
    },
    {
      path: ['frustumSize'],
      label: 'Size',
      type: 'number', min: 0.1, step: 0.5,
      visibleWhen: (c) => c.type === 'camera' && c.projection === 'orthographic',
    },
    { path: ['near'], label: 'Near', type: 'number', min: 0.001, step: 0.01 },
    { path: ['far'], label: 'Far', type: 'number', min: 1, step: 10 },
    { path: ['isMain'], label: 'Main camera' },
  ],
};
