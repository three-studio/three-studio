import { EMITTER_SHAPE_LABELS, optionsFrom, type ComponentDoc } from '@three-studio/core';
import { assetSlot, type ComponentSchema } from '../../inspector/fields';

/**
 * The two shape fields, each shown for the one shape that reads it.
 *
 * A radius means nothing to a box and extents mean nothing to a ball, and
 * showing both at once was the version that had to be looked at to be rejected:
 * three numbers that do nothing sit above three that do, and there is nothing
 * on screen to say which is which.
 */
const isShape =
  (kind: string) =>
  (component: ComponentDoc): boolean =>
    component.type === 'particleEmitter' && component.shape === kind;

export const inspector: ComponentSchema = {
  label: 'Particles',
  fields: [
    // Shape first, as on a mesh and on a water surface: it is what the emitter
    // *is*, and the two rows below it change with this one.
    {
      path: ['shape'],
      label: 'Emit from',
      type: 'enum',
      options: optionsFrom(EMITTER_SHAPE_LABELS),
    },
    {
      path: ['radius'],
      label: 'Radius',
      type: 'number', min: 0, max: 50, step: 0.05,
      visibleWhen: isShape('sphere'),
    },
    {
      path: ['extents'],
      // Not "Size": there is a particle Size further down, and two rows under
      // one heading reading the same word is a pane nobody can scan. Seen in
      // the editor rather than reasoned about — the two sit fifteen rows apart
      // in the source and one screen apart on the panel.
      label: 'Box size',
      type: 'vec3', min: 0, step: 0.1,
      visibleWhen: isShape('box'),
    },
    { kind: 'separator' },
    // Capped well below the system's own ceiling: a hundred thousand is what a
    // hand-edited file may ask for, five thousand is what a slider should offer.
    { path: ['count'], label: 'Particles', type: 'number', min: 0, max: 5000, step: 1 },
    // The emission rate is `count / lifetime`; there is no third field for it,
    // which is why this one is labelled for the span rather than for the rate.
    { path: ['lifetime'], label: 'Lifetime (s)', type: 'number', min: 0.1, max: 30, step: 0.1 },
    { kind: 'separator' },
    { path: ['velocity'], label: 'Velocity', type: 'vec3', step: 0.1 },
    // Plus and minus this, per particle. Zero on every axis is a beam.
    { path: ['spread'], label: 'Spread', type: 'vec3', min: 0, step: 0.1 },
    { path: ['gravity'], label: 'Gravity', type: 'number', min: -20, max: 20, step: 0.1 },
    { kind: 'separator' },
    assetSlot(['spriteId'], 'Sprite'),
    { path: ['color'], label: 'Colour' },
    { path: ['size'], label: 'Size', type: 'number', min: 0.001, max: 10, step: 0.01 },
    { path: ['opacity'], label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
    { path: ['additive'], label: 'Additive' },
  ],
};
