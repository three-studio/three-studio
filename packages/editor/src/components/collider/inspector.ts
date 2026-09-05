import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Collider',
  fields: [
    {
      path: ['shape'],
      label: 'Shape',
      params: {
        options: {
          Box: 'box',
          Sphere: 'sphere',
          Capsule: 'capsule',
          'Convex hull': 'convexHull',
          'Triangle mesh': 'trimesh',
        },
      },
    },
    {
      path: ['radius'],
      label: 'Radius',
      params: { min: 0.01, step: 0.05 },
      visibleWhen: (c) => c.type === 'collider' && (c.shape === 'sphere' || c.shape === 'capsule'),
    },
    {
      path: ['halfHeight'],
      label: 'Half height',
      params: { min: 0.01, step: 0.05 },
      visibleWhen: (c) => c.type === 'collider' && c.shape === 'capsule',
    },
    { path: ['friction'], label: 'Friction', params: { min: 0, max: 2, step: 0.01 } },
    { path: ['restitution'], label: 'Bounciness', params: { min: 0, max: 1, step: 0.01 } },
    { path: ['isSensor'], label: 'Is sensor' },
  ],
};
