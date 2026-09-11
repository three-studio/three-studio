import type { EntityMarker } from '../registry';

/** Physics moves the object; the object is what is drawn. */
export const drawsGeometry = false;

/**
 * No marker. A body is always on something with a shape — a mesh, a model — and
 * a dot over it would fight the click target it already has.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
