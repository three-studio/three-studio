import { colliderHalfHeight, createComponent, type ColliderComponent } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * How far a collider hangs below the entity's origin.
 *
 * Two things read this and they must not disagree: the scene migration that
 * raised every stored `eyeHeight` to be measured from the feet, and the
 * controller that places the camera at run time. A difference between them
 * would show up as a camera that sits at one height in a freshly migrated
 * project and another height the next time the scene is opened — the sort of
 * drift nobody traces back to a shape table.
 */

function collider(overrides: Partial<ColliderComponent>): ColliderComponent {
  return { ...createComponent('collider'), ...overrides };
}

describe('colliderHalfHeight', () => {
  it('measures a box by its vertical half extent', () => {
    // `size` is already half extents, which is what physics is handed.
    expect(colliderHalfHeight(collider({ shape: 'box', size: [0.4, 0.9, 0.4] }))).toBe(0.9);
  });

  it('measures a sphere by its radius', () => {
    expect(colliderHalfHeight(collider({ shape: 'sphere', radius: 0.6 }))).toBe(0.6);
  });

  it('measures a capsule by its half height plus a cap', () => {
    // The default player: 0.3 + 0.55 + 0.55 + 0.3 is 1.70 m standing, so the
    // origin — the middle — is 0.85 m above the floor.
    expect(colliderHalfHeight(collider({ shape: 'capsule', radius: 0.3, halfHeight: 0.55 }))).toBeCloseTo(0.85, 6);
  });

  for (const shape of ['trimesh', 'convexHull'] as const) {
    it(`treats the origin of a ${shape} as already being its reference`, () => {
      // Built from the entity's own geometry in its own local space, so there
      // is nothing centred on the origin to compensate for — and no answer the
      // migration, which has no geometry to measure, could give instead.
      expect(colliderHalfHeight(collider({ shape }))).toBe(0);
    });
  }
});
