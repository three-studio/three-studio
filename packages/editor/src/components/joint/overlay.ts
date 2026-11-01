import type { EntityMarker } from '../registry';

/** A joint holds bodies together; what is drawn is theirs. */
export const drawsGeometry = false;

/**
 * No marker. A joint sits on a body, which has a shape to click, or on an
 * empty child at a door's edge, which the hierarchy names.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
