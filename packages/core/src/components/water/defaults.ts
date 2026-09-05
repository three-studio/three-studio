import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import { SUN_FROM_SKY } from '../../scene/water';
import type { WaterComponent } from './schema';

/**
 * A water surface, at `WaterMesh`'s own defaults where it has one.
 *
 * The plane is 50 m and undivided: the ripples are a normal map, not moved
 * vertices, so segments buy nothing here and a subdivided sheet would only cost
 * the reflection pass more to draw.
 *
 * `sunSource` starts on the sky rather than on `WaterMesh`'s `(0.707, 0.707, 0)`
 * because every scene this project makes has a sky, and a water whose glint
 * disagrees with the sun above it is the first thing an author has to fix.
 */
export function createWater(): WaterComponent {
  return {
    id: createId(),
    type: 'water',
    geometry: { kind: 'plane', width: 50, height: 50, widthSegments: 1, heightSegments: 1 },
    normalMapId: null,
    waterColor: '#7f7f7f',
    sunSource: SUN_FROM_SKY,
    sunDirection: [0.70707, 0.70707, 0],
    sunColor: '#ffffff',
    alpha: 1,
    size: 1,
    // The three below are `WaterMesh`'s own behaviour written down, so a surface
    // added today and one added before they existed look identical.
    speed: 1,
    direction: 0,
    choppiness: 1.5,
    distortionScale: 20,
    resolutionScale: 0.5,
    side: 'front',
    fog: false,
  };
}

/**
 * A water surface, laid flat where the author is looking.
 *
 * Flat for the same reason `createMeshEntity` lays a plane down — three builds
 * its plane in the XY plane, facing the camera — and at zero height, because a
 * sheet on the ground is the ground.
 */
export function createWaterEntity(): EntityTemplate {
  const template = createEntity('Water', [createWater()]);
  template.entity.transform.rotation = [-Math.PI / 2, 0, 0];
  return template;
}
