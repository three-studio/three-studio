import type { EntityMarker, EntityOverlay } from '../registry';

/** Physics moves the object; the object is what is drawn. */
const drawsGeometry = false;

/**
 * No marker. A body is always on something with a shape — a mesh, a model — and
 * a dot over it would fight the click target it already has.
 */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'rigidbody', drawsGeometry, marker, helper };
