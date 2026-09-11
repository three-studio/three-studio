import type { EntityMarker } from '../registry';

/** A controller moves what it is attached to; it draws nothing itself. */
export const drawsGeometry = false;

/**
 * No marker. A controller sits on the thing the player *is*, which is a capsule
 * or a model and clickable already.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
