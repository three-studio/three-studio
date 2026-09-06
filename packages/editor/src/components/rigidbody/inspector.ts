import { BODY_TYPE_LABELS, optionsFrom } from '@three-studio/core';
import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Rigid Body',
  fields: [
    {
      path: ['bodyType'],
      label: 'Type',
      type: 'enum',
      options: optionsFrom(BODY_TYPE_LABELS),
    },
    { path: ['mass'], label: 'Mass', type: 'number', min: 0.001, step: 0.1 },
    {
      path: ['linearDamping'],
      label: 'Linear damping',
      type: 'number', min: 0, max: 10, step: 0.01,
    },
    {
      path: ['angularDamping'],
      label: 'Angular damping',
      type: 'number', min: 0, max: 10, step: 0.01,
    },
    { path: ['gravityScale'], label: 'Gravity scale', type: 'number', min: -5, max: 5, step: 0.1 },
    { path: ['ccd'], label: 'Continuous detection' },
  ],
};
