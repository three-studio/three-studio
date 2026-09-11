import type { EntityMarker } from '../registry';

/** A script draws nothing of its own; what it moves is somebody else's object. */
export const drawsGeometry = false;

/**
 * No marker. A script is almost always attached to something already visible,
 * and one on a bare entity is scaffolding the hierarchy names better.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
