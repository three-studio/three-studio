import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Collider',
  fields: [
    {
      path: ['shape'],
      label: 'Shape',
      type: 'enum',
      options: [
        { value: 'box', label: 'Box' },
        { value: 'sphere', label: 'Sphere' },
        { value: 'capsule', label: 'Capsule' },
        { value: 'convexHull', label: 'Convex hull' },
        { value: 'trimesh', label: 'Triangle mesh' },
      ],
    },
    {
      path: ['radius'],
      label: 'Radius',
      type: 'number', min: 0.01, step: 0.05,
      visibleWhen: (c) => c.type === 'collider' && (c.shape === 'sphere' || c.shape === 'capsule'),
    },
    {
      path: ['halfHeight'],
      label: 'Half height',
      type: 'number', min: 0.01, step: 0.05,
      visibleWhen: (c) => c.type === 'collider' && c.shape === 'capsule',
    },
    { path: ['friction'], label: 'Friction', type: 'number', min: 0, max: 2, step: 0.01 },
    { path: ['restitution'], label: 'Bounciness', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['isSensor'], label: 'Is sensor' },
  ],
};
