import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { ParticleEmitterComponent } from './schema';

/**
 * A slow plume of warm embers, drifting upward.
 *
 * Chosen so that an emitter dropped into a scene is visibly *something* before
 * a single field is touched — which the obvious defaults are not: a point
 * source with no spread and no velocity draws every particle in one place, and
 * reads as a single sprite stuck to the gizmo.
 *
 * Two hundred is small enough to be free on any machine and large enough to
 * look like a stream rather than a handful of dots.
 */
export function createParticleEmitter(): ParticleEmitterComponent {
  return {
    id: createId(),
    type: 'particleEmitter',
    count: 200,
    // A ball rather than a point, for the reason above: an emitter with a
    // volume shows what its two shape fields are for the moment it is added.
    shape: 'sphere',
    radius: 0.25,
    extents: [1, 1, 1],
    lifetime: 2,
    velocity: [0, 1.5, 0],
    spread: [0.4, 0.4, 0.4],
    gravity: 0,
    size: 0.15,
    color: '#ffb86b',
    opacity: 1,
    spriteId: null,
    additive: true,
  };
}

export function createParticleEmitterEntity(): EntityTemplate {
  return createEntity('Particles', [createParticleEmitter()]);
}
