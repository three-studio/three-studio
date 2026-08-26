import {
  createAudioListenerEntity,
  createAudioSourceEntity,
  createBoxGeometry,
  createCameraEntity,
  createEntity,
  createGeometry,
  createLightEntity,
  createMeshEntity,
  isPlaceable,
  restingOffsetY,
  type GeometryKind,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * What a fresh entity's default transform means.
 *
 * It used to be a position — a literal `[0, 0.5, 0]` for every primitive alike,
 * which is the right answer for a unit cube and wrong for two thirds of the
 * list. Now it is an offset from wherever the object is being placed, and the
 * offset has to be exact for "resting on the grid" to be true of anything but
 * the cube.
 */

/** Every kind, and the offset its default dimensions imply. */
const RESTING: Record<GeometryKind, number> = {
  box: 0.5, // height 1
  sphere: 0.5, // radius 0.5
  plane: 0, // laid flat: it is the ground
  capsule: 1, // height 1 between the caps, plus a 0.5 cap
  cylinder: 0.5, // height 1
  circle: 0,
  ring: 0,
  torus: 0.15, // the tube alone; the hole is in the other axis
  torusKnot: 0.72, // radius 0.4 × 1.5, plus a 0.12 tube
  tetrahedron: 0.5,
  octahedron: 0.5,
  dodecahedron: 0.5,
  icosahedron: 0.5,
};

describe('what holds a primitive off its support', () => {
  for (const [kind, expected] of Object.entries(RESTING) as [GeometryKind, number][]) {
    it(`lifts a ${kind} by ${expected}`, () => {
      expect(restingOffsetY(createGeometry(kind))).toBeCloseTo(expected, 5);
    });
  }

  it('reads the dimensions rather than the kind', () => {
    // The offset has to follow an author who resizes the geometry, which the
    // old constant could not do.
    expect(restingOffsetY({ ...createBoxGeometry(), height: 4 })).toBe(2);
  });

  it('puts the offset on the entity a factory hands back', () => {
    expect(createMeshEntity('torus').entity.transform.position).toEqual([0, 0.15, 0]);
    // Flat kinds are rotated onto the ground and need no lift at all; the old
    // branch gave them none by accident, this one by rule.
    expect(createMeshEntity('plane').entity.transform.position).toEqual([0, 0, 0]);
    expect(createMeshEntity('plane').entity.transform.rotation[0]).toBeCloseTo(-Math.PI / 2, 5);
  });
});

describe('an entity made of a sound', () => {
  it('carries the clip it was made from, and wears its name', () => {
    const template = createAudioSourceEntity('clip-7', 'footstep');
    expect(template.entity.name).toBe('footstep');
    expect(template.components[0]).toMatchObject({ type: 'audioSource', assetId: 'clip-7' });
  });

  it('is a plain Audio Source when nothing was dropped on it', () => {
    const template = createAudioSourceEntity();
    expect(template.entity.name).toBe('Audio Source');
    expect(template.components[0]).toMatchObject({ assetId: '' });
  });

  it('places like anything else, because a sound is somewhere', () => {
    // The falloff is the whole point of a positional source; an entity that
    // ignored where it was dropped would put every clip at the origin.
    expect(isPlaceable(createAudioSourceEntity())).toBe(true);
    expect(isPlaceable(createAudioListenerEntity())).toBe(true);
  });

  it('gives the ear its own entity, for a scene that wants it off the camera', () => {
    expect(createAudioListenerEntity().components[0]).toMatchObject({
      type: 'audioListener',
      masterVolume: 1,
    });
  });
});

describe('whose position means something', () => {
  it('places anything that stands somewhere', () => {
    expect(isPlaceable(createMeshEntity('box'))).toBe(true);
    expect(isPlaceable(createCameraEntity())).toBe(true);
    expect(isPlaceable(createLightEntity('point'))).toBe(true);
    expect(isPlaceable(createLightEntity('directional'))).toBe(true);
    expect(isPlaceable(createLightEntity('spot'))).toBe(true);
  });

  it('leaves the lights that light everything alone', () => {
    expect(isPlaceable(createLightEntity('ambient'))).toBe(false);
    expect(isPlaceable(createLightEntity('hemisphere'))).toBe(false);
  });

  it('places an empty, which carries no components at all', () => {
    // `every` over nothing is true, so the obvious spelling of the rule above
    // answers "not placeable" here — and the group would land at the origin
    // while everything the author put in it landed in front of the camera.
    expect(isPlaceable(createEntity('Empty'))).toBe(true);
  });
});
