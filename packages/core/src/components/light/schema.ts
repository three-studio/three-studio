import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** Kinds that throw a cone: a projector is a spot that throws a picture. */
const CONES = ['spot', 'projector'] as const;
/** Kinds whose light falls off with distance. */
const REACHING = ['point', ...CONES] as const;

/**
 * A light, as its fields. The order is the pane's.
 *
 * Seven kinds, and the defaults of one — a point light's. A light's kind is
 * chosen when it is added, and changing it afterwards is another light rather
 * than an edited one: three builds a class per kind, which is why the kind has
 * no row, and why `createLight` gives each kind its own intensity and says
 * whether it casts. Each row shows for the kinds that read it.
 */
export const lightSchema = {
  kind: {
    type: 'enum',
    label: 'Kind',
    default: 'point',
    shown: false,
    options: [
      { value: 'ambient', label: 'Ambient' },
      { value: 'hemisphere', label: 'Hemisphere' },
      { value: 'directional', label: 'Directional' },
      { value: 'point', label: 'Point' },
      { value: 'spot', label: 'Spot' },
      { value: 'rectArea', label: 'Area' },
      { value: 'projector', label: 'Projector' },
    ],
  },
  color: { type: 'color', label: 'Colour', default: '#ffffff' },
  /* In the physical units three uses for the kind; see `createLight`. */
  intensity: { type: 'number', label: 'Intensity', default: 12, min: 0, max: 50, step: 0.1 },
  groundColor: { type: 'color', label: 'Ground colour', default: '#4a4436', shownWhen: { field: 'kind', equals: 'hemisphere' } },
  /* `0` means no falloff limit. */
  distance: { type: 'number', label: 'Range', default: 0, min: 0, max: 200, step: 0.5, shownWhen: { field: 'kind', oneOf: REACHING } },
  decay: { type: 'number', label: 'Decay', default: 2, min: 0, max: 4, step: 0.1, shownWhen: { field: 'kind', oneOf: REACHING } },
  angle: {
    type: 'number',
    label: 'Cone angle',
    default: Math.PI / 6,
    min: 1,
    max: 89,
    step: 1,
    unit: 'radians',
    shownWhen: { field: 'kind', oneOf: CONES },
  },
  penumbra: { type: 'number', label: 'Penumbra', default: 0.2, min: 0, max: 1, step: 0.01, shownWhen: { field: 'kind', oneOf: CONES } },
  /* An area light's panel, in metres. It emits from its local -Z face. */
  width: { type: 'number', label: 'Width', default: 1, min: 0.01, max: 50, step: 0.05, shownWhen: { field: 'kind', equals: 'rectArea' } },
  height: { type: 'number', label: 'Height', default: 1, min: 0.01, max: 50, step: 0.05, shownWhen: { field: 'kind', equals: 'rectArea' } },
  /* The texture a projector throws. */
  mapId: { type: 'asset', label: 'Cookie', kind: 'texture', shownWhen: { field: 'kind', equals: 'projector' } },
  /*
   * `0` takes the aspect from the texture: the useful default, and the same
   * convention `distance: 0` uses for an unbounded range.
   */
  aspect: {
    type: 'number',
    label: 'Aspect (0 = image)',
    default: 0,
    min: 0,
    max: 4,
    step: 0.01,
    shownWhen: { field: 'kind', equals: 'projector' },
  },
  /*
   * Not for an area light: three shades it with linearly transformed cosines
   * and has no shadow path for it at all, so the checkbox would be a lie.
   */
  castShadow: {
    type: 'boolean',
    label: 'Cast shadows',
    default: true,
    shownWhen: { field: 'kind', oneOf: ['directional', 'point', 'spot', 'projector'] },
  },
  /*
   * What three carries on `light.shadow`, read and written together, and shown
   * once the light casts one. Every default is three's own.
   */
  shadow: {
    type: 'object',
    label: 'Shadow',
    separatorBefore: true,
    shownWhen: { field: 'castShadow', equals: true },
    fields: {
      /*
       * The one an author reaches for first, and the one whose useful range is
       * nothing like its slider's: acne goes at about -0.0005.
       */
      bias: { type: 'number', label: 'Bias', default: 0, min: -0.01, max: 0.01, step: 0.0001 },
      normalBias: { type: 'number', label: 'Normal bias', default: 0, min: 0, max: 0.5, step: 0.001 },
      radius: { type: 'number', label: 'Softness', default: 1, min: 0, max: 25, step: 0.5 },
      blurSamples: { type: 'number', label: 'Blur samples', default: 8, min: 1, max: 32, step: 1 },
      near: { type: 'number', label: 'Shadow near', default: 0.5, min: 0.001, max: 10, step: 0.01 },
      far: { type: 'number', label: 'Shadow far', default: 500, min: 1, max: 2000, step: 10 },
      /*
       * A directional light's: the half-extent of the box the sun casts from.
       * Too small and distant objects stop casting; too large and the same map
       * is spread thinner, which reads as shadows going soft and blocky at once.
       */
      orthoSize: {
        type: 'number',
        label: 'Shadow area',
        default: 5,
        min: 1,
        max: 200,
        step: 1,
        shownWhen: { field: 'kind', equals: 'directional' },
      },
      focus: { type: 'number', label: 'Shadow focus', default: 1, min: 0.1, max: 4, step: 0.05, shownWhen: { field: 'kind', oneOf: CONES } },
    },
  },
} as const satisfies Schema;

export type LightComponent = Component<'light', Infer<typeof lightSchema>>;
export type LightKind = LightComponent['kind'];
export type ShadowSettings = LightComponent['shadow'];
