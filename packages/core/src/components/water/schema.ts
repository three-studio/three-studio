import type { Infer, Schema } from '../../fieldSchema';
import { materialFields } from '../../scene/material';
import type { Component } from '../../scene/primitives';

/** A water surface, as its fields. The order is the pane's. */
export const waterSchema = {
  /*
   * Shape first, as on a mesh: it is what the object is. Always a plane, so its
   * fields are the plane's, whose segments no row offers: the surface moves in
   * its shader, not in its vertices.
   */
  geometry: {
    type: 'object',
    label: 'Surface',
    fields: {
      kind: { type: 'enum', label: 'Primitive', default: 'plane', shown: false, options: [{ value: 'plane', label: 'Plane' }] },
      width: { type: 'number', label: 'Width', default: 50, min: 0.01, step: 0.5 },
      height: { type: 'number', label: 'Height', default: 50, min: 0.01, step: 0.5 },
      widthSegments: { type: 'number', label: 'Segments X', default: 1, shown: false },
      heightSegments: { type: 'number', label: 'Segments Y', default: 1, shown: false },
    },
  },
  normalMapId: { type: 'asset', label: 'Normal map', kind: 'texture', separatorBefore: true },
  waterColor: { type: 'color', label: 'Colour', default: '#7f7f7f' },
  alpha: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1, step: 0.01 },
  /*
   * Spatial, not temporal: it scales the world position the noise is read at,
   * so larger is choppier rather than faster. Labelled for what it does, since
   * "Size" beside a Width and a Height reads as a third one.
   */
  size: { type: 'number', label: 'Ripple scale', default: 1, min: 0.01, max: 20, step: 0.01 },
  /*
   * Its twin in time: that one is the pattern in space, this one is the
   * pattern in time. The scene's timescale still multiplies it, so Pause stops
   * a surface however fast it is set. It, the direction and the choppiness are
   * `WaterMesh`'s own behaviour written down at their defaults.
   */
  speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05 },
  direction: { type: 'number', label: 'Direction', default: 0, min: 0, max: 360, step: 1, unit: 'radians' },
  choppiness: { type: 'number', label: 'Choppiness', default: 1.5, min: 0.1, max: 5, step: 0.05 },
  distortionScale: { type: 'number', label: 'Distortion', default: 20, min: 0, max: 100, step: 0.5 },
  /*
   * What the glint is lit by: the scene's sky, a light of the scene, or a sun
   * of its own. A light that has gone lights it as the sky does, and the
   * Hierarchy marks the surface; a copy of both, in a prefab's instance, names
   * the copy of the light. Choosing a sun of its own again starts from its
   * defaults.
   */
  sun: {
    type: 'union',
    label: 'Sun',
    default: 'sky',
    separatorBefore: true,
    variants: {
      sky: { label: 'Sky (scene sun)', fields: {} },
      // The light is picked in the one dropdown the type's pane draws for the sun.
      light: { label: 'Light', fields: { entity: { type: 'entity', label: 'Light', shown: false } } },
      custom: {
        label: 'Custom',
        fields: {
          direction: { type: 'vec3', label: 'Sun direction', default: [0.70707, 0.70707, 0] },
          color: { type: 'color', label: 'Sun colour', default: '#ffffff' },
        },
      },
    },
  },
  /*
   * Stepped coarsely: `RenderTarget.setSize` disposes and rebuilds the
   * reflection buffer on any real change, so a coarse step turns a drag into
   * about eighteen reallocations instead of sixty a second.
   */
  resolutionScale: {
    type: 'number',
    label: 'Reflection quality',
    default: 0.5,
    min: 0.1,
    max: 1,
    step: 0.05,
    separatorBefore: true,
  },
  side: materialFields.side,
  fog: { type: 'boolean', label: 'Affected by fog', default: false },
} as const satisfies Schema;

export type WaterComponent = Component<'water', Infer<typeof waterSchema>>;
export type WaterSun = WaterComponent['sun'];
