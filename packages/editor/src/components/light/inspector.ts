import type { ComponentDoc } from '@three-studio/core';
import { asDegrees, assetSlot, type ComponentSchema } from '../../inspector/fields';

const isLightKind =
  (...kinds: readonly string[]) =>
  (component: ComponentDoc) =>
    component.type === 'light' && kinds.includes(component.kind);

/**
 * A shadow setting is worth showing only on a light that casts one.
 *
 * With no kinds given it means every kind that can: the shadow object exists on
 * all of them, so the checkbox is the whole condition. Naming kinds narrows it
 * further, for the settings that live on one class of shadow camera — a
 * directional light's is a box and a spot's is a frustum.
 */
const casts =
  (...kinds: readonly string[]) =>
  (component: ComponentDoc) =>
    component.type === 'light' &&
    component.castShadow &&
    (kinds.length === 0 || kinds.includes(component.kind));

/*
 * No `kind` field, deliberately.
 *
 * A light's kind is chosen when it is added — `Add > Light >` offers all seven
 * — and changing it afterwards is a different light, not an edited one: three
 * builds a different class per kind, which is why `LightSystem.patch` answers
 * `'remount'` and throws away the shadow map. Godot draws the same line, with
 * a node class per kind. The engine keeps the capability, for a hand-edited
 * file or a prefab; only the UI stops offering the gesture.
 *
 * A projector is a spot that throws a picture, so it appears beside `spot` in
 * every predicate above rather than getting a group of its own.
 */
export const inspector: ComponentSchema = {
  label: 'Light',
  fields: [
    { path: ['color'], label: 'Colour' },
    { path: ['intensity'], label: 'Intensity', params: { min: 0, max: 50, step: 0.1 } },
    {
      path: ['groundColor'],
      label: 'Ground colour',
      visibleWhen: isLightKind('hemisphere'),
    },
    {
      path: ['distance'],
      label: 'Range',
      params: { min: 0, max: 200, step: 0.5 },
      visibleWhen: isLightKind('point', 'spot', 'projector'),
    },
    {
      path: ['decay'],
      label: 'Decay',
      params: { min: 0, max: 4, step: 0.1 },
      visibleWhen: isLightKind('point', 'spot', 'projector'),
    },
    {
      path: ['angle'],
      label: 'Cone angle',
      params: { min: 1, max: 89, step: 1 },
      visibleWhen: isLightKind('spot', 'projector'),
      ...asDegrees,
    },
    {
      path: ['penumbra'],
      label: 'Penumbra',
      params: { min: 0, max: 1, step: 0.01 },
      visibleWhen: isLightKind('spot', 'projector'),
    },
    {
      path: ['width'],
      label: 'Width',
      params: { min: 0.01, max: 50, step: 0.05 },
      visibleWhen: isLightKind('rectArea'),
    },
    {
      path: ['height'],
      label: 'Height',
      params: { min: 0.01, max: 50, step: 0.05 },
      visibleWhen: isLightKind('rectArea'),
    },
    {
      ...assetSlot(['mapId'], 'Cookie'),
      visibleWhen: isLightKind('projector'),
    },
    {
      path: ['aspect'],
      // `0` is the useful default and means "take it from the texture", the
      // same convention `distance: 0` uses for an unbounded range.
      label: 'Aspect (0 = image)',
      params: { min: 0, max: 4, step: 0.01 },
      visibleWhen: isLightKind('projector'),
    },
    {
      path: ['castShadow'],
      label: 'Cast shadows',
      // Not `rectArea`: three shades it with linearly transformed cosines and
      // has no shadow path for it at all, so the checkbox would be a lie.
      visibleWhen: isLightKind('directional', 'point', 'spot', 'projector'),
    },
    /*
     * Everything below is `light.shadow`, and is shown only once the light
     * actually casts one.
     *
     * `inspectorSignature` carries `castShadow` for this reason: these fields
     * appear and disappear with the checkbox above, and a signature that
     * tracked only the kind would refresh the pane's values without rebuilding
     * its rows — the checkbox would tick and nothing else would happen.
     */
    { kind: 'separator' },
    {
      path: ['shadow', 'bias'],
      // The one an author reaches for first, and the one whose useful range is
      // nothing like its slider's: acne goes at about -0.0005.
      label: 'Bias',
      params: { min: -0.01, max: 0.01, step: 0.0001 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'normalBias'],
      label: 'Normal bias',
      params: { min: 0, max: 0.5, step: 0.001 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'radius'],
      label: 'Softness',
      params: { min: 0, max: 25, step: 0.5 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'blurSamples'],
      label: 'Blur samples',
      params: { min: 1, max: 32, step: 1 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'near'],
      label: 'Shadow near',
      params: { min: 0.001, max: 10, step: 0.01 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'far'],
      label: 'Shadow far',
      params: { min: 1, max: 2000, step: 10 },
      visibleWhen: casts(),
    },
    {
      path: ['shadow', 'orthoSize'],
      // The half-extent of the box the sun casts from. Too small and distant
      // objects stop casting entirely; too large and the same map is spread
      // thinner, which reads as shadows going soft and blocky at once.
      label: 'Shadow area',
      params: { min: 1, max: 200, step: 1 },
      visibleWhen: casts('directional'),
    },
    {
      path: ['shadow', 'focus'],
      label: 'Shadow focus',
      params: { min: 0.1, max: 4, step: 0.05 },
      visibleWhen: casts('spot', 'projector'),
    },
  ],
};
