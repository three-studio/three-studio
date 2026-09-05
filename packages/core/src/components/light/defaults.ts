import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { LightComponent, LightKind, ShadowSettings } from './schema';

/**
 * three uses physical units, so a sensible default differs by an order of
 * magnitude between light types: directional and hemisphere are irradiance,
 * point and spot are luminous intensity.
 *
 * A rect area light is in nits — luminance, *per square metre* — so its number
 * only means anything against the 1 x 1 panel `createLight` gives it. Matching
 * the luminous power of the point light above puts it near 48: a point light's
 * 12 cd is 4π·12 ≈ 151 lm, and a panel's is `intensity · width · height · π`.
 * 40 is that, rounded down. Checked in the viewport against a point light at
 * its own default, because this is the one figure here that no source states:
 * three's examples quote 5, but for a panel of 10 x 10, a hundred times the
 * area. At 5 on a one-metre panel an Area Light lands in a scene and appears to
 * do nothing at all.
 */
const LIGHT_INTENSITY: Record<LightKind, number> = {
  ambient: 0.4,
  hemisphere: 0.8,
  directional: 2,
  point: 12,
  spot: 20,
  rectArea: 40,
  projector: 20,
};

/** three's own shadow defaults, so filling an older scene changes nothing. */
export function createShadowSettings(): ShadowSettings {
  return {
    bias: 0,
    normalBias: 0,
    radius: 1,
    blurSamples: 8,
    near: 0.5,
    far: 500,
    orthoSize: 5,
    focus: 1,
  };
}

/** Kinds three can cast a shadow from. A rect area light cannot. */
const SHADOW_CASTERS: ReadonlySet<LightKind> = new Set([
  'directional',
  'spot',
  'point',
  'projector',
]);

export function createLight(kind: LightKind): LightComponent {
  return {
    id: createId(),
    type: 'light',
    kind,
    color: '#ffffff',
    intensity: LIGHT_INTENSITY[kind],
    groundColor: '#4a4436',
    distance: 0,
    decay: 2,
    angle: Math.PI / 6,
    penumbra: 0.2,
    width: 1,
    height: 1,
    mapId: null,
    aspect: 0,
    castShadow: SHADOW_CASTERS.has(kind),
    shadow: createShadowSettings(),
  };
}

const LIGHT_LABELS: Record<LightKind, string> = {
  ambient: 'Ambient Light',
  hemisphere: 'Hemisphere Light',
  directional: 'Directional Light',
  point: 'Point Light',
  spot: 'Spot Light',
  rectArea: 'Area Light',
  projector: 'Projector Light',
};

export function createLightEntity(kind: LightKind): EntityTemplate {
  const template = createEntity(LIGHT_LABELS[kind], [createLight(kind)]);
  const { transform } = template.entity;
  if (kind === 'directional') {
    transform.position = [8, 12, 6];
    // Directional and spot lights shine along their local -Z, so the default
    // rotation is what makes a new sun light the scene instead of the horizon.
    transform.rotation = [degrees(-50), degrees(-30), 0];
  } else if (kind === 'spot' || kind === 'projector' || kind === 'rectArea') {
    // The same three-quarter pose: all three emit along their local -Z, so
    // pointing them at the floor is what shows an author they arrived.
    transform.position = [0, 5, 0];
    transform.rotation = [degrees(-90), 0, 0];
  } else if (kind === 'point') {
    transform.position = [0, 3, 0];
  }
  return template;
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}
