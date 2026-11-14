import type { EntityMarker, EntityOverlay } from '../registry';

/** A controller moves what it is attached to; it draws nothing itself. */
const drawsGeometry = false;

/**
 * No marker. A controller sits on the thing the player *is*, which is a capsule
 * or a model and clickable already.
 */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'playerController', drawsGeometry, marker, helper };
