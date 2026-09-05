import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Rigid Body',
  fields: [
    {
      path: ['bodyType'],
      label: 'Type',
      params: {
        options: { Dynamic: 'dynamic', Fixed: 'fixed', Kinematic: 'kinematicPosition' },
      },
    },
    { path: ['mass'], label: 'Mass', params: { min: 0.001, step: 0.1 } },
    { path: ['linearDamping'], label: 'Linear damping', params: { min: 0, max: 10, step: 0.01 } },
    { path: ['angularDamping'], label: 'Angular damping', params: { min: 0, max: 10, step: 0.01 } },
    { path: ['gravityScale'], label: 'Gravity scale', params: { min: -5, max: 5, step: 0.1 } },
    { path: ['ccd'], label: 'Continuous detection' },
  ],
};
