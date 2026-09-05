import type { EntityMarker } from '../registry';

/**
 * No geometry of its own, for all that it draws.
 *
 * The particles are there and they are not the emitter: they are somewhere else
 * by design, they are transparent, and there are none at all at the instant a
 * scene is opened before the clock has moved. What an author drags is the
 * emitter, and without a marker there is nothing at that place to click.
 */
export const drawsGeometry = false;

/**
 * After the camera, the light and the two audio components: an emitter is
 * scenery, and when one shares an entity with a light it is the light that says
 * what the entity is.
 */
export const marker: EntityMarker = { color: 0xffb86b, pixels: 9, priority: 5 };

/**
 * No annotation.
 *
 * The shape worth drawing is the emission volume, and it is worth drawing —
 * but the marker already says where the emitter is, and the plume itself says
 * which way it throws. Left out until someone is editing a radius and wants it.
 */
export const helper = null;
