import { SUN_CUSTOM, SUN_FROM_SKY, entitiesWith, type ComponentDoc } from '@three-studio/core';
import {
  SIDE_OPTIONS,
  asDegrees,
  asVec3,
  assetSlot,
  type ComponentSchema,
} from '../../inspector/fields';
import { useDocumentStore } from '../../state/documentStore';

/** Whether a water surface is lit by its own two fields rather than the scene. */
const isCustomSun = (component: ComponentDoc): boolean =>
  component.type === 'water' && component.sunSource === SUN_CUSTOM;

export const inspector: ComponentSchema = {
  label: 'Water',
  fields: [
    // Shape first, as on a mesh: it is what the object *is*. Written out
    // rather than taken from the `{ kind: 'geometry' }` slot, which switches
    // over all thirteen primitives — a water surface is always a plane.
    { path: ['geometry', 'width'], label: 'Width', params: { min: 0.01, step: 0.5 } },
    { path: ['geometry', 'height'], label: 'Height', params: { min: 0.01, step: 0.5 } },
    { kind: 'separator' },
    assetSlot(['normalMapId'], 'Normal map'),
    { path: ['waterColor'], label: 'Colour' },
    { path: ['alpha'], label: 'Opacity', params: { min: 0, max: 1, step: 0.01 } },
    // `size` is spatial, not temporal: it scales the world position the noise
    // is read at, so larger is choppier rather than faster. Labelled for what
    // it does, since "Size" beside a Width and a Height reads as a third one.
    { path: ['size'], label: 'Ripple scale', params: { min: 0.01, max: 20, step: 0.01 } },
    // Beside `Ripple scale`, its twin: that one is the pattern in space, this
    // one is the pattern in time. The scene's timescale still multiplies it,
    // so Pause stops a surface however fast it is set.
    { path: ['speed'], label: 'Speed', params: { min: 0, max: 5, step: 0.05 } },
    { path: ['direction'], label: 'Direction', params: { min: 0, max: 360, step: 1 }, ...asDegrees },
    { path: ['choppiness'], label: 'Choppiness', params: { min: 0.1, max: 5, step: 0.05 } },
    { path: ['distortionScale'], label: 'Distortion', params: { min: 0, max: 100, step: 0.5 } },
    { kind: 'separator' },
    {
      path: ['sunSource'],
      label: 'Sun',
      // One control for a question with one answer: the sky, a light in the
      // scene, or two fields of your own. A dropdown rather than a reference
      // picker because the first and last options are not entities, and a
      // picker that had to carry them would be two controls pretending to be
      // one.
      optionsProvider: () => {
        const scene = useDocumentStore.getState().scene;
        const lights = entitiesWith(scene, 'light')
          .map((id) => scene.entities[id])
          .filter((entity) => entity !== undefined);
        return {
          'Sky (scene sun)': SUN_FROM_SKY,
          ...Object.fromEntries(lights.map((entity) => [entity.name, entity.id])),
          Custom: SUN_CUSTOM,
        };
      },
    },
    {
      path: ['sunDirection'],
      label: 'Sun direction',
      ...asVec3,
      visibleWhen: isCustomSun,
    },
    { path: ['sunColor'], label: 'Sun colour', visibleWhen: isCustomSun },
    { kind: 'separator' },
    {
      path: ['resolutionScale'],
      label: 'Reflection quality',
      // Stepped coarsely, and no longer because it rebuilds the shader — the
      // fork made it writable in place. `RenderTarget.setSize` still disposes
      // and rebuilds the reflection buffer on any real change, so a coarse
      // step turns a drag into about eighteen reallocations instead of sixty
      // a second.
      params: { min: 0.1, max: 1, step: 0.05 },
    },
    { path: ['side'], label: 'Side', params: { options: SIDE_OPTIONS } },
    { path: ['fog'], label: 'Affected by fog' },
  ],
};
