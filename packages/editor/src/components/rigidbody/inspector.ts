import { BODY_TYPE_LABELS, optionsFrom, type ComponentDoc } from '@three-studio/core';
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
    { path: ['interpolate'], label: 'Interpolate', visibleWhen: isDynamic },
  ],
};

/**
 * The rows only the solver reads. A kinematic body is drawn where its
 * transform is, and the player's always between ticks, whatever they say.
 */
function isDynamic(component: ComponentDoc): boolean {
  return component.type === 'rigidbody' && component.bodyType === 'dynamic';
}
